import { describe, expect, it } from "vitest";
import { decryptGeneration, derivePassphraseKey, encryptGeneration } from "../src/protocol/crypto";
import { generatePassphrase, isPassphraseValid, normalizePassphrase, PASSPHRASE_PART_COUNT, passphraseParts } from "../src/protocol/passphrase";

describe("passphrase helpers", () => {
  it("creates the expected number of readable random parts", () => {
    const phrase = generatePassphrase();
    expect(passphraseParts(phrase)).toHaveLength(PASSPHRASE_PART_COUNT);
    expect(isPassphraseValid(phrase)).toBe(true);
  });

  it("normalizes capitalization and repeated spaces", () => {
    expect(normalizePassphrase("  Amber-river   BRIGHT-cloud ")).toBe("amber-river bright-cloud");
  });
});

describe("passphrase cryptography", () => {
  it("derives the same AES-GCM key on both sides and rejects a different phrase", async () => {
    const salt = new Uint8Array(16);
    salt.fill(7);
    const phrase = "amber-river bright-cloud calm-forest copper-moon gentle-pine lunar-stream silver-valley swift-wind";
    const context = { transferId: salt, generationId: 0, generationCount: 1, plainLength: 37, encodedLength: 65 };
    const plaintext = new Uint8Array(37).map((_, index) => index + 1);
    const senderKey = await derivePassphraseKey(phrase, salt);
    const receiverKey = await derivePassphraseKey(`  ${phrase.toUpperCase()}  `, salt);
    const wrongKey = await derivePassphraseKey("amber-river bright-cloud calm-forest copper-moon gentle-pine lunar-stream silver-valley swift-summer", salt);
    const encoded = await encryptGeneration(senderKey, plaintext, context);

    await expect(decryptGeneration(receiverKey, encoded, context)).resolves.toEqual(plaintext);
    await expect(decryptGeneration(wrongKey, encoded, context)).rejects.toThrow();
  }, 120_000);
});
