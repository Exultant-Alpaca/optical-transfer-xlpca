export const PROTOCOL_VERSION = 1;
/** The first 4 bytes of every frame. Both ends ship together, so this is
 * only a quick check that a frame belongs to this protocol. */
export const PROTOCOL_MAGIC = "OTD1";
export const PUBLIC_FILE_LIMIT = 10 * 1024 * 1024;
export const HARD_FILE_LIMIT = 25 * 1024 * 1024;
export const MAX_GENERATIONS = 1024;
export const MAX_SOURCE_BLOCKS = 40_000;
export const MAX_ENCODED_LENGTH = HARD_FILE_LIMIT + 256 * 1024;
export const GENERATION_PLAIN_LIMIT = 48 * 1024;
export const SOURCE_BLOCK_SIZE = 720;

// The largest block the frame format can carry: a QR symbol in byte mode at EC
// level L tops out near 2,950 bytes, and the 48-byte frame header comes out of
// the same budget. Above this the writer rejects the frame as too long.
export const MAX_SOURCE_BLOCK_SIZE = 2_896;

// Conservative emission rate, kept low for cameras that struggle to lock onto a
// fast stream rather than for any sender-side limit.
export const TX_FRAMES_PER_SECOND = 6;

// Faster is not better here. 60 fps tore and skipped frames on real hardware,
// and even 40 fps gives a 30 fps camera nothing it can use, so the sender holds
// each dense symbol for 50 ms instead. Throughput comes from the block size,
// not the rate: 2,896 bytes at 20 fps is 57 kB/s on the wire. The symbols are
// still rasterised in parallel and queued ahead of the paint loop, because one
// version 38 symbol costs about 60 ms. See services/qrFrameSource.ts.
export const HIGH_DENSITY_FRAMES_PER_SECOND = 20;

/** Frames a GIF export must hold per source block to decode without replays. */
export const GIF_STREAM_OVERHEAD = 2;

/** A GIF replays the same frames, so a long stream is not worth exporting. */
export const MAX_GIF_FRAMES = 300;

/** Screen pixels per QR module in an exported GIF. */
export const GIF_MODULE_SCALE = 3;

// Expected fountain frames per source block, averaged over the generations of a
// transfer. The receiver only finishes when its slowest generation finishes, so
// this tracks the worst generation rather than the mean one. See
// tests/protocol.test.ts for the measurement that keeps this honest.
export const FOUNTAIN_OVERHEAD = 1.6;

export type TransmissionProfile = "conservative" | "balanced" | "high-density";

// QRStatic is deliberately absent. Its decoder needs the exact pixel grid and
// frame order it encoded, which no camera can deliver, so it lives on the demo
// page instead of being offered as a transfer that cannot finish.
export type TransferMode = "quick" | "passphrase";

/**
 * Where the sender's opening QR code points. Defaults to wherever this copy of
 * the app is already served from, so scanning it opens the receiving page on the
 * other device with no configuration. Set VITE_PUBLIC_URL at build time when the
 * public address differs from the origin serving the app.
 */
export function receiverUrl(origin?: string, mode: TransferMode = "quick"): string {
  const configured = import.meta.env.VITE_PUBLIC_URL as string | undefined;
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  const root = (configured ?? origin ?? "").replace(/\/$/, "");
  // The sender's choice travels in the link, so the person receiving never has
  // to be told which setting to pick on their own device.
  return `${root}${base}receive?mode=${mode}`;
}

export const PROFILES: Record<TransmissionProfile, { label: string; sourceBlockSize: number; framesPerSecond: number }> = {
  conservative: { label: "Conservative", sourceBlockSize: SOURCE_BLOCK_SIZE, framesPerSecond: TX_FRAMES_PER_SECOND },
  balanced: { label: "Balanced", sourceBlockSize: 900, framesPerSecond: 8 },
  // The most the QR format holds, word aligned. This is a deliberate trade: a
  // 2,896-byte block needs a version 38 symbol, 169 modules across, so each
  // module is a third smaller on screen than the 125-module Balanced symbol and
  // the camera needs to be closer and steadier. Raw rate is 2,896 x 20 =
  // 57 kB/s, about 35 kB/s of file after fountain overhead.
  "high-density": { label: "High-density experimental", sourceBlockSize: MAX_SOURCE_BLOCK_SIZE, framesPerSecond: HIGH_DENSITY_FRAMES_PER_SECOND },
};

export const DEFAULT_PROFILE: TransmissionProfile = "balanced";

/**
 * Deliberately not rounded. At 60 fps the exact interval is 16.67 ms, and
 * rounding it up to 17 makes every second animation frame arrive too early,
 * which halves the achieved rate to 30 fps.
 */
export function frameIntervalMs(profile: TransmissionProfile): number {
  return 1_000 / PROFILES[profile].framesPerSecond;
}

export function supportsCompression(mime: string, filename: string): boolean {
  const value = `${mime} ${filename}`.toLowerCase();
  return !/(zip|gzip|7z|rar|pdf|png|jpe?g|gif|webp|heic|avif|mp4|mov|m4v|mp3|aac|webm|woff2?|otf|ttf)/.test(value);
}

// Photographs are already entropy coded, so gzip does nothing for them. The only
// way to make a large image cheaper to send over a link this slow is to re-encode
// the pixels, which is lossy. That is a different promise from the rest of the
// protocol, so it is a visible, per-transfer choice rather than a silent default
// for every file.
export type ImageQualityPreset = "original" | "balanced" | "smallest";

export const IMAGE_PRESETS: Record<ImageQualityPreset, { label: string; detail: string; maxEdge: number; quality: number }> = {
  original: { label: "Full size", detail: "Slowest to send", maxEdge: Number.POSITIVE_INFINITY, quality: 1 },
  balanced: { label: "Recommended", detail: "Much faster, still sharp", maxEdge: 2_560, quality: 0.82 },
  smallest: { label: "Fastest", detail: "Good for sharing quickly", maxEdge: 1_600, quality: 0.7 },
};

export const DEFAULT_IMAGE_PRESET: ImageQualityPreset = "balanced";

/** Below this an image is already a short transfer and is not worth degrading. */
export const IMAGE_RECODE_MIN_BYTES = 256 * 1024;

/** Only accept a re-encode that is a clear win, not a rounding difference. */
export const IMAGE_RECODE_MIN_SAVING = 0.9;

// GIF is excluded because decoding one yields a single frame, which would throw
// away the animation without any way for the receiver to tell.
const RECODABLE_IMAGE_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "image/heic", "image/heif", "image/avif", "image/tiff", "image/bmp",
]);

export function supportsImageRecoding(mime: string): boolean {
  return RECODABLE_IMAGE_TYPES.has(mime.toLowerCase().trim());
}

/** Formats that can carry transparency, which a JPEG fallback would destroy. */
export function mayCarryAlpha(mime: string): boolean {
  return /png|webp|heic|heif|avif|tiff|gif/.test(mime.toLowerCase());
}
