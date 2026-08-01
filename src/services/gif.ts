/**
 * Minimal GIF89a writer. Frames arrive as palette indices, one byte per pixel.
 *
 * The sender already produces exactly that shape: a QR symbol is a two-colour
 * index map and a QRStatic frame is a grey ramp, so nothing here needs to
 * quantise or dither.
 */

export interface GifFrame {
  /** One palette index per pixel, width * height bytes. */
  indices: Uint8Array;
  /** Hundredths of a second to hold this frame. */
  delayCs: number;
  /** Palette entry used for transparent pixels. */
  transparentIndex?: number;
}

export interface GifOptions {
  width: number;
  height: number;
  /** RGB triples, at most 256 entries. */
  palette: Uint8Array;
  frames: GifFrame[];
  /** 0 loops forever. Null plays once without a loop extension. */
  loopCount?: number | null;
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private buffer = new Uint8Array(4096);
  private length = 0;

  byte(value: number): void {
    if (this.length === this.buffer.length) this.flush();
    this.buffer[this.length++] = value & 0xff;
  }

  bytes(values: ArrayLike<number>): void {
    for (let index = 0; index < values.length; index += 1) this.byte(values[index]!);
  }

  short(value: number): void {
    this.byte(value & 0xff);
    this.byte((value >> 8) & 0xff);
  }

  ascii(value: string): void {
    for (let index = 0; index < value.length; index += 1) this.byte(value.charCodeAt(index));
  }

  private flush(): void {
    if (this.length === 0) return;
    this.chunks.push(this.buffer.subarray(0, this.length).slice());
    this.length = 0;
  }

  toBlob(type: string): Blob {
    this.flush();
    return new Blob(this.chunks as BlobPart[], { type });
  }
}

/** GIF packs LZW codes least-significant-bit first into 255-byte sub-blocks. */
class LzwPacker {
  private readonly block = new Uint8Array(255);
  private blockLength = 0;
  private accumulator = 0;
  private bitCount = 0;

  constructor(private readonly writer: ByteWriter) {}

  write(code: number, codeSize: number): void {
    this.accumulator |= code << this.bitCount;
    this.bitCount += codeSize;
    while (this.bitCount >= 8) {
      this.pushByte(this.accumulator & 0xff);
      this.accumulator >>= 8;
      this.bitCount -= 8;
    }
  }

  finish(): void {
    if (this.bitCount > 0) this.pushByte(this.accumulator & 0xff);
    if (this.blockLength > 0) {
      this.writer.byte(this.blockLength);
      this.writer.bytes(this.block.subarray(0, this.blockLength));
      this.blockLength = 0;
    }
    this.writer.byte(0);
  }

  private pushByte(value: number): void {
    this.block[this.blockLength++] = value;
    if (this.blockLength === 255) {
      this.writer.byte(255);
      this.writer.bytes(this.block);
      this.blockLength = 0;
    }
  }
}

function writeLzwImage(writer: ByteWriter, indices: Uint8Array, minCodeSize: number): void {
  writer.byte(minCodeSize);
  const packer = new LzwPacker(writer);
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dictionary = new Map<number, number>();

  packer.write(clearCode, codeSize);
  let prefix = indices[0] ?? 0;

  for (let index = 1; index < indices.length; index += 1) {
    const value = indices[index]!;
    const key = (prefix << 8) | value;
    const existing = dictionary.get(key);
    if (existing !== undefined) {
      prefix = existing;
      continue;
    }
    packer.write(prefix, codeSize);
    if (nextCode < 4096) {
      dictionary.set(key, nextCode);
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
      nextCode += 1;
    } else {
      packer.write(clearCode, codeSize);
      dictionary = new Map();
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    }
    prefix = value;
  }

  packer.write(prefix, codeSize);
  packer.write(endCode, codeSize);
  packer.finish();
}

function paletteBits(entries: number): number {
  let bits = 1;
  while ((1 << bits) < entries) bits += 1;
  return Math.min(8, Math.max(1, bits));
}

export function encodeGif({ width, height, palette, frames, loopCount = 0 }: GifOptions): Blob {
  if (frames.length === 0) throw new Error("A GIF file must have one frame or more");
  const entries = palette.length / 3;
  if (entries < 2 || entries > 256) throw new Error("A GIF palette must have 2 to 256 colours");

  const bits = paletteBits(entries);
  const tableSize = 1 << bits;
  const writer = new ByteWriter();

  writer.ascii("GIF89a");
  writer.short(width);
  writer.short(height);
  writer.byte(0xf0 | (bits - 1)); // global colour table, 8 bits per channel
  writer.byte(0); // background colour index
  writer.byte(0); // no pixel aspect ratio
  for (let index = 0; index < tableSize; index += 1) {
    writer.byte(palette[index * 3] ?? 0);
    writer.byte(palette[index * 3 + 1] ?? 0);
    writer.byte(palette[index * 3 + 2] ?? 0);
  }

  if (loopCount !== null) {
    // Netscape looping extension.
    writer.ascii("!\xff\x0bNETSCAPE2.0");
    writer.byte(3);
    writer.byte(1);
    writer.short(loopCount);
    writer.byte(0);
  }

  // LZW needs at least two bits per code even for a two-colour image.
  const minCodeSize = Math.max(2, bits);

  for (const frame of frames) {
    if (frame.indices.length !== width * height) throw new Error("A GIF frame does not agree with the given size");
    writer.ascii("!\xf9\x04");
    // These are full, composited frames. Restore the background before the
    // next one and preserve transparent pixels when the source has them.
    writer.byte(frame.transparentIndex === undefined ? 0 : 0x09);
    writer.short(Math.max(0, Math.round(frame.delayCs)));
    writer.byte(frame.transparentIndex ?? 0);
    writer.byte(0);

    writer.byte(0x2c); // image descriptor
    writer.short(0);
    writer.short(0);
    writer.short(width);
    writer.short(height);
    writer.byte(0); // no local colour table, not interlaced
    writeLzwImage(writer, frame.indices, minCodeSize);
  }

  writer.byte(0x3b);
  return writer.toBlob("image/gif");
}

/** Repeats each source pixel `scale` times in both directions. */
export function scaleIndices(indices: Uint8Array, width: number, height: number, scale: number): Uint8Array {
  if (scale <= 1) return indices;
  const output = new Uint8Array(width * scale * height * scale);
  const rowWidth = width * scale;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * scale * rowWidth;
    for (let x = 0; x < width; x += 1) {
      const value = indices[y * width + x]!;
      const columnStart = x * scale;
      for (let dx = 0; dx < scale; dx += 1) output[rowStart + columnStart + dx] = value;
    }
    const firstRow = output.subarray(rowStart, rowStart + rowWidth);
    for (let dy = 1; dy < scale; dy += 1) output.set(firstRow, rowStart + dy * rowWidth);
  }
  return output;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
