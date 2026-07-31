import { MAX_ENCODED_LENGTH, MAX_GENERATIONS, MAX_SOURCE_BLOCK_SIZE, MAX_SOURCE_BLOCKS, PROTOCOL_MAGIC, PROTOCOL_VERSION } from "../config/policy";
import { constantTimeEqual, concatBytes } from "./bytes";

export const FRAME_HEADER_LENGTH = 48;
export const FRAME_TYPE_DATA = 1;

interface FrameHeader {
  transferId: Uint8Array;
  generationId: number;
  generationCount: number;
  sequence: number;
  sourceBlockCount: number;
  sourceBlockSize: number;
  encodedLength: number;
  plainLength: number;
}

export interface ParsedFrame {
  header: FrameHeader;
  block: Uint8Array;
}

function magicBytes(): Uint8Array {
  return new TextEncoder().encode(PROTOCOL_MAGIC);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function packFrame(header: FrameHeader, block: Uint8Array): Uint8Array {
  if (header.transferId.length !== 16) throw new Error("Transfer ID must be 128-bit");
  if (block.length !== header.sourceBlockSize) throw new Error("Invalid source block length");
  const output = new Uint8Array(FRAME_HEADER_LENGTH + block.length);
  const view = new DataView(output.buffer);
  output.set(magicBytes(), 0);
  view.setUint8(4, PROTOCOL_VERSION);
  view.setUint8(5, FRAME_TYPE_DATA);
  output.set(header.transferId, 6);
  view.setUint16(22, header.generationId, true);
  view.setUint16(24, header.generationCount, true);
  view.setUint32(26, header.sequence, true);
  view.setUint32(30, header.sourceBlockCount, true);
  view.setUint16(34, header.sourceBlockSize, true);
  view.setUint32(36, header.encodedLength, true);
  view.setUint32(40, header.plainLength, true);
  output.set(block, FRAME_HEADER_LENGTH);
  view.setUint32(44, 0, true);
  view.setUint32(44, crc32(output), true);
  return output;
}

export function parseFrame(bytes: Uint8Array, expectedTransferId?: Uint8Array): ParsedFrame | null {
  if (bytes.length < FRAME_HEADER_LENGTH) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expectedMagic = magicBytes();
  if (!constantTimeEqual(bytes.subarray(0, 4), expectedMagic) || view.getUint8(4) !== PROTOCOL_VERSION || view.getUint8(5) !== FRAME_TYPE_DATA) return null;
  const transferId = bytes.slice(6, 22);
  if (expectedTransferId && !constantTimeEqual(transferId, expectedTransferId)) return null;
  const header: FrameHeader = {
    transferId,
    generationId: view.getUint16(22, true),
    generationCount: view.getUint16(24, true),
    sequence: view.getUint32(26, true),
    sourceBlockCount: view.getUint32(30, true),
    sourceBlockSize: view.getUint16(34, true),
    encodedLength: view.getUint32(36, true),
    plainLength: view.getUint32(40, true),
  };
  if (header.generationCount === 0 || header.generationCount > MAX_GENERATIONS || header.generationId >= header.generationCount) return null;
  if (header.sourceBlockCount === 0 || header.sourceBlockCount > MAX_SOURCE_BLOCKS || header.sourceBlockSize < 32 || header.sourceBlockSize > MAX_SOURCE_BLOCK_SIZE) return null;
  // The fountain codec partitions blocks as 32-bit words on both ends, so a
  // block size that is not word aligned would silently misalign reassembly.
  if (header.sourceBlockSize % 4 !== 0) return null;
  if (header.sourceBlockCount * header.sourceBlockSize < header.encodedLength) return null;
  if (header.encodedLength === 0 || header.encodedLength > MAX_ENCODED_LENGTH || header.plainLength === 0 || header.plainLength > header.encodedLength) return null;
  if (bytes.length !== FRAME_HEADER_LENGTH + header.sourceBlockSize) return null;
  const providedCrc = view.getUint32(44, true);
  const copy = bytes.slice();
  new DataView(copy.buffer).setUint32(44, 0, true);
  if (crc32(copy) !== providedCrc) return null;
  return { header, block: bytes.subarray(FRAME_HEADER_LENGTH) };
}

export function frameForBlock(header: FrameHeader, block: Uint8Array): Uint8Array {
  return packFrame(header, block);
}

export function buildFrameHeader(input: FrameHeader): FrameHeader {
  return { ...input, transferId: input.transferId.slice() };
}

export function headerBytes(header: FrameHeader): Uint8Array {
  return concatBytes(header.transferId, new Uint8Array([header.generationId & 0xff]));
}
