import { GIF_MODULE_SCALE, GIF_STREAM_OVERHEAD, MAX_GIF_FRAMES, PROFILES } from "../config/policy";
import { QRSTATIC_FRAME_COUNT, QRSTATIC_FRAME_HEIGHT, QRSTATIC_FRAME_INTERVAL_MS, QRSTATIC_FRAME_WIDTH } from "./qrstatic";
import { encodeGif, scaleIndices, type GifFrame } from "./gif";
import { QrFrameSource } from "./qrFrameSource";
import type { TransferPlan } from "../protocol/transfer";

/** GIF delays are hundredths of a second, and most viewers clamp 1 to 10. */
function delayCs(framesPerSecond: number): number {
  return Math.max(2, Math.round(100 / framesPerSecond));
}

/**
 * How many frames a receiver needs to see before the fountain stream can finish.
 * A GIF loops over identical frames, so replaying it adds no new blocks: the
 * file has to carry a complete stream on its own.
 */
export function framesForCompleteStream(plan: TransferPlan): number {
  const blocks = Math.max(...plan.generations.map((generation) => generation.encoder.blockCount));
  return plan.generations.length * Math.ceil(blocks * GIF_STREAM_OVERHEAD);
}

export function gifFrameBudget(plan: TransferPlan): { needed: number; withinBudget: boolean } {
  const needed = framesForCompleteStream(plan);
  return { needed, withinBudget: needed <= MAX_GIF_FRAMES };
}

/**
 * Renders the sender's QR stream to an animated GIF.
 *
 * The GIF is a copy of the optical stream, not a faster path: viewers clamp
 * frame delays, so a receiver reading it off a screen will run slower than the
 * live sender.
 */
export async function buildTransferGif(plan: TransferPlan, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const { needed, withinBudget } = gifFrameBudget(plan);
  if (!withinBudget) throw new Error(`This transfer needs ${needed} frames. A GIF file holds ${MAX_GIF_FRAMES} frames. Send a smaller file.`);

  const source = new QrFrameSource(plan.nextFrame, 12);
  const frames: GifFrame[] = [];
  const hold = delayCs(PROFILES[plan.profile].framesPerSecond);
  let width = 0;
  let height = 0;

  try {
    for (let index = 0; index < needed; index += 1) {
      const symbol = await source.next();
      width = symbol.width * GIF_MODULE_SCALE;
      height = symbol.height * GIF_MODULE_SCALE;
      // The writer emits 0 for dark and 255 for light; the palette below is
      // indexed the same way round.
      const modules = new Uint8Array(symbol.data.length);
      for (let pixel = 0; pixel < symbol.data.length; pixel += 1) modules[pixel] = symbol.data[pixel]! < 128 ? 1 : 0;
      frames.push({ indices: scaleIndices(modules, symbol.width, symbol.height, GIF_MODULE_SCALE), delayCs: hold });
      onProgress?.(index + 1, needed);
    }
  } finally {
    source.stop();
  }

  return encodeGif({ width, height, palette: new Uint8Array([255, 255, 255, 0, 0, 0]), frames });
}

/** Renders one 64-frame QRStatic window as a greyscale GIF. */
export function buildTemporalGif(window: Float32Array): Blob {
  const pixels = QRSTATIC_FRAME_WIDTH * QRSTATIC_FRAME_HEIGHT;
  const palette = new Uint8Array(256 * 3);
  for (let index = 0; index < 256; index += 1) palette.set([index, index, index], index * 3);

  const frames: GifFrame[] = [];
  for (let frame = 0; frame < QRSTATIC_FRAME_COUNT; frame += 1) {
    const indices = new Uint8Array(pixels);
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      indices[pixel] = Math.max(0, Math.min(255, Math.round(128 + window[frame * pixels + pixel]! * 170)));
    }
    frames.push({ indices, delayCs: delayCs(1_000 / QRSTATIC_FRAME_INTERVAL_MS) });
  }

  return encodeGif({ width: QRSTATIC_FRAME_WIDTH, height: QRSTATIC_FRAME_HEIGHT, palette, frames });
}
