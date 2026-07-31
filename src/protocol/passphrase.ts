import { randomBytes } from "./bytes";

export const PASSPHRASE_PART_COUNT = 8;

// These compact, locally owned word lists keep the phrase generator dependency
// free. Each part combines one adjective and one noun, giving 1,024 choices per
// part and roughly 80 bits of entropy across the generated phrase.
const ADJECTIVES = [
  "amber", "bright", "calm", "cedar", "clear", "copper", "coral", "crisp",
  "dusk", "fern", "gentle", "golden", "green", "kind", "lunar", "mellow",
  "mint", "quiet", "red", "river", "silver", "soft", "solar", "steady",
  "stone", "summer", "swift", "violet", "warm", "white", "wild", "yellow",
] as const;

const NOUNS = [
  "apple", "arrow", "beach", "birch", "brook", "cloud", "comet", "dawn",
  "field", "forest", "harbor", "hill", "island", "lake", "meadow", "moon",
  "mountain", "ocean", "orbit", "pine", "rain", "river", "robin", "sky",
  "stone", "stream", "sun", "valley", "wind", "winter", "wood", "zephyr",
] as const;

export function normalizePassphrase(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function passphraseParts(value: string): string[] {
  const normalized = normalizePassphrase(value);
  return normalized ? normalized.split(" ") : [];
}

export function isPassphraseValid(value: string): boolean {
  const parts = passphraseParts(value);
  return parts.length === PASSPHRASE_PART_COUNT && parts.every((part) => /^[a-z]+-[a-z]+$/.test(part));
}

export function generatePassphrase(): string {
  const parts: string[] = [];
  const used = new Set<string>();
  while (parts.length < PASSPHRASE_PART_COUNT) {
    const sample = randomBytes(4);
    const value = new DataView(sample.buffer, sample.byteOffset, sample.byteLength).getUint32(0, true);
    const adjective = ADJECTIVES[(value >>> 5) & 31]!;
    const noun = NOUNS[value & 31]!;
    const part = `${adjective}-${noun}`;
    if (used.has(part)) continue;
    used.add(part);
    parts.push(part);
  }
  return parts.join(" ");
}
