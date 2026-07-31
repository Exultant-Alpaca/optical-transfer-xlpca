import { HARD_FILE_LIMIT } from "../config/policy";
import { bytesToBase64Url, concatBytes, fromUtf8, randomBytes, toArrayBuffer, utf8 } from "./bytes";
import type { TransferManifest } from "./transfer";
import { processFileInWorker, sanitizeFilename, sanitizeMime, type ProcessedFile } from "../services/fileProcessing";
import { encodeTemporalBlock, qrstaticMaxPayloadBytes, QRSTATIC_KEY } from "../services/qrstatic";

// Mirrors qrstatic's TiledStreamBlock wire format: magic, version, session id,
// block index, block count, payload length, payload CRC32, then the payload.
const BLOCK_HEADER_LENGTH = 29;
const BLOCK_VERSION = 1;
const BLOCK_MAGIC = new TextEncoder().encode("QTT1");

export interface TemporalTransferPlan {
  manifest: TransferManifest;
  blockCount: number;
  payloadBytesPerBlock: number;
  getFrames(blockIndex: number): Promise<Float32Array>;
}

interface ParsedTemporalBlock {
  sessionId: bigint;
  blockIndex: number;
  blockCount: number;
  payload: Uint8Array;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sessionId(): bigint {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(random[0]!) << 32n) | BigInt(random[1]!);
}

function parseTemporalBlock(bytes: Uint8Array): ParsedTemporalBlock | null {
  if (bytes.length < BLOCK_HEADER_LENGTH || !BLOCK_MAGIC.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(4) !== BLOCK_VERSION) return null;
  const payloadLength = view.getUint32(21, true);
  if (bytes.length !== BLOCK_HEADER_LENGTH + payloadLength) return null;
  const payload = bytes.subarray(BLOCK_HEADER_LENGTH);
  if (crc32(payload) !== view.getUint32(25, true)) return null;
  return { sessionId: view.getBigUint64(5, true), blockIndex: view.getUint32(13, true), blockCount: view.getUint32(17, true), payload: payload.slice() };
}

async function boundedGunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot decompress gzip files");
  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > HARD_FILE_LIMIT) throw new Error("Decompressed output exceeds the protocol limit");
    chunks.push(result.value);
  }
  return concatBytes(...chunks);
}

export async function prepareTemporalTransfer(file: File): Promise<TemporalTransferPlan> {
  const processed: ProcessedFile = await processFileInWorker(file);
  const payloadBytesPerBlock = await qrstaticMaxPayloadBytes();
  if (payloadBytesPerBlock < 256) throw new Error("The temporal transport capacity is too small");

  const transferId = randomBytes(16);
  const manifest: TransferManifest = {
    protocolVersion: 1,
    encryption: "none",
    transferId: bytesToBase64Url(transferId),
    filename: sanitizeFilename(file.name),
    mime: file.type || "application/octet-stream",
    originalLength: processed.originalLength,
    encodedLength: processed.encoded.length,
    compression: processed.compression,
    generationCount: 1,
    sourceBlockSize: payloadBytesPerBlock,
    sha256: bytesToBase64Url(processed.sha256),
  };
  const manifestBytes = utf8(JSON.stringify(manifest));
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, manifestBytes.length, true);
  const combined = concatBytes(prefix, manifestBytes, processed.encoded);
  if (combined.length > HARD_FILE_LIMIT + 256 * 1024) throw new Error("Transfer plan exceeds protocol bounds");

  const blocks: Uint8Array[] = [];
  for (let start = 0; start < combined.length; start += payloadBytesPerBlock) blocks.push(combined.subarray(start, Math.min(start + payloadBytesPerBlock, combined.length)).slice());
  const id = sessionId();
  return {
    manifest,
    blockCount: blocks.length,
    payloadBytesPerBlock,
    getFrames(blockIndex) {
      const payload = blocks[blockIndex];
      if (!payload) return Promise.reject(new Error("Temporal block does not exist"));
      return encodeTemporalBlock(QRSTATIC_KEY, payload, id, blockIndex, blocks.length);
    },
  };
}

export interface TemporalReceivedFile {
  file: File;
  manifest: TransferManifest;
}

export class TemporalTransferReconstructor {
  private readonly blocks = new Map<number, Uint8Array>();
  private expectedSessionId?: bigint;
  private expectedBlockCount?: number;

  get receivedBlocks(): number { return this.blocks.size; }

  async addBlock(bytes: Uint8Array): Promise<TemporalReceivedFile | null> {
    const block = parseTemporalBlock(bytes);
    if (!block) return null;
    if (this.expectedSessionId === undefined) this.expectedSessionId = block.sessionId;
    if (this.expectedBlockCount === undefined) this.expectedBlockCount = block.blockCount;
    if (block.sessionId !== this.expectedSessionId || block.blockCount !== this.expectedBlockCount || block.blockIndex >= block.blockCount) return null;
    this.blocks.set(block.blockIndex, block.payload);
    if (this.blocks.size !== this.expectedBlockCount) return null;

    const ordered = concatBytes(...[...this.blocks.keys()].sort((a, b) => a - b).map((id) => this.blocks.get(id)!));
    if (ordered.length < 4) throw new Error("Temporal transfer manifest is truncated");
    const manifestLength = new DataView(ordered.buffer, ordered.byteOffset, ordered.byteLength).getUint32(0, true);
    if (manifestLength === 0 || manifestLength > ordered.length - 4) throw new Error("Invalid temporal manifest length");
    const manifest = JSON.parse(fromUtf8(ordered.subarray(4, 4 + manifestLength))) as TransferManifest;
    if (manifest.protocolVersion !== 1 || manifest.encryption !== "none") throw new Error("Temporal transfer must use no encryption");
    const encoded = ordered.subarray(4 + manifestLength);
    if (encoded.length !== manifest.encodedLength) throw new Error("Temporal encoded length mismatch");
    const original = manifest.compression === "gzip" ? await boundedGunzip(encoded) : encoded;
    if (original.length !== manifest.originalLength) throw new Error("Temporal original length mismatch");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(original)));
    if (bytesToBase64Url(digest) !== manifest.sha256) throw new Error("Temporal file verification failed");
    // The manifest crossed the optical link, so the name and the type are
    // values that the other device chose. Clean them before they reach a
    // save dialog or a different application.
    const file = new File([toArrayBuffer(original)], sanitizeFilename(manifest.filename), { type: sanitizeMime(manifest.mime) });
    return { file, manifest };
  }
}
