import { IMAGE_PRESETS, IMAGE_RECODE_MIN_BYTES, IMAGE_RECODE_MIN_SAVING, mayCarryAlpha, supportsCompression, supportsImageRecoding, type ImageQualityPreset } from "../config/policy";
import { toArrayBuffer } from "../protocol/bytes";

interface ProcessRequest {
  type: "process";
  buffer: ArrayBuffer;
  mime: string;
  filename: string;
  imagePreset: ImageQualityPreset;
}

interface RecodedImage {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  width: number;
  height: number;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof CompressionStream === "undefined") return new Uint8Array(toArrayBuffer(bytes));
  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
  const output = await new Response(stream).arrayBuffer();
  const result = new Uint8Array(new ArrayBuffer(output.byteLength));
  result.set(new Uint8Array(output));
  return result;
}

function findChunk(bytes: Uint8Array, marker: string, searchLimit: number): boolean {
  const needle = new TextEncoder().encode(marker);
  const limit = Math.min(bytes.length - needle.length, searchLimit);
  outer: for (let index = 0; index <= limit; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Animated stills decode to a single frame, so re-encoding one would silently
 * drop the animation. APNG advertises itself with an acTL chunk before the first
 * IDAT, and animated WebP with an ANIM chunk in the RIFF header.
 */
function isAnimated(bytes: Uint8Array, mime: string): boolean {
  const type = mime.toLowerCase();
  if (type.includes("gif")) return true;
  if (type.includes("png")) return findChunk(bytes, "acTL", 64 * 1024);
  if (type.includes("webp")) return findChunk(bytes, "ANIM", 1024);
  return false;
}

function extensionFor(mime: string): string {
  return mime === "image/webp" ? "webp" : "jpg";
}

function renameFor(filename: string, mime: string): string {
  const extension = extensionFor(mime);
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  return `${stem}.${extension}`;
}

async function recodeImage(bytes: Uint8Array, mime: string, preset: ImageQualityPreset): Promise<RecodedImage | null> {
  if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  const { maxEdge, quality } = IMAGE_PRESETS[preset];

  // "from-image" applies the EXIF orientation while decoding, so the re-encoded
  // file is upright even though it no longer carries the EXIF block. Dropping
  // that block also strips any camera and GPS metadata.
  const bitmap = await createImageBitmap(new Blob([toArrayBuffer(bytes)], { type: mime }), { imageOrientation: "from-image" });
  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, maxEdge / longestEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);

    // convertToBlob silently falls back to PNG for a format the browser cannot
    // encode, so trust the returned blob's type rather than the requested one.
    // JPEG is only an acceptable fallback when the source cannot be transparent,
    // since flattening alpha would change how the image looks.
    const candidates = mayCarryAlpha(mime) ? ["image/webp"] : ["image/webp", "image/jpeg"];
    for (const type of candidates) {
      const blob = await canvas.convertToBlob({ type, quality }).catch(() => null);
      if (!blob || blob.type !== type) continue;
      const encoded = new Uint8Array(new ArrayBuffer(blob.size));
      encoded.set(new Uint8Array(await blob.arrayBuffer()));
      return { bytes: encoded, mime: type, width, height };
    }
    return null;
  } finally {
    bitmap.close();
  }
}

async function processFile(request: ProcessRequest): Promise<void> {
  const source = new Uint8Array(new ArrayBuffer(request.buffer.byteLength));
  source.set(new Uint8Array(request.buffer));

  let payload: Uint8Array = source;
  let mime = request.mime;
  let filename = request.filename;
  let recoded: { sourceLength: number; sourceMime: string; width: number; height: number } | null = null;

  const worthRecoding = request.imagePreset !== "original"
    && supportsImageRecoding(request.mime)
    && source.length >= IMAGE_RECODE_MIN_BYTES
    && !isAnimated(source, request.mime);

  if (worthRecoding) {
    // A decoder that cannot read the format, or an encoder that produces
    // something larger, must leave the original file untouched.
    const result = await recodeImage(source, request.mime, request.imagePreset).catch(() => null);
    if (result && result.bytes.length < source.length * IMAGE_RECODE_MIN_SAVING) {
      recoded = { sourceLength: source.length, sourceMime: request.mime, width: result.width, height: result.height };
      payload = result.bytes;
      mime = result.mime;
      filename = renameFor(request.filename, result.mime);
    }
  }

  // The digest covers what is actually transmitted, so the receiver still
  // verifies the exact bytes it is about to save.
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(payload)));
  const sample = payload.subarray(0, Math.min(128 * 1024, payload.length));
  let encoded = payload;
  let compression: "none" | "gzip" = "none";
  if (supportsCompression(mime, filename) && sample.length > 128) {
    const compressedSample = await gzip(sample);
    if (compressedSample.length < sample.length * 0.95) {
      const compressed = await gzip(payload);
      if (compressed.length < payload.length * 0.95) {
        encoded = compressed;
        compression = "gzip";
      }
    }
  }

  const encodedBuffer = toArrayBuffer(encoded);
  const digestBuffer = toArrayBuffer(digest);
  self.postMessage(
    { type: "complete", originalLength: payload.length, encoded: encodedBuffer, compression, sha256: digestBuffer, mime, filename, recoded },
    [encodedBuffer, digestBuffer],
  );
}

self.onmessage = (event: MessageEvent<ProcessRequest>) => {
  if (event.data.type !== "process") return;
  processFile(event.data).catch((error: unknown) => self.postMessage({ type: "error", message: error instanceof Error ? error.message : "File processing failed" }));
};
