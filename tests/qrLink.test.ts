import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareZXingModule as prepareReader, readBarcodes } from "zxing-wasm/reader";
import { prepareZXingModule as prepareWriter, writeBarcode } from "zxing-wasm/writer";
import { PROFILES } from "../src/config/policy";
import { buildFrameHeader, FRAME_HEADER_LENGTH, packFrame, parseFrame } from "../src/protocol/frame";

function sampleBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  for (let index = 0; index < length; index += 1) bytes[index] = (index * 131 + 7) % 256;
  return bytes;
}

function localWasm(relativePath: string): ArrayBuffer {
  const bytes = readFileSync(new URL(relativePath, import.meta.url));
  return Uint8Array.from(bytes).buffer;
}

beforeAll(() => {
  // Vitest runs in Node, where zxing-wasm cannot fetch its browser asset URL.
  // Point both physical-layer halves at the exact pinned package binaries so
  // this test exercises the real writer and reader instead of a mock.
  prepareReader({ overrides: { wasmBinary: localWasm("../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm") } });
  prepareWriter({ overrides: { wasmBinary: localWasm("../node_modules/zxing-wasm/dist/writer/zxing_writer.wasm") } });
});

// The QR symbol is the physical layer. Everything above it is covered by unit
// tests, but nothing checked that a full frame actually survives byte-mode
// encoding and decoding, which is where a silent text/binary coercion would
// corrupt every transfer.
describe("optical link", () => {
  it("carries standard and high-density binary frames through QR unchanged", async () => {
    for (const profile of ["conservative", "high-density"] as const) {
      const blockSize = PROFILES[profile].sourceBlockSize;
      const transferId = sampleBytes(16);
      const block = sampleBytes(blockSize);
      const encodedLength = 49_180;
      const frame = packFrame(
        buildFrameHeader({ transferId, generationId: 3, generationCount: 7, sequence: 41, sourceBlockCount: Math.ceil(encodedLength / blockSize), sourceBlockSize: blockSize, encodedLength, plainLength: 49_152 }),
        block,
      );
      expect(frame.length).toBe(FRAME_HEADER_LENGTH + blockSize);

      const written = await writeBarcode(frame, { format: "QRCode", options: "ecLevel=L", scale: 4, addQuietZones: true });
      expect(written.error).toBeFalsy();
      expect(written.image).toBeTruthy();

      const rendered = new Uint8Array(await written.image!.arrayBuffer());
      const results = await readBarcodes(new Blob([rendered]), { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 1 });
      expect(results).toHaveLength(1);

      const decoded = results[0]!.bytes;
      expect(decoded).toBeInstanceOf(Uint8Array);
      expect(Array.from(decoded!)).toEqual(Array.from(frame));

      const parsed = parseFrame(new Uint8Array(decoded!), transferId);
      expect(parsed).not.toBeNull();
      expect(parsed!.header.sequence).toBe(41);
      expect(parsed!.header.generationId).toBe(3);
      expect(Array.from(parsed!.block)).toEqual(Array.from(block));
    }
  }, 120_000);
});
