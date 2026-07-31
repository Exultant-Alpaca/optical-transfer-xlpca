import { bytesToBase64Url, concatBytes, toArrayBuffer, utf8 } from "./bytes";
import { normalizePassphrase } from "./passphrase";

export const PASSPHRASE_KDF = "pbkdf2-sha256" as const;
// One derivation happens per transfer on each device. This is deliberately
// visible and tunable because older phones may need a lower value.
export const PBKDF2_ITERATIONS = 600_000;
export const AES_GCM_NONCE_LENGTH = 12;
export const AES_GCM_TAG_LENGTH = 16;

export interface GenerationCryptoContext {
  transferId: Uint8Array;
  generationId: number;
  generationCount: number;
  plainLength: number;
  encodedLength: number;
}

function associatedData(context: GenerationCryptoContext): Uint8Array {
  return utf8(JSON.stringify({
    v: 1,
    t: bytesToBase64Url(context.transferId),
    g: context.generationId,
    c: context.generationCount,
    p: context.plainLength,
    e: context.encodedLength,
  }));
}

export async function derivePassphraseKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(utf8(normalizePassphrase(passphrase))),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptGeneration(key: CryptoKey, plaintext: Uint8Array, context: GenerationCryptoContext): Promise<Uint8Array> {
  const encodedLength = plaintext.length + AES_GCM_NONCE_LENGTH + AES_GCM_TAG_LENGTH;
  const nonce = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(AES_GCM_NONCE_LENGTH)));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(associatedData({ ...context, encodedLength })),
      tagLength: AES_GCM_TAG_LENGTH * 8,
    },
    key,
    toArrayBuffer(plaintext),
  );
  const encoded = concatBytes(nonce, new Uint8Array(ciphertext));
  if (encoded.length !== encodedLength) throw new Error("Encrypted generation length mismatch");
  return encoded;
}

export async function decryptGeneration(key: CryptoKey, encoded: Uint8Array, context: GenerationCryptoContext): Promise<Uint8Array> {
  const expectedLength = context.plainLength + AES_GCM_NONCE_LENGTH + AES_GCM_TAG_LENGTH;
  if (encoded.length !== expectedLength || context.encodedLength !== encoded.length) throw new Error("Encrypted generation length mismatch");
  const nonce = encoded.subarray(0, AES_GCM_NONCE_LENGTH);
  const ciphertext = encoded.subarray(AES_GCM_NONCE_LENGTH);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(associatedData(context)),
      tagLength: AES_GCM_TAG_LENGTH * 8,
    },
    key,
    toArrayBuffer(ciphertext),
  );
  const decoded = new Uint8Array(plaintext);
  if (decoded.length !== context.plainLength) throw new Error("Decrypted generation length mismatch");
  return decoded;
}
