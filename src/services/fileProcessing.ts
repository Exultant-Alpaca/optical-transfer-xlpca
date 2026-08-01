import { DEFAULT_IMAGE_PRESET, HARD_FILE_LIMIT, IMAGE_RECODE_MIN_BYTES, PUBLIC_FILE_LIMIT, supportsVideoRecoding, type ImageQualityPreset } from "../config/policy";
import { bytesToBase64Url } from "../protocol/bytes";
import { recodeVideoFile } from "./videoRecoding";

/** Set when visual media was re-encoded, describing what it was beforehand. */
export interface RecodedMediaInfo {
  sourceLength: number;
  sourceMime: string;
  width: number;
  height: number;
  /** Missing only on a manifest made by an older release. */
  kind?: "photo" | "animation" | "video";
}

export interface ProcessedFile {
  originalLength: number;
  encoded: Uint8Array;
  compression: "none" | "gzip";
  sha256: Uint8Array;
  /** Transmitted media type, which differs from the input when re-encoded. */
  mime: string;
  /** Transmitted filename, re-extensioned when re-encoded. */
  filename: string;
  recoded: RecodedMediaInfo | null;
}

export function validateFile(file: File): string | null {
  if (file.size === 0) return "Select a file that is not empty.";
  if (file.size > HARD_FILE_LIMIT) return "This software cannot send a file of more than 25 MB.";
  if (file.size > PUBLIC_FILE_LIMIT) return "This build sends a maximum of 10 MB in one transfer.";
  return null;
}

interface ProcessResponse {
  type: string;
  percent?: number;
  originalLength?: number;
  encoded?: ArrayBuffer;
  compression?: "none" | "gzip";
  sha256?: ArrayBuffer;
  mime?: string;
  filename?: string;
  recoded?: RecodedMediaInfo | null;
  message?: string;
}

export type ProcessingProgressCallback = (percent: number) => void;

export async function processFileInWorker(file: File, imagePreset: ImageQualityPreset = DEFAULT_IMAGE_PRESET, onProgress?: ProcessingProgressCallback): Promise<ProcessedFile> {
  let lastProgress = -1;
  const report = (percent: number) => {
    const next = Math.max(0, Math.min(100, Math.round(percent)));
    if (next === lastProgress) return;
    lastProgress = next;
    onProgress?.(next);
  };
  report(0);
  const videoCandidate = imagePreset !== "original" && file.size >= IMAGE_RECODE_MIN_BYTES && supportsVideoRecoding(file.type);
  const videoResult = await recodeVideoFile(file, imagePreset, (percent) => report(percent * 0.9)).catch(() => null);
  const input = videoResult?.file ?? file;
  const videoRecoded: RecodedMediaInfo | null = videoResult ? {
    sourceLength: file.size,
    sourceMime: file.type,
    width: videoResult.width,
    height: videoResult.height,
    kind: "video",
  } : null;

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/fileProcessor.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<ProcessResponse>) => {
      const data = event.data;
      if (data.type === "progress" && data.percent !== undefined) {
        report(videoCandidate ? 90 + data.percent * 0.1 : data.percent);
        return;
      }
      worker.terminate();
      if (data.type === "error" || !data.encoded || !data.sha256 || data.originalLength === undefined || !data.compression) {
        reject(new Error(data.message ?? "File processing failed"));
        return;
      }
      report(100);
      resolve({
        originalLength: data.originalLength,
        encoded: new Uint8Array(data.encoded),
        compression: data.compression,
        sha256: new Uint8Array(data.sha256),
        mime: data.mime || input.type || "application/octet-stream",
        filename: data.filename || input.name,
        recoded: videoRecoded ?? data.recoded ?? null,
      });
    };
    worker.onerror = () => { worker.terminate(); reject(new Error("File worker stopped unexpectedly")); };
    input.arrayBuffer()
      .then((buffer) => worker.postMessage({ type: "process", buffer, mime: input.type, filename: input.name, imagePreset }, [buffer]))
      .catch((error: unknown) => { worker.terminate(); reject(error); });
  });
}

// Characters that are invisible but change how a name reads. A right-to-left
// override makes "photo\u202Egnp.exe" read as "photo exe.png" on the screen,
// which is the usual method to disguise the type of a file. NFKC does not
// remove these characters, so this must remove them.
const INVISIBLE_CHARACTERS = /[\u200b-\u200f\u061c\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * Makes a filename safe for a save dialog.
 *
 * The name comes from the manifest, and the other device controls the manifest.
 * Thus the receiver must use this before it makes a File. The sender alone is
 * not sufficient.
 */
export function sanitizeFilename(filename: unknown): string {
  if (typeof filename !== "string") return "received-file";
  const normalized = filename
    .normalize("NFKC")
    .replace(INVISIBLE_CHARACTERS, "")
    .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
    .trim();
  // A name of only dots gives a hidden file or a part of a path.
  const safe = normalized.replace(/\.\.+/g, ".").replace(/^\.+/, "").slice(0, 180);
  return safe || "received-file";
}

/**
 * Keeps the media type to a plain type token.
 *
 * This value also comes from the other device. It becomes the type of the Blob
 * that the user saves or sends to a different application.
 */
export function sanitizeMime(mime: unknown): string {
  const fallback = "application/octet-stream";
  if (typeof mime !== "string") return fallback;
  const value = mime.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_+.-]{0,62}\/[a-z0-9][a-z0-9!#$&^_+.-]{0,62}$/.test(value) ? value : fallback;
}

export function fingerprint(bytes: Uint8Array): string {
  return bytesToBase64Url(bytes).slice(0, 12);
}
