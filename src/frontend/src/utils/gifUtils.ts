/**
 * Pure TypeScript GIF utilities — no external dependencies.
 * Implements GIF89a binary parsing and GIF encoding with LZW compression.
 *
 * Exports:
 *   isGifDataUrl         — checks if a data URL is a GIF
 *   extractGifFrames     — parses GIF binary to per-frame ImageData
 *   composeAnimatedGif   — encodes composited frames into animated GIF data URL
 *   hasAnimatedGifTrait  — checks if any trait array item is a GIF
 *   composeFrames        — composites multi-layer frames for animated output
 */

export interface GifFrame {
  imageData: ImageData;
  delay: number; // milliseconds
}

export interface ComposedFrame {
  imageData: ImageData;
  delay: number;
}

// ─── GIF detection ──────────────────────────────────────────────────────────

/**
 * Convert a GIF data URL to a blob: URL so browsers animate it in <img> tags.
 * Browsers do NOT animate GIF data URLs — only blob: URLs animate.
 * Caller is responsible for calling URL.revokeObjectURL() when done.
 */
export function gifDataUrlToBlobUrl(dataUrl: string): string {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "image/gif" });
  return URL.createObjectURL(blob);
}

export function isGifDataUrl(dataUrl: string): boolean {
  if (!dataUrl) return false;
  if (dataUrl.startsWith("data:image/gif")) return true;
  // Check GIF magic bytes in base64 — GIF89a starts with 0x47494638
  // Base64 of "GIF8" = "R0lG8" — first 6 chars of base64 payload
  const prefix = dataUrl.split(",")[1]?.substring(0, 6);
  return prefix === "R0lGO" || prefix === "R0lG8";
}

export function hasAnimatedGifTrait(
  traits: Array<{ imageData: string }>,
): boolean {
  return traits.some((t) => isGifDataUrl(t.imageData));
}

// ─── GIF binary parser ───────────────────────────────────────────────────────

function base64ToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Decode GIF LZW compressed data
function decodeLZW(
  data: Uint8Array,
  startOffset: number,
  minCodeSize: number,
): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eofCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let codeMask = (1 << codeSize) - 1;

  // Build initial code table
  const table: number[][] = [];
  for (let i = 0; i < clearCode; i++) table[i] = [i];
  table[clearCode] = [];
  table[eofCode] = [];
  let nextCode = eofCode + 1;

  // Read bits from sub-blocks
  const bits: number[] = [];
  let readPos = startOffset;
  while (readPos < data.length) {
    const blockSize = data[readPos++];
    if (blockSize === 0) break;
    for (let i = 0; i < blockSize && readPos < data.length; i++) {
      const byteVal = data[readPos++];
      for (let b = 0; b < 8; b++) {
        bits.push((byteVal >> b) & 1);
      }
    }
  }

  const output: number[] = [];
  let bitPos = 0;

  function readCode(): number {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      if (bitPos < bits.length) {
        code |= bits[bitPos++] << i;
      }
    }
    return code;
  }

  // Skip initial clear code
  let code = readCode();
  if (code !== clearCode) return new Uint8Array(0);

  let prevCode = -1;

  while (bitPos < bits.length) {
    code = readCode();
    if (code === eofCode) break;

    if (code === clearCode) {
      // Reset
      table.length = eofCode + 1;
      nextCode = eofCode + 1;
      codeSize = minCodeSize + 1;
      codeMask = (1 << codeSize) - 1;
      prevCode = -1;
      continue;
    }

    let entry: number[];
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

export async function extractGifFrames(dataUrl: string): Promise<GifFrame[]> {
  const data = base64ToUint8Array(dataUrl);

  // Validate GIF header
  if (
    data[0] !== 0x47 ||
    data[1] !== 0x49 ||
    data[2] !== 0x46 ||
    data[3] !== 0x38
  ) {
    throw new Error("Not a valid GIF");
  }

  let offset = 6; // skip "GIF89a" or "GIF87a"

  const logicalWidth = data[offset] | (data[offset + 1] << 8);
  const logicalHeight = data[offset + 2] | (data[offset + 3] << 8);
  const packed = data[offset + 4];
  const hasGlobalCT = (packed >> 7) & 1;
  const globalCTSize = hasGlobalCT ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
  const bgColorIndex = data[offset + 5];
  offset += 7;

  // Parse global color table
  const globalCT: number[][] = [];
  if (hasGlobalCT) {
    const count = globalCTSize / 3;
    for (let i = 0; i < count; i++) {
      globalCT.push([data[offset], data[offset + 1], data[offset + 2]]);
      offset += 3;
    }
  }

  const frames: GifFrame[] = [];

  // Canvas for compositing (GIF frames may be partial / disposal-based)
  const offscreenCanvas = new OffscreenCanvas(logicalWidth, logicalHeight);
  const ctx = offscreenCanvas.getContext("2d")!;

  let frameDelay = 100; // default 100ms
  let transparentColorIndex = -1;
  let disposalMethod = 0;

  // Previous frame backup for disposal method 3
  let prevFrameData: ImageData | null = null;

  while (offset < data.length) {
    const byte = data[offset++];

    if (byte === 0x3b) break; // Trailer

    if (byte === 0x21) {
      // Extension
      const label = data[offset++];

      if (label === 0xf9) {
        // Graphic Control Extension
        offset++; // block size = 4
        const gceFlags = data[offset++];
        disposalMethod = (gceFlags >> 2) & 0x07;
        const hasTransparent = gceFlags & 0x01;
        frameDelay = Math.max(
          50,
          (data[offset] | (data[offset + 1] << 8)) * 10,
        );
        offset += 2;
        transparentColorIndex = hasTransparent ? data[offset++] : -1;
        offset++; // block terminator
      } else {
        // Skip other extensions
        let blockSize = data[offset++];
        while (blockSize > 0) {
          offset += blockSize;
          blockSize = data[offset++];
        }
      }
    } else if (byte === 0x2c) {
      // Image descriptor
      const left = data[offset] | (data[offset + 1] << 8);
      const top = data[offset + 2] | (data[offset + 3] << 8);
      const width = data[offset + 4] | (data[offset + 5] << 8);
      const height = data[offset + 6] | (data[offset + 7] << 8);
      const imgPacked = data[offset + 8];
      const hasLocalCT = (imgPacked >> 7) & 1;
      const isInterlaced = (imgPacked >> 6) & 1;
      const localCTSize = hasLocalCT ? 3 * (1 << ((imgPacked & 0x07) + 1)) : 0;
      offset += 9;

      // Parse local color table (overrides global)
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

      // Save frame start offset for LZW decoding
      const lzwStart = offset;

      // Skip sub-blocks to advance offset
      let blockSize = data[offset++];
      while (blockSize > 0) {
        offset += blockSize;
        if (offset >= data.length) break;
        blockSize = data[offset++];
      }

      // Decode pixel indices
      const pixelIndices = decodeLZW(data, lzwStart, minCodeSize);

      // Handle disposal before drawing
      if (disposalMethod === 2) {
        // Restore to background
        ctx.clearRect(left, top, width, height);
        if (hasGlobalCT && bgColorIndex < globalCT.length) {
          const bg = globalCT[bgColorIndex];
          ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
          ctx.fillRect(left, top, width, height);
        }
      } else if (disposalMethod === 3 && prevFrameData) {
        ctx.putImageData(prevFrameData, 0, 0);
      }

      // Save current state if disposal method 3 will be needed
      prevFrameData =
        disposalMethod === 3
          ? ctx.getImageData(0, 0, logicalWidth, logicalHeight)
          : null;

      // Build RGBA pixel data for this frame region
      const frameImageData = ctx.getImageData(left, top, width, height);
      const pixels = frameImageData.data;

      // Handle interlacing
      const rows: number[] = [];
      if (isInterlaced) {
        const passes = [
          { start: 0, step: 8 },
          { start: 4, step: 8 },
          { start: 2, step: 4 },
          { start: 1, step: 2 },
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
          if (colorIdx === undefined) continue;

          if (colorIdx === transparentColorIndex) {
            // Transparent pixel — skip (leave current canvas pixel)
            continue;
          }

          const color =
            colorIdx < colorTable.length ? colorTable[colorIdx] : [0, 0, 0];
          const pixelPos = (y * width + x) * 4;
          pixels[pixelPos] = color[0];
          pixels[pixelPos + 1] = color[1];
          pixels[pixelPos + 2] = color[2];
          pixels[pixelPos + 3] = 255;
        }
      }

      ctx.putImageData(frameImageData, left, top);

      // Capture full canvas as this frame
      const fullFrameData = ctx.getImageData(0, 0, logicalWidth, logicalHeight);
      frames.push({ imageData: fullFrameData, delay: frameDelay });

      // Reset per-frame state
      transparentColorIndex = -1;
      if (disposalMethod === 2 || disposalMethod === 3) {
        // already handled above
      } else if (disposalMethod === 1) {
        // leave as is
      }
      disposalMethod = 0;
    }
  }

  // Fallback: if parsing failed, use createImageBitmap to render first frame
  if (frames.length === 0) {
    const blob = await fetch(dataUrl).then((r) => r.blob());
    const bmp = await createImageBitmap(blob);
    const fallbackCanvas = new OffscreenCanvas(bmp.width, bmp.height);
    const fCtx = fallbackCanvas.getContext("2d")!;
    fCtx.drawImage(bmp, 0, 0);
    const imgData = fCtx.getImageData(0, 0, bmp.width, bmp.height);
    frames.push({ imageData: imgData, delay: 100 });
    bmp.close();
  }

  return frames;
}

// ─── GIF encoder ─────────────────────────────────────────────────────────────

// LZW encoder for GIF output
function lzwEncode(pixels: number[], colorDepth: number): number[] {
  const minCodeSize = Math.max(2, colorDepth);
  const clearCode = 1 << minCodeSize;
  const eofCode = clearCode + 1;

  // Initialize table
  type CodeTable = Map<string, number>;
  let table: CodeTable = new Map();
  for (let i = 0; i < clearCode + 2; i++) {
    table.set(String(i), i);
  }
  let nextCode = eofCode + 1;
  let codeSize = minCodeSize + 1;

  const codes: number[] = [clearCode];
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
        if (nextCode > 1 << codeSize && codeSize < 12) codeSize++;
      } else {
        // Reset table
        codes.push(clearCode);
        table = new Map();
        for (let j = 0; j < clearCode + 2; j++) table.set(String(j), j);
        nextCode = eofCode + 1;
        codeSize = minCodeSize + 1;
      }

      prefix = String(pix);
    }
  }

  codes.push(table.get(prefix) ?? 0);
  codes.push(eofCode);

  // Pack codes into bytes
  const output: number[] = [minCodeSize];
  let accumulator = 0;
  let bitsInAccum = 0;
  let block: number[] = [];

  function flushBlock() {
    if (block.length > 0) {
      output.push(block.length);
      for (const b of block) output.push(b);
      block = [];
    }
  }

  // Reset codeSize for packing
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
      block.push(accumulator & 0xff);
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
    block.push(accumulator & 0xff);
  }
  flushBlock();
  output.push(0); // block terminator

  return output;
}

// Quantize RGBA ImageData to a palette of up to 256 colors using median-cut
function quantizeFrame(
  imageData: ImageData,
  maxColors: number,
): { palette: number[][]; indices: number[] } {
  const data = imageData.data;
  const pixelCount = data.length / 4;

  // Collect unique colors (up to 32k sample)
  const step = Math.max(1, Math.floor(pixelCount / 32768));
  const colorSet: Map<number, number> = new Map();

  for (let i = 0; i < pixelCount; i += step) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    colorSet.set(key, (colorSet.get(key) || 0) + 1);
  }

  // Build palette via popularity (most-common colors)
  const sorted = [...colorSet.entries()].sort((a, b) => b[1] - a[1]);
  const palette: number[][] = sorted
    .slice(0, maxColors - 1)
    .map(([key]) => [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff]);

  // Add transparent/background entry if palette not full
  if (palette.length < maxColors) {
    palette.push([0, 0, 0]);
  }

  // Pad palette to power-of-2 for GIF
  const colorDepth = Math.ceil(Math.log2(Math.max(2, palette.length)));
  const paletteSize = 1 << colorDepth;
  while (palette.length < paletteSize) palette.push([0, 0, 0]);

  // Map each pixel to nearest palette index
  const indices: number[] = new Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const pr = data[i * 4];
    const pg = data[i * 4 + 1];
    const pb = data[i * 4 + 2];
    const pa = data[i * 4 + 3];

    if (pa < 128) {
      // Treat transparent pixel as last index (we'll set transparent index)
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

function writeUint16LE(arr: number[], val: number) {
  arr.push(val & 0xff, (val >> 8) & 0xff);
}

export async function composeAnimatedGif(
  frames: ComposedFrame[],
  width: number,
  height: number,
): Promise<string> {
  if (frames.length === 0) throw new Error("No frames to encode");

  const maxColors = 256;
  const paletteSize = 256;

  const bytes: number[] = [];

  // ── Quantize first frame to get global palette
  const { palette: globalPalette } = quantizeFrame(
    frames[0].imageData,
    maxColors,
  );
  while (globalPalette.length < paletteSize) globalPalette.push([0, 0, 0]);

  // ── Header
  bytes.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // "GIF89a"

  // Logical screen descriptor
  writeUint16LE(bytes, width);
  writeUint16LE(bytes, height);
  // packed: global CT flag=1, color res=7, sort=0, global CT size = colorDepth-1
  bytes.push(0xf7, 0x00, 0x00); // packed=0b11110111, bg=0, aspect=0

  // Global color table (256 entries)
  for (let i = 0; i < paletteSize; i++) {
    const c = globalPalette[i] || [0, 0, 0];
    bytes.push(c[0], c[1], c[2]);
  }

  // ── Netscape 2.0 Application Extension (for infinite looping)
  bytes.push(0x21, 0xff, 0x0b); // ext + app ext label + block size 11
  // "NETSCAPE2.0"
  bytes.push(0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30);
  bytes.push(0x03, 0x01); // sub-block size 3, sub-block ID 1
  writeUint16LE(bytes, 0); // loop count = 0 (infinite)
  bytes.push(0x00); // block terminator

  // ── Encode each frame
  for (const frame of frames) {
    const { palette, indices } = quantizeFrame(frame.imageData, maxColors);
    while (palette.length < paletteSize) palette.push([0, 0, 0]);

    const transparentIndex = paletteSize - 1;
    const delayCs = Math.max(1, Math.round(frame.delay / 10)); // centiseconds

    // Graphic Control Extension
    bytes.push(0x21, 0xf9, 0x04);
    // packed: disposal=0 (do not dispose), user input=0, transparent=1
    bytes.push(0x01);
    writeUint16LE(bytes, delayCs);
    bytes.push(transparentIndex);
    bytes.push(0x00); // block terminator

    // Image descriptor
    bytes.push(0x2c);
    writeUint16LE(bytes, 0); // left
    writeUint16LE(bytes, 0); // top
    writeUint16LE(bytes, width);
    writeUint16LE(bytes, height);
    // packed: local CT flag=1, interlace=0, sort=0, local CT size = 7 (256 colors)
    bytes.push(0x87);

    // Local color table
    for (let i = 0; i < paletteSize; i++) {
      const c = palette[i] || [0, 0, 0];
      bytes.push(c[0], c[1], c[2]);
    }

    // LZW compressed pixel data
    const pixelColorDepth = 8;
    const lzwData = lzwEncode(Array.from(indices), pixelColorDepth);
    for (const b of lzwData) bytes.push(b);
  }

  // ── Trailer
  bytes.push(0x3b);

  // Convert to base64
  const uint8 = new Uint8Array(bytes);
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < uint8.length; i += CHUNK) {
    binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK));
  }

  return `data:image/gif;base64,${btoa(binary)}`;
}

// ─── Frame compositor ────────────────────────────────────────────────────────

interface LayerImage {
  dataUrl: string;
  isGif: boolean;
  frames?: GifFrame[];
  opacity: number;
  blendMode: string;
}

export async function composeFrames(
  layerImages: LayerImage[],
  outputSize: number,
  pixelArtMode: boolean,
): Promise<ComposedFrame[]> {
  // Determine total frame count from all GIF layers (max frames across all)
  let totalFrames = 1;
  let defaultDelay = 100;

  for (const layer of layerImages) {
    if (layer.isGif && layer.frames && layer.frames.length > 1) {
      totalFrames = Math.max(totalFrames, layer.frames.length);
      defaultDelay = layer.frames[0]?.delay ?? 100;
    }
  }

  const canvas = new OffscreenCanvas(outputSize, outputSize);
  const ctx = canvas.getContext("2d")!;
  if (pixelArtMode) ctx.imageSmoothingEnabled = false;

  // Pre-load all static (non-GIF) layer ImageBitmaps
  const staticBitmaps: Map<string, ImageBitmap> = new Map();
  await Promise.all(
    layerImages
      .filter((l) => !l.isGif)
      .map(async (l) => {
        const response = await fetch(l.dataUrl);
        const blob = await response.blob();
        const bmp = await createImageBitmap(blob);
        staticBitmaps.set(l.dataUrl, bmp);
      }),
  );

  const composedFrames: ComposedFrame[] = [];

  for (let f = 0; f < totalFrames; f++) {
    ctx.clearRect(0, 0, outputSize, outputSize);

    // Draw layers bottom-to-top (reverse index = bottom-first in GIF)
    for (let i = layerImages.length - 1; i >= 0; i--) {
      const layer = layerImages[i];
      ctx.save();
      ctx.globalAlpha = layer.opacity / 100;
      ctx.globalCompositeOperation =
        layer.blendMode as GlobalCompositeOperation;

      if (layer.isGif && layer.frames && layer.frames.length > 0) {
        // Loop GIF frames
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

    // Determine delay for this frame
    let frameDelay = defaultDelay;
    for (const layer of layerImages) {
      if (layer.isGif && layer.frames && layer.frames.length > 0) {
        frameDelay =
          layer.frames[f % layer.frames.length]?.delay ?? defaultDelay;
        break;
      }
    }

    composedFrames.push({ imageData: imgData, delay: frameDelay });
  }

  // Cleanup static bitmaps
  for (const bmp of staticBitmaps.values()) bmp.close();

  return composedFrames;
}
