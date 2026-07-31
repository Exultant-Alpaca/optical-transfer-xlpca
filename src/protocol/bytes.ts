const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function utf8(value: string): Uint8Array<ArrayBuffer> {
  const encoded = textEncoder.encode(value);
  const output = new Uint8Array(new ArrayBuffer(encoded.length));
  output.set(encoded);
  return output;
}

export function fromUtf8(value: Uint8Array): string {
  return textDecoder.decode(toArrayBuffer(value));
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlToBytes(value: string, expectedLength?: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url value");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  const output = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  if (expectedLength !== undefined && output.length !== expectedLength) throw new Error("Unexpected byte length");
  return output;
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i]! ^ right[i]!;
  return difference === 0;
}

export function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  output.set(bytes);
  return output.buffer;
}
