(function() {
  "use strict";
  function isGifDataUrl(dataUrl) {
    var _a;
    if (!dataUrl) return false;
    if (dataUrl.startsWith("data:image/gif")) return true;
    const prefix = (_a = dataUrl.split(",")[1]) == null ? void 0 : _a.substring(0, 6);
    return prefix === "R0lGO" || prefix === "R0lG8";
  }
  function hasAnimatedGifTrait(traits) {
    return traits.some((t) => isGifDataUrl(t.imageData));
  }
  function base64ToUint8Array(dataUrl) {
    const base64 = dataUrl.split(",")[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  function decodeLZW(data, startOffset, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const eofCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let codeMask = (1 << codeSize) - 1;
    const table = [];
    for (let i = 0; i < clearCode; i++) table[i] = [i];
    table[clearCode] = [];
    table[eofCode] = [];
    let nextCode = eofCode + 1;
    const bits = [];
    let readPos = startOffset;
    while (readPos < data.length) {
      const blockSize = data[readPos++];
      if (blockSize === 0) break;
      for (let i = 0; i < blockSize && readPos < data.length; i++) {
        const byteVal = data[readPos++];
        for (let b = 0; b < 8; b++) {
          bits.push(byteVal >> b & 1);
        }
      }
    }
    const output = [];
    let bitPos = 0;
    function readCode() {
      let code2 = 0;
      for (let i = 0; i < codeSize; i++) {
        if (bitPos < bits.length) {
          code2 |= bits[bitPos++] << i;
        }
      }
      return code2;
    }
    let code = readCode();
    if (code !== clearCode) return new Uint8Array(0);
    let prevCode = -1;
    while (bitPos < bits.length) {
      code = readCode();
      if (code === eofCode) break;
      if (code === clearCode) {
        table.length = eofCode + 1;
        nextCode = eofCode + 1;
        codeSize = minCodeSize + 1;
        codeMask = (1 << codeSize) - 1;
        prevCode = -1;
        continue;
      }
      let entry;
      if (code < table.length && table[code].length > 0) {
        entry = table[code];
      } else if (prevCode >= 0 && code === nextCode) {
        const prev = table[prevCode];
        entry = [...prev, prev[0]];
      } else {
        break;
      }
      for (const px of entry) output.push(px);
      if (prevCode >= 0 && nextCode < 4096) {
        const prev = table[prevCode];
        table[nextCode] = [...prev, entry[0]];
        nextCode++;
        if (nextCode > codeMask && codeSize < 12) {
          codeSize++;
          codeMask = (1 << codeSize) - 1;
        }
      }
      prevCode = code;
    }
    return new Uint8Array(output);
  }
  async function extractGifFrames(dataUrl) {
    const data = base64ToUint8Array(dataUrl);
    if (data[0] !== 71 || data[1] !== 73 || data[2] !== 70 || data[3] !== 56) {
      throw new Error("Not a valid GIF");
    }
    let offset = 6;
    const logicalWidth = data[offset] | data[offset + 1] << 8;
    const logicalHeight = data[offset + 2] | data[offset + 3] << 8;
    const packed = data[offset + 4];
    const hasGlobalCT = packed >> 7 & 1;
    const globalCTSize = hasGlobalCT ? 3 * (1 << (packed & 7) + 1) : 0;
    const bgColorIndex = data[offset + 5];
    offset += 7;
    const globalCT = [];
    if (hasGlobalCT) {
      const count = globalCTSize / 3;
      for (let i = 0; i < count; i++) {
        globalCT.push([data[offset], data[offset + 1], data[offset + 2]]);
        offset += 3;
      }
    }
    const frames = [];
    const offscreenCanvas = new OffscreenCanvas(logicalWidth, logicalHeight);
    const ctx = offscreenCanvas.getContext("2d");
    let frameDelay = 100;
    let transparentColorIndex = -1;
    let disposalMethod = 0;
    let prevFrameData = null;
    while (offset < data.length) {
      const byte = data[offset++];
      if (byte === 59) break;
      if (byte === 33) {
        const label = data[offset++];
        if (label === 249) {
          offset++;
          const gceFlags = data[offset++];
          disposalMethod = gceFlags >> 2 & 7;
          const hasTransparent = gceFlags & 1;
          frameDelay = Math.max(
            50,
            (data[offset] | data[offset + 1] << 8) * 10
          );
          offset += 2;
          transparentColorIndex = hasTransparent ? data[offset++] : -1;
          offset++;
        } else {
          let blockSize = data[offset++];
          while (blockSize > 0) {
            offset += blockSize;
            blockSize = data[offset++];
          }
        }
      } else if (byte === 44) {
        const left = data[offset] | data[offset + 1] << 8;
        const top = data[offset + 2] | data[offset + 3] << 8;
        const width = data[offset + 4] | data[offset + 5] << 8;
        const height = data[offset + 6] | data[offset + 7] << 8;
        const imgPacked = data[offset + 8];
        const hasLocalCT = imgPacked >> 7 & 1;
        const isInterlaced = imgPacked >> 6 & 1;
        const localCTSize = hasLocalCT ? 3 * (1 << (imgPacked & 7) + 1) : 0;
        offset += 9;
        let colorTable = globalCT;
        if (hasLocalCT) {
          colorTable = [];
          const count = localCTSize / 3;
          for (let i = 0; i < count; i++) {
            colorTable.push([data[offset], data[offset + 1], data[offset + 2]]);
            offset += 3;
          }
        }
        const minCodeSize = data[offset++];
        const lzwStart = offset;
        let blockSize = data[offset++];
        while (blockSize > 0) {
          offset += blockSize;
          if (offset >= data.length) break;
          blockSize = data[offset++];
        }
        const pixelIndices = decodeLZW(data, lzwStart, minCodeSize);
        if (disposalMethod === 2) {
          ctx.clearRect(left, top, width, height);
          if (hasGlobalCT && bgColorIndex < globalCT.length) {
            const bg = globalCT[bgColorIndex];
            ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
            ctx.fillRect(left, top, width, height);
          }
        } else if (disposalMethod === 3 && prevFrameData) {
          ctx.putImageData(prevFrameData, 0, 0);
        }
        prevFrameData = disposalMethod === 3 ? ctx.getImageData(0, 0, logicalWidth, logicalHeight) : null;
        const frameImageData = ctx.getImageData(left, top, width, height);
        const pixels = frameImageData.data;
        const rows = [];
        if (isInterlaced) {
          const passes = [
            { start: 0, step: 8 },
            { start: 4, step: 8 },
            { start: 2, step: 4 },
            { start: 1, step: 2 }
          ];
          for (const pass of passes) {
            for (let y = pass.start; y < height; y += pass.step) {
              rows.push(y);
            }
          }
        } else {
          for (let y = 0; y < height; y++) rows.push(y);
        }
        let pIdx = 0;
        for (const y of rows) {
          for (let x = 0; x < width; x++) {
            const colorIdx = pixelIndices[pIdx++];
            if (colorIdx === void 0) continue;
            if (colorIdx === transparentColorIndex) {
              continue;
            }
            const color = colorIdx < colorTable.length ? colorTable[colorIdx] : [0, 0, 0];
            const pixelPos = (y * width + x) * 4;
            pixels[pixelPos] = color[0];
            pixels[pixelPos + 1] = color[1];
            pixels[pixelPos + 2] = color[2];
            pixels[pixelPos + 3] = 255;
          }
        }
        ctx.putImageData(frameImageData, left, top);
        const fullFrameData = ctx.getImageData(0, 0, logicalWidth, logicalHeight);
        frames.push({ imageData: fullFrameData, delay: frameDelay });
        transparentColorIndex = -1;
        disposalMethod = 0;
      }
    }
    if (frames.length === 0) {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const bmp = await createImageBitmap(blob);
      const fallbackCanvas = new OffscreenCanvas(bmp.width, bmp.height);
      const fCtx = fallbackCanvas.getContext("2d");
      fCtx.drawImage(bmp, 0, 0);
      const imgData = fCtx.getImageData(0, 0, bmp.width, bmp.height);
      frames.push({ imageData: imgData, delay: 100 });
      bmp.close();
    }
    return frames;
  }
  function lzwEncode(pixels, colorDepth) {
    const minCodeSize = Math.max(2, colorDepth);
    const clearCode = 1 << minCodeSize;
    const eofCode = clearCode + 1;
    let table = /* @__PURE__ */ new Map();
    for (let i = 0; i < clearCode + 2; i++) {
      table.set(String(i), i);
    }
    let nextCode = eofCode + 1;
    const codes = [clearCode];
    let prefix = String(pixels[0] ?? 0);
    for (let i = 1; i < pixels.length; i++) {
      const pix = pixels[i];
      const next = `${prefix},${pix}`;
      if (table.has(next)) {
        prefix = next;
      } else {
        codes.push(table.get(prefix) ?? 0);
        if (nextCode <= 4095) {
          table.set(next, nextCode++);
        } else {
          codes.push(clearCode);
          table = /* @__PURE__ */ new Map();
          for (let j = 0; j < clearCode + 2; j++) table.set(String(j), j);
          nextCode = eofCode + 1;
        }
        prefix = String(pix);
      }
    }
    codes.push(table.get(prefix) ?? 0);
    codes.push(eofCode);
    const output = [minCodeSize];
    let accumulator = 0;
    let bitsInAccum = 0;
    let block = [];
    function flushBlock() {
      if (block.length > 0) {
        output.push(block.length);
        for (const b of block) output.push(b);
        block = [];
      }
    }
    let packCodeSize = minCodeSize + 1;
    let packNextCode = eofCode + 1;
    const packClearCode = clearCode;
    let seenClear = false;
    for (const code of codes) {
      if (code === packClearCode) {
        if (!seenClear) {
          seenClear = true;
        } else {
          packCodeSize = minCodeSize + 1;
          packNextCode = eofCode + 1;
        }
      }
      accumulator |= code << bitsInAccum;
      bitsInAccum += packCodeSize;
      while (bitsInAccum >= 8) {
        block.push(accumulator & 255);
        accumulator >>= 8;
        bitsInAccum -= 8;
        if (block.length === 255) flushBlock();
      }
      if (code !== packClearCode && code !== eofCode) {
        packNextCode++;
        if (packNextCode > 1 << packCodeSize && packCodeSize < 12) {
          packCodeSize++;
        }
      }
    }
    if (bitsInAccum > 0) {
      block.push(accumulator & 255);
    }
    flushBlock();
    output.push(0);
    return output;
  }
  function quantizeFrame(imageData, maxColors) {
    const data = imageData.data;
    const pixelCount = data.length / 4;
    const step = Math.max(1, Math.floor(pixelCount / 32768));
    const colorSet = /* @__PURE__ */ new Map();
    for (let i = 0; i < pixelCount; i += step) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const key = r << 16 | g << 8 | b;
      colorSet.set(key, (colorSet.get(key) || 0) + 1);
    }
    const sorted = [...colorSet.entries()].sort((a, b) => b[1] - a[1]);
    const palette = sorted.slice(0, maxColors - 1).map(([key]) => [key >> 16 & 255, key >> 8 & 255, key & 255]);
    if (palette.length < maxColors) {
      palette.push([0, 0, 0]);
    }
    const colorDepth = Math.ceil(Math.log2(Math.max(2, palette.length)));
    const paletteSize = 1 << colorDepth;
    while (palette.length < paletteSize) palette.push([0, 0, 0]);
    const indices = new Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const pr = data[i * 4];
      const pg = data[i * 4 + 1];
      const pb = data[i * 4 + 2];
      const pa = data[i * 4 + 3];
      if (pa < 128) {
        indices[i] = paletteSize - 1;
        continue;
      }
      let bestIdx = 0;
      let bestDist = Number.MAX_VALUE;
      for (let j = 0; j < palette.length - 1; j++) {
        const dr = pr - palette[j][0];
        const dg = pg - palette[j][1];
        const db = pb - palette[j][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = j;
        }
      }
      indices[i] = bestIdx;
    }
    return { palette, indices };
  }
  function writeUint16LE(arr, val) {
    arr.push(val & 255, val >> 8 & 255);
  }
  async function composeAnimatedGif(frames, width, height) {
    if (frames.length === 0) throw new Error("No frames to encode");
    const maxColors = 256;
    const paletteSize = 256;
    const bytes = [];
    const { palette: globalPalette } = quantizeFrame(
      frames[0].imageData,
      maxColors
    );
    while (globalPalette.length < paletteSize) globalPalette.push([0, 0, 0]);
    bytes.push(71, 73, 70, 56, 57, 97);
    writeUint16LE(bytes, width);
    writeUint16LE(bytes, height);
    bytes.push(247, 0, 0);
    for (let i = 0; i < paletteSize; i++) {
      const c = globalPalette[i] || [0, 0, 0];
      bytes.push(c[0], c[1], c[2]);
    }
    bytes.push(33, 255, 11);
    bytes.push(78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48);
    bytes.push(3, 1);
    writeUint16LE(bytes, 0);
    bytes.push(0);
    for (const frame of frames) {
      const { palette, indices } = quantizeFrame(frame.imageData, maxColors);
      while (palette.length < paletteSize) palette.push([0, 0, 0]);
      const transparentIndex = paletteSize - 1;
      const delayCs = Math.max(1, Math.round(frame.delay / 10));
      bytes.push(33, 249, 4);
      bytes.push(1);
      writeUint16LE(bytes, delayCs);
      bytes.push(transparentIndex);
      bytes.push(0);
      bytes.push(44);
      writeUint16LE(bytes, 0);
      writeUint16LE(bytes, 0);
      writeUint16LE(bytes, width);
      writeUint16LE(bytes, height);
      bytes.push(135);
      for (let i = 0; i < paletteSize; i++) {
        const c = palette[i] || [0, 0, 0];
        bytes.push(c[0], c[1], c[2]);
      }
      const pixelColorDepth = 8;
      const lzwData = lzwEncode(Array.from(indices), pixelColorDepth);
      for (const b of lzwData) bytes.push(b);
    }
    bytes.push(59);
    const uint8 = new Uint8Array(bytes);
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < uint8.length; i += CHUNK) {
      binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK));
    }
    return `data:image/gif;base64,${btoa(binary)}`;
  }
  async function composeFrames(layerImages, outputSize, pixelArtMode) {
    var _a, _b;
    let totalFrames = 1;
    let defaultDelay = 100;
    for (const layer of layerImages) {
      if (layer.isGif && layer.frames && layer.frames.length > 1) {
        totalFrames = Math.max(totalFrames, layer.frames.length);
        defaultDelay = ((_a = layer.frames[0]) == null ? void 0 : _a.delay) ?? 100;
      }
    }
    const canvas = new OffscreenCanvas(outputSize, outputSize);
    const ctx = canvas.getContext("2d");
    if (pixelArtMode) ctx.imageSmoothingEnabled = false;
    const staticBitmaps = /* @__PURE__ */ new Map();
    await Promise.all(
      layerImages.filter((l) => !l.isGif).map(async (l) => {
        const response = await fetch(l.dataUrl);
        const blob = await response.blob();
        const bmp = await createImageBitmap(blob);
        staticBitmaps.set(l.dataUrl, bmp);
      })
    );
    const composedFrames = [];
    for (let f = 0; f < totalFrames; f++) {
      ctx.clearRect(0, 0, outputSize, outputSize);
      for (let i = layerImages.length - 1; i >= 0; i--) {
        const layer = layerImages[i];
        ctx.save();
        ctx.globalAlpha = layer.opacity / 100;
        ctx.globalCompositeOperation = layer.blendMode;
        if (layer.isGif && layer.frames && layer.frames.length > 0) {
          const gifFrame = layer.frames[f % layer.frames.length];
          const frameBmp = await createImageBitmap(gifFrame.imageData);
          ctx.drawImage(frameBmp, 0, 0, outputSize, outputSize);
          frameBmp.close();
        } else {
          const bmp = staticBitmaps.get(layer.dataUrl);
          if (bmp) {
            ctx.drawImage(bmp, 0, 0, outputSize, outputSize);
          }
        }
        ctx.restore();
      }
      const imgData = ctx.getImageData(0, 0, outputSize, outputSize);
      let frameDelay = defaultDelay;
      for (const layer of layerImages) {
        if (layer.isGif && layer.frames && layer.frames.length > 0) {
          frameDelay = ((_b = layer.frames[f % layer.frames.length]) == null ? void 0 : _b.delay) ?? defaultDelay;
          break;
        }
      }
      composedFrames.push({ imageData: imgData, delay: frameDelay });
    }
    for (const bmp of staticBitmaps.values()) bmp.close();
    return composedFrames;
  }
  let isCancelled = false;
  let supportsImageCompositing = false;
  function detectImageCompositing() {
    try {
      if (typeof OffscreenCanvas === "undefined") return false;
      if (typeof createImageBitmap === "undefined") return false;
      return true;
    } catch {
      return false;
    }
  }
  supportsImageCompositing = detectImageCompositing();
  function generateDNA(traits, layers) {
    return layers.map((layer) => traits[layer.id] || "").join("-");
  }
  function isValidCombination(traits, rules) {
    for (const rule of rules) {
      const hasPrimary = traits[rule.primaryTrait.layerId] === rule.primaryTrait.traitId;
      if (!hasPrimary) continue;
      for (const incompatibleTrait of rule.incompatibleTraits) {
        const hasIncompatible = traits[incompatibleTrait.layerId] === incompatibleTrait.traitId;
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
  async function loadImage(dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return createImageBitmap(blob);
  }
  async function generateImage(traits, layers, pixelArtMode) {
    if (!supportsImageCompositing) {
      return null;
    }
    try {
      const activeTraits = [];
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
          blendMode: layer.blendMode
        });
      }
      const anyGif = hasAnimatedGifTrait(
        activeTraits.map((t) => ({ imageData: t.dataUrl }))
      );
      if (anyGif) {
        const layerImages = await Promise.all(
          activeTraits.map(async (t) => {
            if (t.isGif) {
              const frames = await extractGifFrames(t.dataUrl);
              return { ...t, frames };
            }
            return { ...t, frames: void 0 };
          })
        );
        const composed = await composeFrames(layerImages, 800, pixelArtMode);
        const gifDataUrl = await composeAnimatedGif(composed, 800, 800);
        return { dataUrl: gifDataUrl, isGif: true };
      }
      const canvas = new OffscreenCanvas(800, 800);
      const ctx = canvas.getContext("2d", {
        alpha: true,
        willReadFrequently: false
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
        ctx.globalCompositeOperation = layer.blendMode;
        ctx.drawImage(img, 0, 0, 800, 800);
        ctx.restore();
      }
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve) => {
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      return { dataUrl, isGif: false };
    } catch (error) {
      console.error("Worker image generation error:", error);
      return null;
    }
  }
  function createMetadata(id, traits, layers, projectName, blockchain, symbol, isGif) {
    const attributes = layers.filter((l) => traits[l.id]).map((layer) => {
      const trait = layer.traits.find((t) => t.id === traits[layer.id]);
      return {
        trait_type: layer.name,
        value: (trait == null ? void 0 : trait.name) || "Unknown"
      };
    });
    const ext = isGif ? "gif" : "png";
    const baseMetadata = {
      name: `${projectName} #${id}`,
      description: `${projectName} NFT Collection`,
      image: `${id}.${ext}`,
      attributes
    };
    if (blockchain === "SOL") {
      return {
        ...baseMetadata,
        symbol,
        seller_fee_basis_points: 500,
        creators: [
          {
            address: "YOUR_WALLET_ADDRESS",
            share: 100
          }
        ]
      };
    }
    return baseMetadata;
  }
  async function generateCollection(layers, rules, forgedTokens, collectionSize, projectName, blockchain, symbol, pixelArtMode, batchSize) {
    isCancelled = false;
    const validLayers = layers.filter((l) => l.traits.length > 0);
    if (validLayers.length === 0) {
      postMessage({
        type: "error",
        payload: { message: "No valid layers found" }
      });
      return;
    }
    const allTokenNumbers = [];
    for (let i = 1; i <= collectionSize; i++) {
      allTokenNumbers.push(i);
    }
    const shuffledNumbers = [...allTokenNumbers].sort(() => Math.random() - 0.5);
    const forgedNFTs = forgedTokens.map((token, index) => {
      const newTokenNumber = shuffledNumbers[index];
      const forgedIsGif = isGifDataUrl(token.imageData);
      const metadata = {
        name: `${projectName} #${newTokenNumber}`,
        description: `${projectName} - Custom 1-of-1`,
        image: `${newTokenNumber}.${forgedIsGif ? "gif" : "png"}`,
        attributes: [{ trait_type: "Type", value: "1-of-1" }]
      };
      if (blockchain === "SOL") {
        Object.assign(metadata, {
          symbol,
          seller_fee_basis_points: 500,
          creators: [{ address: "YOUR_WALLET_ADDRESS", share: 100 }]
        });
      }
      return {
        id: newTokenNumber,
        dna: `forged-${token.id}`,
        imageData: token.imageData,
        metadata,
        isForged: true,
        forgedTokenId: token.id,
        isGif: forgedIsGif
      };
    });
    if (forgedNFTs.length > 0) {
      postMessage({
        type: "batch",
        payload: {
          nfts: forgedNFTs,
          supportsImageCompositing
        }
      });
      postMessage({
        type: "progress",
        payload: {
          generatedCount: forgedNFTs.length,
          totalCount: collectionSize,
          percentage: forgedNFTs.length / collectionSize * 100
        }
      });
    }
    const usedTokenNumbers = new Set(forgedNFTs.map((t) => t.id));
    const availableNumbers = shuffledNumbers.filter(
      (num) => !usedTokenNumbers.has(num)
    );
    const usedDNAs = new Set(forgedNFTs.map((t) => t.dna));
    let attempts = 0;
    const maxAttempts = collectionSize * 100;
    let availableIndex = 0;
    let currentBatch = [];
    let totalGenerated = forgedNFTs.length;
    while (totalGenerated < collectionSize && attempts < maxAttempts && availableIndex < availableNumbers.length) {
      if (isCancelled) {
        postMessage({
          type: "cancelAck"
        });
        return;
      }
      attempts++;
      const selectedTraits = {};
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
          pixelArtMode
        );
        const nftIsGif = (imageResult == null ? void 0 : imageResult.isGif) ?? false;
        const metadata = createMetadata(
          tokenNumber,
          selectedTraits,
          layers,
          projectName,
          blockchain,
          symbol,
          nftIsGif
        );
        const nft = {
          id: tokenNumber,
          dna,
          imageData: (imageResult == null ? void 0 : imageResult.dataUrl) ?? void 0,
          metadata,
          isForged: false,
          isGif: nftIsGif,
          selectedTraits: imageResult ? void 0 : selectedTraits
        };
        currentBatch.push(nft);
        totalGenerated++;
        postMessage({
          type: "progress",
          payload: {
            generatedCount: totalGenerated,
            totalCount: collectionSize,
            percentage: totalGenerated / collectionSize * 100
          }
        });
        if (currentBatch.length >= batchSize) {
          postMessage({
            type: "batch",
            payload: {
              nfts: currentBatch,
              supportsImageCompositing
            }
          });
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
          supportsImageCompositing
        }
      });
    }
    postMessage({
      type: "complete",
      payload: {
        totalGenerated
      }
    });
  }
  self.onmessage = async (event) => {
    const message = event.data;
    if (message.type === "start") {
      postMessage({
        type: "capability",
        payload: {
          supportsImageCompositing
        }
      });
      const {
        layers,
        rules,
        forgedTokens,
        collectionSize,
        projectName,
        blockchain,
        symbol,
        pixelArtMode,
        batchSize
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
        batchSize
      );
    } else if (message.type === "cancel") {
      isCancelled = true;
    }
  };
})();
