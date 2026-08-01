import { describe, expect, it } from "vitest";
import { encodeGif, scaleIndices } from "../src/services/gif";

/**
 * A GIF that a browser refuses to play is a silent failure: the download works,
 * the file opens, and the frames are wrong. So the test decodes the bytes back
 * with an independent LZW reader rather than trusting the writer's own tables.
 */
function decodeGif(bytes: Uint8Array): { width: number; height: number; frames: number[][] } {
  let offset = 0;
  const readByte = () => bytes[offset++]!;
  const readShort = () => { const value = bytes[offset]! | (bytes[offset + 1]! << 8); offset += 2; return value; };

  expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe("GIF89a");
  offset = 6;
  const width = readShort();
  const height = readShort();
  const packed = readByte();
  readByte();
  readByte();
  offset += 3 * (1 << ((packed & 0x07) + 1));

  const frames: number[][] = [];
  while (offset < bytes.length) {
    const marker = readByte();
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      readByte();
      let size = readByte();
      while (size !== 0) { offset += size; size = readByte(); }
      continue;
    }
    expect(marker).toBe(0x2c);
    readShort(); readShort(); readShort(); readShort();
    expect(readByte() & 0x80).toBe(0);

    const minCodeSize = readByte();
    const data: number[] = [];
    let size = readByte();
    while (size !== 0) { for (let index = 0; index < size; index += 1) data.push(bytes[offset++]!); size = readByte(); }

    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let table: number[][] = [];
    const resetTable = () => {
      table = [];
      for (let index = 0; index < clearCode; index += 1) table.push([index]);
      table.push([], []);
      codeSize = minCodeSize + 1;
    };
    resetTable();

    const pixels: number[] = [];
    let bitPosition = 0;
    let previous: number[] | undefined;
    const readCode = () => {
      let code = 0;
      for (let bit = 0; bit < codeSize; bit += 1) {
        const byte = data[bitPosition >> 3] ?? 0;
        code |= ((byte >> (bitPosition & 7)) & 1) << bit;
        bitPosition += 1;
      }
      return code;
    };

    while (bitPosition < data.length * 8) {
      const code = readCode();
      if (code === clearCode) { resetTable(); previous = undefined; continue; }
      if (code === endCode) break;
      let entry: number[];
      if (code < table.length && table[code]!.length > 0) entry = table[code]!;
      else if (previous) entry = [...previous, previous[0]!];
      else throw new Error("Invalid GIF code stream");
      pixels.push(...entry);
      if (previous) {
        table.push([...previous, entry[0]!]);
        // The decoder's table is one entry behind the encoder's, so it widens
        // its codes one entry earlier than the encoder does.
        if (table.length === (1 << codeSize) && codeSize < 12) codeSize += 1;
      }
      previous = entry;
    }
    frames.push(pixels.slice(0, width * height));
  }
  return { width, height, frames };
}

function checkerboard(width: number, height: number, offset: number): Uint8Array {
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) indices[y * width + x] = (x + y + offset) % 2;
  return indices;
}

describe("gif writer", () => {
  it("round-trips two-colour frames through its own byte stream", () => {
    const width = 21;
    const height = 21;
    const sources = [checkerboard(width, height, 0), checkerboard(width, height, 1)];
    const blob = encodeGif({
      width, height,
      palette: new Uint8Array([255, 255, 255, 0, 0, 0]),
      frames: sources.map((indices) => ({ indices, delayCs: 4 })),
    });
    expect(blob.type).toBe("image/gif");

    return blob.arrayBuffer().then((buffer) => {
      const decoded = decodeGif(new Uint8Array(buffer));
      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
      expect(decoded.frames).toHaveLength(2);
      decoded.frames.forEach((frame, index) => expect(frame).toEqual(Array.from(sources[index]!)));
    });
  });

  it("round-trips a 256-entry greyscale frame", async () => {
    const width = 64;
    const height = 16;
    const indices = new Uint8Array(width * height);
    for (let index = 0; index < indices.length; index += 1) indices[index] = (index * 37) % 256;
    const palette = new Uint8Array(256 * 3);
    for (let index = 0; index < 256; index += 1) palette.set([index, index, index], index * 3);

    const blob = encodeGif({ width, height, palette, frames: [{ indices, delayCs: 3 }] });
    const decoded = decodeGif(new Uint8Array(await blob.arrayBuffer()));

    expect(decoded.frames[0]).toEqual(Array.from(indices));
  });

  it("writes transparency and can omit the loop extension", async () => {
    const blob = encodeGif({
      width: 2,
      height: 1,
      palette: new Uint8Array([0, 0, 0, 255, 255, 255]),
      frames: [{ indices: new Uint8Array([0, 1]), delayCs: 8, transparentIndex: 0 }],
      loopCount: null,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = String.fromCharCode(...bytes);
    expect(text.includes("NETSCAPE2.0")).toBe(false);
    expect(Array.from(bytes).some((value, index) => value === 0x21 && bytes[index + 1] === 0xf9 && bytes[index + 2] === 0x04 && bytes[index + 3] === 0x09)).toBe(true);
  });

  it("scales each module into a square block", () => {
    const scaled = scaleIndices(new Uint8Array([0, 1, 1, 0]), 2, 2, 2);
    expect(Array.from(scaled)).toEqual([0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0]);
  });
});
