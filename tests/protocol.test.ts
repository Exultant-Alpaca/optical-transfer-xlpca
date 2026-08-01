import { describe, expect, it } from "vitest";
import { buildFrameHeader, packFrame, parseFrame } from "../src/protocol/frame";
import { FountainDecoder, FountainEncoder, fountainSeed } from "../src/protocol/fountain";
import { sanitizeFilename, sanitizeMime } from "../src/services/fileProcessing";
import { FOUNTAIN_OVERHEAD, MAX_SOURCE_BLOCK_SIZE, PROFILES, frameIntervalMs, mayCarryAlpha, supportsCompression, supportsImageRecoding, supportsMediaRecoding } from "../src/config/policy";

function sampleBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  for (let index = 0; index < length; index += 1) bytes[index] = (index * 31 + 7) % 256;
  return bytes;
}

describe("bounded binary frame protocol", () => {
  it("round-trips a frame and rejects a modified CRC", () => {
    const transferId = sampleBytes(16);
    const block = sampleBytes(64);
    const frame = packFrame(buildFrameHeader({ transferId, generationId: 0, generationCount: 1, sequence: 4, sourceBlockCount: 3, sourceBlockSize: 64, encodedLength: 160, plainLength: 130 }), block);
    const parsed = parseFrame(frame, transferId);
    expect(parsed?.header.sequence).toBe(4);
    expect(parsed?.block).toEqual(block);
    frame[frame.length - 1] = frame[frame.length - 1]! ^ 0xff;
    expect(parseFrame(frame, transferId)).toBeNull();
  });

  it("ignores foreign transfer IDs and excessive source block counts", () => {
    const transferId = sampleBytes(16);
    const frame = packFrame(buildFrameHeader({ transferId, generationId: 0, generationCount: 1, sequence: 1, sourceBlockCount: 2, sourceBlockSize: 64, encodedLength: 128, plainLength: 100 }), sampleBytes(64));
    const foreignId = sampleBytes(16);
    foreignId[0] = foreignId[0]! ^ 0xff;
    expect(parseFrame(frame, foreignId)).toBeNull();
    const tampered = frame.slice();
    new DataView(tampered.buffer).setUint32(30, 40_001, true);
    new DataView(tampered.buffer).setUint32(44, 0, true);
    expect(parseFrame(tampered)).toBeNull();
  });
});

describe("deterministic LT fountain transport", () => {
  it("produces the same sequence on both ends and reconstructs out of order", () => {
    const payload = sampleBytes(1_280);
    const transferId = sampleBytes(16);
    const seed = fountainSeed(transferId, 2);
    const sender = new FountainEncoder(payload, 64, seed);
    const receiver = new FountainDecoder(sender.blockCount, 64, seed, payload.length);
    const frames = Array.from({ length: 220 }, (_, sequence) => ({ sequence, block: sender.encode(sequence) }));
    expect(sender.encode(17)).toEqual(frames[17]!.block);
    for (const frame of frames.reverse()) receiver.add(frame.sequence, frame.block);
    expect(receiver.complete).toBe(true);
    expect(receiver.assemble()).toEqual(payload);
    receiver.add(17, sender.encode(17));
    expect(receiver.duplicates).toBe(1);
  });
});

describe("transmission profiles", () => {
  it("keeps every profile block size word aligned", () => {
    // The fountain codec partitions source blocks as 32-bit words, so a block
    // size that is not a multiple of 4 would misalign reassembly rather than
    // fail, and every transfer would silently corrupt past the first block.
    for (const profile of Object.values(PROFILES)) {
      expect(profile.sourceBlockSize % 4).toBe(0);
      expect(profile.framesPerSecond).toBeGreaterThan(0);
    }
    // The interval must stay exact. Rounding 1000/60 up to 17 ms would put the
    // deadline past a 16.67 ms animation frame, so the sender would paint on
    // every second tick and run at half the rate it reports.
    for (const name of Object.keys(PROFILES) as Array<keyof typeof PROFILES>) {
      expect(frameIntervalMs(name) * PROFILES[name].framesPerSecond).toBe(1_000);
      expect(PROFILES[name].sourceBlockSize).toBeLessThanOrEqual(MAX_SOURCE_BLOCK_SIZE);
    }
  });

  it("rejects a block size the codec cannot partition", () => {
    expect(() => new FountainEncoder(sampleBytes(128), 66, 1)).toThrow(/multiple of 4/);
    expect(() => new FountainDecoder(2, 66, 1, 128)).toThrow(/multiple of 4/);
    const frame = packFrame(buildFrameHeader({ transferId: sampleBytes(16), generationId: 0, generationCount: 1, sequence: 0, sourceBlockCount: 2, sourceBlockSize: 66, encodedLength: 132, plainLength: 100 }), sampleBytes(66));
    expect(parseFrame(frame)).toBeNull();
  });

  it("plans for the fountain overhead the codec actually needs", () => {
    // Guards the sender's time estimate against drifting away from reality.
    let worst = 0;
    for (let trial = 0; trial < 24; trial += 1) {
      const transferId = sampleBytes(16);
      transferId[0] = trial;
      const seed = fountainSeed(transferId, trial % 4);
      const encoder = new FountainEncoder(sampleBytes(49_180), 720, seed);
      const decoder = new FountainDecoder(encoder.blockCount, 720, seed, 49_180);
      let sequence = 0;
      while (!decoder.complete && sequence < 10_000) { decoder.add(sequence, encoder.encode(sequence)); sequence += 1; }
      expect(decoder.complete).toBe(true);
      worst = Math.max(worst, sequence / encoder.blockCount);
    }
    expect(worst).toBeLessThanOrEqual(FOUNTAIN_OVERHEAD * 1.35);
  });
});

describe("image recoding policy", () => {
  it("only offers to re-encode still raster images", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/avif"]) {
      expect(supportsImageRecoding(mime)).toBe(true);
    }
    // GIF uses a separate media path. Video is not re-encoded.
    for (const mime of ["image/gif", "image/svg+xml", "application/pdf", "video/mp4", "text/plain", ""]) {
      expect(supportsImageRecoding(mime)).toBe(false);
    }
  });

  it("offers optional media controls only for photos and GIFs", () => {
    for (const mime of ["image/jpeg", "image/gif"]) {
      expect(supportsMediaRecoding(mime)).toBe(true);
    }
    for (const mime of ["image/svg+xml", "application/pdf", "video/mp4", "video/quicktime", "video/webm", "audio/mpeg", "text/plain", ""]) {
      expect(supportsMediaRecoding(mime)).toBe(false);
    }
  });

  it("knows which sources a JPEG fallback would flatten", () => {
    for (const mime of ["image/png", "image/webp", "image/gif", "image/avif"]) {
      expect(mayCarryAlpha(mime)).toBe(true);
    }
    expect(mayCarryAlpha("image/jpeg")).toBe(false);
  });

  it("still refuses gzip on the re-encoded output", () => {
    // WebP is already entropy coded, so the gzip stage must skip it exactly as
    // it skipped the JPEG it replaced.
    expect(supportsCompression("image/webp", "photo.webp")).toBe(false);
    expect(supportsCompression("image/jpeg", "photo.jpg")).toBe(false);
    expect(supportsCompression("text/csv", "rows.csv")).toBe(true);
  });
});

describe("file boundaries", () => {
  it("sanitizes path separators and control characters", () => {
    expect(sanitizeFilename("../private/\u0000report.pdf")).toBe("-private--report.pdf");
    expect(sanitizeFilename(" ")).toBe("received-file");
  });

  // The name and the media type arrive in the manifest, and the other device
  // controls the manifest. The receiver must clean both of them.
  it("removes the invisible characters that disguise a file type", () => {
    // A right-to-left override makes this read as "photo exe.png" on screen.
    expect(sanitizeFilename("photo\u202Egnp.exe")).toBe("photognp.exe");
    expect(sanitizeFilename("report\u200b\u2066.pdf")).toBe("report.pdf");
  });

  it("does not make a hidden file or a bare path", () => {
    expect(sanitizeFilename("...")).toBe("received-file");
    expect(sanitizeFilename(".ssh/authorized_keys")).toBe("ssh-authorized_keys");
  });

  it("falls back when the name is not a string", () => {
    expect(sanitizeFilename(undefined)).toBe("received-file");
    expect(sanitizeFilename({ toString: () => "x" })).toBe("received-file");
  });

  it("keeps a plain media type and refuses everything else", () => {
    expect(sanitizeMime("image/png")).toBe("image/png");
    expect(sanitizeMime("APPLICATION/PDF")).toBe("application/pdf");
    expect(sanitizeMime("text/html;charset=utf-8")).toBe("application/octet-stream");
    expect(sanitizeMime("not a type")).toBe("application/octet-stream");
    expect(sanitizeMime(42)).toBe("application/octet-stream");
  });
});
