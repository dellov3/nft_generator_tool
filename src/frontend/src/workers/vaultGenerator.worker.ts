/**
 * Web Worker for NFT collection generation.
 * Performs trait selection, rule validation, DNA uniqueness checks,
 * and optional image compositing off the main thread.
 * Supports animated GIF output when any trait is a GIF.
 */

import {
  composeAnimatedGif,
  composeFrames,
  extractGifFrames,
  hasAnimatedGifTrait,
  isGifDataUrl,
} from "../utils/gifUtils";
import type {
  ForgedTokenData,
  GeneratedNFTData,
  LayerData,
  RuleData,
  WorkerInputMessage,
  WorkerOutputMessage,
} from "../utils/vaultGeneratorProtocol";

let isCancelled = false;
let supportsImageCompositing = false;

// Feature detection for worker image compositing
function detectImageCompositing(): boolean {
  try {
    if (typeof OffscreenCanvas === "undefined") return false;
    if (typeof createImageBitmap === "undefined") return false;
    return true;
  } catch {
    return false;
  }
}

// Initialize capabilities
supportsImageCompositing = detectImageCompositing();

// Generate deterministic DNA string from ordered layer list
function generateDNA(
  traits: Record<string, string>,
  layers: LayerData[],
): string {
  return layers.map((layer) => traits[layer.id] || "").join("-");
}

// Validate trait combination against rules
function isValidCombination(
  traits: Record<string, string>,
  rules: RuleData[],
): boolean {
  for (const rule of rules) {
    const hasPrimary =
      traits[rule.primaryTrait.layerId] === rule.primaryTrait.traitId;

    if (!hasPrimary) continue;

    for (const incompatibleTrait of rule.incompatibleTraits) {
      const hasIncompatible =
        traits[incompatibleTrait.layerId] === incompatibleTrait.traitId;

      if (rule.type === "exclude" && hasIncompatible) {
        return false;
      }
      if (rule.type === "force" && !hasIncompatible) {
        return false;
      }
    }
  }
  return true;
}

// Load image from data URL (worker-side)
async function loadImage(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

// Generate image using OffscreenCanvas — with GIF support
async function generateImage(
  traits: Record<string, string>,
  layers: LayerData[],
  pixelArtMode: boolean,
): Promise<{ dataUrl: string; isGif: boolean } | null> {
  if (!supportsImageCompositing) {
    return null;
  }

  try {
    // Collect trait data URLs for layers that have a trait selected
    const activeTraits: Array<{
      dataUrl: string;
      isGif: boolean;
      opacity: number;
      blendMode: string;
    }> = [];

    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      const traitId = traits[layer.id];
      if (!traitId) continue;
      const trait = layer.traits.find((t) => t.id === traitId);
      if (!trait) continue;
      activeTraits.push({
        dataUrl: trait.imageData,
        isGif: isGifDataUrl(trait.imageData),
        opacity: layer.opacity,
        blendMode: layer.blendMode,
      });
    }

    const anyGif = hasAnimatedGifTrait(
      activeTraits.map((t) => ({ imageData: t.dataUrl })),
    );

    if (anyGif) {
      // ── Animated GIF output path ──────────────────────────────────────────
      // Extract frames for all GIF traits
      const layerImages = await Promise.all(
        activeTraits.map(async (t) => {
          if (t.isGif) {
            const frames = await extractGifFrames(t.dataUrl);
            return { ...t, frames };
          }
          return { ...t, frames: undefined };
        }),
      );

      const composed = await composeFrames(layerImages, 800, pixelArtMode);
      const gifDataUrl = await composeAnimatedGif(composed, 800, 800);
      return { dataUrl: gifDataUrl, isGif: true };
    }

    // ── Static PNG output path (unchanged) ───────────────────────────────────
    const canvas = new OffscreenCanvas(800, 800);
    const ctx = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: false,
    });
    if (!ctx) return null;

    if (pixelArtMode) {
      ctx.imageSmoothingEnabled = false;
    }

    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      const traitId = traits[layer.id];
      if (!traitId) continue;

      const trait = layer.traits.find((t) => t.id === traitId);
      if (!trait) continue;

      const img = await loadImage(trait.imageData);

      ctx.save();
      ctx.globalAlpha = layer.opacity / 100;
      ctx.globalCompositeOperation =
        layer.blendMode as GlobalCompositeOperation;
      ctx.drawImage(img, 0, 0, 800, 800);
      ctx.restore();
    }

    const blob = await canvas.convertToBlob({ type: "image/png" });
    const reader = new FileReader();

    const dataUrl = await new Promise<string>((resolve) => {
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });

    return { dataUrl, isGif: false };
  } catch (error) {
    console.error("Worker image generation error:", error);
    return null;
  }
}

// Create metadata for an NFT
function createMetadata(
  id: number,
  traits: Record<string, string>,
  layers: LayerData[],
  projectName: string,
  blockchain: string,
  symbol: string,
  isGif: boolean,
) {
  const attributes = layers
    .filter((l) => traits[l.id])
    .map((layer) => {
      const trait = layer.traits.find((t) => t.id === traits[layer.id]);
      return {
        trait_type: layer.name,
        value: trait?.name || "Unknown",
      };
    });

  const ext = isGif ? "gif" : "png";

  const baseMetadata = {
    name: `${projectName} #${id}`,
    description: `${projectName} NFT Collection`,
    image: `${id}.${ext}`,
    attributes,
  };

  if (blockchain === "SOL") {
    return {
      ...baseMetadata,
      symbol: symbol,
      seller_fee_basis_points: 500,
      creators: [
        {
          address: "YOUR_WALLET_ADDRESS",
          share: 100,
        },
      ],
    };
  }

  return baseMetadata;
}

// Main generation loop
async function generateCollection(
  layers: LayerData[],
  rules: RuleData[],
  forgedTokens: ForgedTokenData[],
  collectionSize: number,
  projectName: string,
  blockchain: string,
  symbol: string,
  pixelArtMode: boolean,
  batchSize: number,
) {
  isCancelled = false;

  const validLayers = layers.filter((l) => l.traits.length > 0);
  if (validLayers.length === 0) {
    postMessage({
      type: "error",
      payload: { message: "No valid layers found" },
    } as WorkerOutputMessage);
    return;
  }

  // Generate forged tokens
  const allTokenNumbers: number[] = [];
  for (let i = 1; i <= collectionSize; i++) {
    allTokenNumbers.push(i);
  }

  const shuffledNumbers = [...allTokenNumbers].sort(() => Math.random() - 0.5);

  const forgedNFTs: GeneratedNFTData[] = forgedTokens.map((token, index) => {
    const newTokenNumber = shuffledNumbers[index];
    const forgedIsGif = isGifDataUrl(token.imageData);

    const metadata = {
      name: `${projectName} #${newTokenNumber}`,
      description: `${projectName} - Custom 1-of-1`,
      image: `${newTokenNumber}.${forgedIsGif ? "gif" : "png"}`,
      attributes: [{ trait_type: "Type", value: "1-of-1" }],
    };

    if (blockchain === "SOL") {
      Object.assign(metadata, {
        symbol: symbol,
        seller_fee_basis_points: 500,
        creators: [{ address: "YOUR_WALLET_ADDRESS", share: 100 }],
      });
    }

    return {
      id: newTokenNumber,
      dna: `forged-${token.id}`,
      imageData: token.imageData,
      metadata,
      isForged: true,
      forgedTokenId: token.id,
      isGif: forgedIsGif,
    };
  });

  // Send forged tokens as first batch
  if (forgedNFTs.length > 0) {
    postMessage({
      type: "batch",
      payload: {
        nfts: forgedNFTs,
        supportsImageCompositing,
      },
    } as WorkerOutputMessage);

    postMessage({
      type: "progress",
      payload: {
        generatedCount: forgedNFTs.length,
        totalCount: collectionSize,
        percentage: (forgedNFTs.length / collectionSize) * 100,
      },
    } as WorkerOutputMessage);
  }

  const usedTokenNumbers = new Set(forgedNFTs.map((t) => t.id));
  const availableNumbers: number[] = shuffledNumbers.filter(
    (num) => !usedTokenNumbers.has(num),
  );
  const usedDNAs = new Set<string>(forgedNFTs.map((t) => t.dna));

  let attempts = 0;
  const maxAttempts = collectionSize * 100;
  let availableIndex = 0;
  let currentBatch: GeneratedNFTData[] = [];
  let totalGenerated = forgedNFTs.length;

  while (
    totalGenerated < collectionSize &&
    attempts < maxAttempts &&
    availableIndex < availableNumbers.length
  ) {
    if (isCancelled) {
      postMessage({
        type: "cancelAck",
      } as WorkerOutputMessage);
      return;
    }

    attempts++;

    // Select traits using weighted random
    const selectedTraits: Record<string, string> = {};
    for (const layer of validLayers) {
      const random = Math.random() * 100;
      let cumulative = 0;
      for (const trait of layer.traits) {
        cumulative += trait.weight;
        if (random <= cumulative) {
          selectedTraits[layer.id] = trait.id;
          break;
        }
      }
    }

    const dna = generateDNA(selectedTraits, layers);
    if (usedDNAs.has(dna)) continue;
    if (!isValidCombination(selectedTraits, rules)) continue;

    usedDNAs.add(dna);

    try {
      const tokenNumber = availableNumbers[availableIndex];
      availableIndex++;

      const imageResult = await generateImage(
        selectedTraits,
        layers,
        pixelArtMode,
      );

      const nftIsGif = imageResult?.isGif ?? false;
      const metadata = createMetadata(
        tokenNumber,
        selectedTraits,
        layers,
        projectName,
        blockchain,
        symbol,
        nftIsGif,
      );

      const nft: GeneratedNFTData = {
        id: tokenNumber,
        dna,
        imageData: imageResult?.dataUrl ?? undefined,
        metadata,
        isForged: false,
        isGif: nftIsGif,
        selectedTraits: imageResult ? undefined : selectedTraits,
      };

      currentBatch.push(nft);
      totalGenerated++;

      postMessage({
        type: "progress",
        payload: {
          generatedCount: totalGenerated,
          totalCount: collectionSize,
          percentage: (totalGenerated / collectionSize) * 100,
        },
      } as WorkerOutputMessage);

      if (currentBatch.length >= batchSize) {
        postMessage({
          type: "batch",
          payload: {
            nfts: currentBatch,
            supportsImageCompositing,
          },
        } as WorkerOutputMessage);
        currentBatch = [];
      }
    } catch (error) {
      console.error("Error generating NFT in worker:", error);
    }
  }

  if (currentBatch.length > 0) {
    postMessage({
      type: "batch",
      payload: {
        nfts: currentBatch,
        supportsImageCompositing,
      },
    } as WorkerOutputMessage);
  }

  postMessage({
    type: "complete",
    payload: {
      totalGenerated,
    },
  } as WorkerOutputMessage);
}

// Message handler
self.onmessage = async (event: MessageEvent<WorkerInputMessage>) => {
  const message = event.data;

  if (message.type === "start") {
    postMessage({
      type: "capability",
      payload: {
        supportsImageCompositing,
      },
    } as WorkerOutputMessage);

    const {
      layers,
      rules,
      forgedTokens,
      collectionSize,
      projectName,
      blockchain,
      symbol,
      pixelArtMode,
      batchSize,
    } = message.payload;

    await generateCollection(
      layers,
      rules,
      forgedTokens,
      collectionSize,
      projectName,
      blockchain,
      symbol,
      pixelArtMode,
      batchSize,
    );
  } else if (message.type === "cancel") {
    isCancelled = true;
  }
};
