export const QRSTATIC_FRAME_WIDTH = 320;
export const QRSTATIC_FRAME_HEIGHT = 240;
export const QRSTATIC_FRAME_COUNT = 64;
export const QRSTATIC_FRAME_RATE = 30;
export const QRSTATIC_FRAME_INTERVAL_MS = Math.round(1_000 / QRSTATIC_FRAME_RATE);
export const QRSTATIC_KEY = "optical-transfer-demo qrstatic v1";

interface QrStaticExports {
  memory: WebAssembly.Memory;
  qrstatic_alloc(length: number): number;
  qrstatic_free(pointer: number, length: number): void;
  qrstatic_max_payload_bytes(): number;
  qrstatic_encode_block(keyPointer: number, keyLength: number, payloadPointer: number, payloadLength: number, sessionId: bigint, blockIndex: number, blockCount: number): bigint;
  qrstatic_decode_block(keyPointer: number, keyLength: number, framesPointer: number, framesLength: number): bigint;
}

let modulePromise: Promise<QrStaticExports> | undefined;

export function qrstaticWasmUrl(): string {
  return new URL("wasm/qrstatic_temporal.wasm", new URL(import.meta.env.BASE_URL, self.location.origin)).toString();
}

async function loadModule(wasmUrl = qrstaticWasmUrl()): Promise<QrStaticExports> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`The QRStatic WebAssembly file does not load (${response.status})`);
  const result = await WebAssembly.instantiate(await response.arrayBuffer(), { });
  return result.instance.exports as unknown as QrStaticExports;
}

export function getQrStaticModule(wasmUrl?: string): Promise<QrStaticExports> {
  modulePromise ??= loadModule(wasmUrl).catch((error: unknown) => {
    // A transient 404 during a deploy must not poison every later retry in
    // this tab. Releasing the rejected promise lets a new camera attempt
    // fetch the current asset again.
    modulePromise = undefined;
    throw error;
  });
  return modulePromise;
}

function unpackResult(value: bigint): { pointer: number; length: number } | null {
  if (value === 0n) return null;
  return { pointer: Number(value >> 32n), length: Number(value & 0xffffffffn) };
}

function copyMemory(module: QrStaticExports, pointer: number, length: number): Uint8Array {
  return new Uint8Array(module.memory.buffer, pointer, length).slice();
}

export async function qrstaticMaxPayloadBytes(wasmUrl?: string): Promise<number> {
  const module = await getQrStaticModule(wasmUrl);
  return module.qrstatic_max_payload_bytes();
}

export async function encodeTemporalBlock(
  key: string,
  payload: Uint8Array,
  sessionId: bigint,
  blockIndex: number,
  blockCount: number,
  wasmUrl?: string,
): Promise<Float32Array> {
  const module = await getQrStaticModule(wasmUrl);
  const keyBytes = new TextEncoder().encode(key);
  const keyPointer = module.qrstatic_alloc(keyBytes.length);
  const payloadPointer = module.qrstatic_alloc(payload.length);
  new Uint8Array(module.memory.buffer).set(keyBytes, keyPointer);
  new Uint8Array(module.memory.buffer).set(payload, payloadPointer);
  try {
    const result = unpackResult(module.qrstatic_encode_block(keyPointer, keyBytes.length, payloadPointer, payload.length, sessionId, blockIndex, blockCount));
    if (!result) throw new Error("QRStatic cannot encode this block");
    const bytes = copyMemory(module, result.pointer, result.length);
    module.qrstatic_free(result.pointer, result.length);
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();
  } finally {
    module.qrstatic_free(keyPointer, keyBytes.length);
    module.qrstatic_free(payloadPointer, payload.length);
  }
}

export async function decodeTemporalBlock(
  key: string,
  frames: Float32Array,
  wasmUrl?: string,
): Promise<Uint8Array | null> {
  const module = await getQrStaticModule(wasmUrl);
  const keyBytes = new TextEncoder().encode(key);
  const frameBytes = new Uint8Array(frames.buffer, frames.byteOffset, frames.byteLength);
  const keyPointer = module.qrstatic_alloc(keyBytes.length);
  const framesPointer = module.qrstatic_alloc(frameBytes.length);
  new Uint8Array(module.memory.buffer).set(keyBytes, keyPointer);
  new Uint8Array(module.memory.buffer).set(frameBytes, framesPointer);
  try {
    const result = unpackResult(module.qrstatic_decode_block(keyPointer, keyBytes.length, framesPointer, frameBytes.length));
    if (!result) return null;
    const bytes = copyMemory(module, result.pointer, result.length);
    module.qrstatic_free(result.pointer, result.length);
    return bytes;
  } finally {
    module.qrstatic_free(keyPointer, keyBytes.length);
    module.qrstatic_free(framesPointer, frameBytes.length);
  }
}

export function temporalFrameToImageData(frame: Float32Array): ImageData {
  const data = new Uint8ClampedArray(QRSTATIC_FRAME_WIDTH * QRSTATIC_FRAME_HEIGHT * 4);
  for (let index = 0; index < frame.length; index += 1) {
    const value = Math.max(0, Math.min(255, Math.round(128 + frame[index]! * 170)));
    const output = index * 4;
    data[output] = value;
    data[output + 1] = value;
    data[output + 2] = value;
    data[output + 3] = 255;
  }
  return new ImageData(data, QRSTATIC_FRAME_WIDTH, QRSTATIC_FRAME_HEIGHT);
}
