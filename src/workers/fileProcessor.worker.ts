import {
  GIF_RECODE_MAX_PIXELS, IMAGE_PRESETS, IMAGE_RECODE_MIN_BYTES,
  MEDIA_PRESETS, MEDIA_RECODE_MIN_SAVING, mayCarryAlpha, supportsCompression,
  supportsGifRecoding, supportsImageRecoding, type ImageQualityPreset,
} from "../config/policy";
import { toArrayBuffer } from "../protocol/bytes";
import { encodeGif, type GifFrame } from "../services/gif";

interface ProcessRequest {
  type: "process";
  buffer: ArrayBuffer;
  mime: string;
  filename: string;
  imagePreset: ImageQualityPreset;
}

interface RecodedAsset {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  width: number;
  height: number;
  kind: "photo" | "animation";
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
 * The still-image path must not flatten an animation. GIF has its own animated
 * path below. APNG advertises itself with an acTL chunk before the first IDAT,
 * and animated WebP with an ANIM chunk in the RIFF header.
 */
function isAnimated(bytes: Uint8Array, mime: string): boolean {
  const type = mime.toLowerCase();
  if (type.includes("gif")) return true;
  if (type.includes("png")) return findChunk(bytes, "acTL", 64 * 1024);
  if (type.includes("webp")) return findChunk(bytes, "ANIM", 1024);
  return false;
}

function extensionFor(mime: string): string {
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}

function renameFor(filename: string, mime: string): string {
  const extension = extensionFor(mime);
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  return `${stem}.${extension}`;
}

async function recodeImage(bytes: Uint8Array, mime: string, preset: ImageQualityPreset): Promise<RecodedAsset | null> {
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
      return { bytes: encoded, mime: type, width, height, kind: "photo" };
    }
    return null;
  } finally {
    bitmap.close();
  }
}

function gifPalette(): Uint8Array {
  // Index zero is transparent. The other entries form a small RGB cube that
  // is quick to calculate and stable across every frame.
  const palette = new Uint8Array(256 * 3);
  let index = 1;
  for (let red = 0; red < 6; red += 1) {
    for (let green = 0; green < 7; green += 1) {
      for (let blue = 0; blue < 6; blue += 1) {
        palette[index * 3] = Math.round((red * 255) / 5);
        palette[index * 3 + 1] = Math.round((green * 255) / 6);
        palette[index * 3 + 2] = Math.round((blue * 255) / 5);
        index += 1;
      }
    }
  }
  return palette;
}

function quantizeGifFrame(pixels: Uint8ClampedArray): Uint8Array {
  const indices = new Uint8Array(pixels.length / 4);
  for (let pixel = 0, output = 0; pixel < pixels.length; pixel += 4, output += 1) {
    if (pixels[pixel + 3]! < 128) {
      indices[output] = 0;
      continue;
    }
    const red = Math.round((pixels[pixel]! * 5) / 255);
    const green = Math.round((pixels[pixel + 1]! * 6) / 255);
    const blue = Math.round((pixels[pixel + 2]! * 5) / 255);
    indices[output] = 1 + red * 42 + green * 6 + blue;
  }
  return indices;
}

async function recodeGif(bytes: Uint8Array, preset: Exclude<ImageQualityPreset, "original">): Promise<RecodedAsset | null> {
  if (typeof ImageDecoder === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  if (!(await ImageDecoder.isTypeSupported("image/gif"))) return null;

  const decoder = new ImageDecoder({
    data: toArrayBuffer(bytes),
    type: "image/gif",
    preferAnimation: true,
  });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track?.animated || track.frameCount < 2) return null;

    const setting = MEDIA_PRESETS[preset];
    const frames: GifFrame[] = [];
    let canvas: OffscreenCanvas | undefined;
    let context: OffscreenCanvasRenderingContext2D | null = null;
    let width = 0;
    let height = 0;
    let timeSinceKeptFrameCs = Number.POSITIVE_INFINITY;
    const minimumDelayCs = 100 / setting.gifFramesPerSecond;

    for (let frameIndex = 0; frameIndex < track.frameCount; frameIndex += 1) {
      const result = await decoder.decode({ frameIndex, completeFramesOnly: true });
      const image = result.image;
      try {
        if (!canvas) {
          const longestEdge = Math.max(image.displayWidth, image.displayHeight);
          const scale = Math.min(1, setting.gifMaxEdge / longestEdge);
          width = Math.max(1, Math.round(image.displayWidth * scale));
          height = Math.max(1, Math.round(image.displayHeight * scale));
          canvas = new OffscreenCanvas(width, height);
          context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return null;
        }

        const frameDelayCs = Math.max(1, (image.duration ?? 100_000) / 10_000);
        const lastFrame = frameIndex === track.frameCount - 1;
        if (frames.length > 0 && timeSinceKeptFrameCs < minimumDelayCs && !lastFrame) {
          frames[frames.length - 1]!.delayCs += frameDelayCs;
          timeSinceKeptFrameCs += frameDelayCs;
          continue;
        }

        context!.clearRect(0, 0, width, height);
        context!.drawImage(image, 0, 0, width, height);
        const pixels = context!.getImageData(0, 0, width, height).data;
        frames.push({ indices: quantizeGifFrame(pixels), delayCs: frameDelayCs, transparentIndex: 0 });
        timeSinceKeptFrameCs = frameDelayCs;
        if (frames.length * width * height > GIF_RECODE_MAX_PIXELS) return null;
      } finally {
        image.close();
      }
    }

    if (frames.length < 2) return null;
    const repetitions = track.repetitionCount;
    const loopCount = repetitions === Infinity ? 0 : repetitions === 0 ? null : repetitions;
    const blob = encodeGif({ width, height, palette: gifPalette(), frames, loopCount });
    const encoded = new Uint8Array(new ArrayBuffer(blob.size));
    encoded.set(new Uint8Array(await blob.arrayBuffer()));
    return { bytes: encoded, mime: "image/gif", width, height, kind: "animation" };
  } finally {
    decoder.close();
  }
}

async function processFile(request: ProcessRequest): Promise<void> {
  const source = new Uint8Array(new ArrayBuffer(request.buffer.byteLength));
  source.set(new Uint8Array(request.buffer));

  let payload: Uint8Array = source;
  let mime = request.mime;
  let filename = request.filename;
  let recoded: { sourceLength: number; sourceMime: string; width: number; height: number; kind: "photo" | "animation" } | null = null;

  const recodePreset = request.imagePreset === "original" ? null : request.imagePreset;
  if (recodePreset !== null && source.length >= IMAGE_RECODE_MIN_BYTES) {
    // A decoder that cannot read the format, or an encoder that produces
    // something larger, must leave the original file untouched.
    const result = supportsImageRecoding(request.mime) && !isAnimated(source, request.mime)
      ? await recodeImage(source, request.mime, recodePreset).catch(() => null)
      : supportsGifRecoding(request.mime)
        ? await recodeGif(source, recodePreset).catch(() => null)
        : null;
    if (result && result.bytes.length < source.length * MEDIA_RECODE_MIN_SAVING) {
      recoded = { sourceLength: source.length, sourceMime: request.mime, width: result.width, height: result.height, kind: result.kind };
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
