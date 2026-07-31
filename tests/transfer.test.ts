import { describe, expect, it, vi } from "vitest";

// The real implementation offloads hashing, gzip, and image re-encoding to a
// Worker with OffscreenCanvas, none of which exist in the test environment. The
// transport is what these tests exercise, so stand in a direct implementation of
// the same contract. Image re-encoding itself is verified in a real browser.
const fakeRecode = { active: false };

vi.mock("../src/services/fileProcessing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/fileProcessing")>();
  return {
    ...actual,
    processFileInWorker: async (file: File) => {
      const source = new Uint8Array(await file.arrayBuffer());
      // Stand in for the worker's re-encode: a smaller payload, a new media
      // type and extension, and provenance describing the original.
      const recoding = fakeRecode.active && file.type.startsWith("image/");
      const payload = recoding ? source.slice(0, Math.floor(source.length / 4)) : source;
      return {
        originalLength: payload.length,
        encoded: payload,
        compression: "none" as const,
        // The digest must cover what is transmitted, not the source file.
        sha256: new Uint8Array(await crypto.subtle.digest("SHA-256", payload)),
        mime: recoding ? "image/webp" : (file.type || "application/octet-stream"),
        filename: recoding ? file.name.replace(/\.[^.]+$/, ".webp") : file.name,
        recoded: recoding ? { sourceLength: source.length, sourceMime: file.type, width: 2_560, height: 1_920 } : null,
      };
    },
  };
});

const { prepareTransfer, TransferReconstructor } = await import("../src/protocol/transfer");
const { DEFAULT_PROFILE, GENERATION_PLAIN_LIMIT, PROFILES, receiverUrl } = await import("../src/config/policy");

describe("receiver link", () => {
  it("carries the selected public transfer mode to the other device", () => {
    expect(receiverUrl("https://transfer.example", "quick")).toBe("https://transfer.example/receive?mode=quick");
    expect(receiverUrl("https://transfer.example", "passphrase")).toBe("https://transfer.example/receive?mode=passphrase");
  });
});

describe("transmission profiles", () => {
  it("uses Balanced by default and preserves each explicit speed choice", async () => {
    expect(DEFAULT_PROFILE).toBe("balanced");
    for (const profile of ["conservative", "balanced", "high-density"] as const) {
      const plan = await prepareTransfer(sampleFile(2_000), profile);
      expect(plan.profile).toBe(profile);
      expect(plan.manifest.sourceBlockSize).toBe(PROFILES[profile].sourceBlockSize);
    }
  });
});

function sampleFile(length: number, name = "sample.bin"): File {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = (index * 97 + 13) % 256;
  return new File([bytes], name, { type: "application/octet-stream" });
}

/** Runs the optical link in memory, optionally dropping and reordering frames. */
async function transmit(
  plan: Awaited<ReturnType<typeof prepareTransfer>>,
  reconstructor: InstanceType<typeof TransferReconstructor>,
  options: { keepEvery?: number; duplicate?: boolean; limit?: number } = {},
) {
  const { keepEvery = 1, duplicate = false, limit = 400_000 } = options;
  for (let sequence = 0; sequence < limit; sequence += 1) {
    if (sequence % keepEvery !== 0) continue;
    const frame = plan.nextFrame(sequence);
    const received = await reconstructor.addFrame(frame);
    if (received) return { received, sequence };
    if (duplicate) {
      const again = await reconstructor.addFrame(frame);
      if (again) return { received: again, sequence };
    }
  }
  throw new Error(`transfer never completed across ${limit} frames`);
}

describe("end to end optical transfer", () => {
  it("moves a single generation file in quick mode", async () => {
    const file = sampleFile(20_000);
    const plan = await prepareTransfer(file, "conservative");
    const { received } = await transmit(plan, new TransferReconstructor());
    expect(received.manifest.encryption).toBe("none");
    expect(received.manifest.filename).toBe("sample.bin");
    expect(new Uint8Array(await received.file.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
  }, 120_000);

  it("moves a file with a locally derived passphrase key", async () => {
    const passphrase = "amber-river bright-cloud calm-forest copper-moon gentle-pine lunar-stream silver-valley swift-wind";
    const file = sampleFile(20_000, "secret.bin");
    const plan = await prepareTransfer(file, "conservative", "original", passphrase);
    expect(plan.manifest.encryption).toBe("aes-gcm");
    expect(plan.manifest.keyDerivation).toBe("pbkdf2-sha256");

    const { received } = await transmit(plan, new TransferReconstructor(passphrase));
    expect(new Uint8Array(await received.file.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
  }, 180_000);

  it("survives dropped and duplicated frames", async () => {
    const file = sampleFile(60_000);
    const plan = await prepareTransfer(file, "conservative");
    const reconstructor = new TransferReconstructor();
    const { received } = await transmit(plan, reconstructor, { keepEvery: 3, duplicate: true });
    expect(new Uint8Array(await received.file.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
    expect(reconstructor.progress.rejected).toBe(0);
  }, 300_000);

  it("splits every byte across generations at a generation boundary", async () => {
    // The manifest carries the generation count, so serialising it changes its
    // own length and can move the count. Sizes near a boundary are where a
    // split derived from the loop variable rather than from the byte length
    // would drop the tail of the payload.
    for (const offset of [-64, -1, 0, 1, 64]) {
      const size = GENERATION_PLAIN_LIMIT * 2 + offset;
      const file = sampleFile(size, `boundary-${offset}.bin`);
      const plan = await prepareTransfer(file, "conservative");
      const planned = plan.generations.reduce((total, generation) => total + generation.plainLength, 0);
      expect(planned).toBe(size + 4 + JSON.stringify(plan.manifest).length);
      const { received } = await transmit(plan, new TransferReconstructor());
      expect(received.file.size).toBe(size);
    }
  }, 600_000);

  it("ignores frames from a different transfer and can be pointed at a new one", async () => {
    const first = await prepareTransfer(sampleFile(4_000, "first.bin"), "conservative");
    const second = await prepareTransfer(sampleFile(4_000, "second.bin"), "conservative");
    const reconstructor = new TransferReconstructor();

    await reconstructor.addFrame(first.nextFrame(0));
    expect(reconstructor.progress.accepted).toBe(1);

    // A sender that restarts gets a fresh transfer ID. Those frames must not
    // pollute the in-flight transfer, and the receiver must be able to switch.
    expect(await reconstructor.addFrame(second.nextFrame(0))).toBeNull();
    expect(reconstructor.progress.rejected).toBe(1);

    reconstructor.reset();
    const { received } = await transmit(second, reconstructor);
    expect(received.manifest.filename).toBe("second.bin");
  }, 120_000);

  it("delivers a re-encoded image with matching provenance and digest", async () => {
    fakeRecode.active = true;
    try {
      const bytes = new Uint8Array(80_000);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 61 + 5) % 256;
      const photo = new File([bytes], "DSC_4821.jpg", { type: "image/jpeg" });

      const plan = await prepareTransfer(photo, "conservative", "balanced");
      expect(plan.manifest.recoded).toEqual({ sourceLength: 80_000, sourceMime: "image/jpeg", width: 2_560, height: 1_920 });
      // The receiver must be told what it is saving, and it must be a WebP.
      expect(plan.manifest.filename).toBe("DSC_4821.webp");
      expect(plan.manifest.mime).toBe("image/webp");
      expect(plan.manifest.originalLength).toBe(20_000);

      const { received } = await transmit(plan, new TransferReconstructor());
      // Reaching here at all means the SHA-256 check passed against the
      // transmitted bytes rather than the source file.
      expect(received.file.name).toBe("DSC_4821.webp");
      expect(received.file.type).toBe("image/webp");
      expect(received.file.size).toBe(20_000);
      expect(received.manifest.recoded?.sourceLength).toBe(80_000);
      expect(new Uint8Array(await received.file.arrayBuffer())).toEqual(bytes.slice(0, 20_000));
    } finally {
      fakeRecode.active = false;
    }
  }, 120_000);

  it("leaves the manifest free of provenance when nothing was re-encoded", async () => {
    const plan = await prepareTransfer(sampleFile(9_000, "notes.txt"), "conservative", "smallest");
    expect(plan.manifest.recoded).toBeUndefined();
    expect("recoded" in plan.manifest).toBe(false);
    const { received } = await transmit(plan, new TransferReconstructor());
    expect(received.manifest.recoded).toBeUndefined();
  }, 120_000);

});
