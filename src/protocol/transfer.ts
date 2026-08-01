import { DEFAULT_IMAGE_PRESET, DEFAULT_PROFILE, GENERATION_PLAIN_LIMIT, HARD_FILE_LIMIT, MAX_GENERATIONS, PROFILES, type ImageQualityPreset, type TransmissionProfile } from "../config/policy";
import { bytesToBase64Url, concatBytes, fromUtf8, randomBytes, toArrayBuffer, utf8 } from "./bytes";
import { decryptGeneration, derivePassphraseKey, encryptGeneration, PASSPHRASE_KDF, type GenerationCryptoContext } from "./crypto";
import { buildFrameHeader, packFrame, parseFrame } from "./frame";
import { FountainDecoder, FountainEncoder, fountainSeed } from "./fountain";
import { normalizePassphrase } from "./passphrase";
import { processFileInWorker, sanitizeFilename, sanitizeMime, type ProcessedFile, type RecodedMediaInfo } from "../services/fileProcessing";

export interface TransferManifest {
  protocolVersion: 1;
  encryption: "none" | "aes-gcm";
  keyDerivation?: typeof PASSPHRASE_KDF;
  transferId: string;
  filename: string;
  mime: string;
  originalLength: number;
  encodedLength: number;
  compression: "none" | "gzip";
  generationCount: number;
  sourceBlockSize: number;
  sha256: string;
  /**
   * Present only when the sender re-encoded visual media. Provenance for the
   * receiver, never a verification input: sha256 always covers the bytes that
   * were actually transmitted.
   */
  recoded?: RecodedMediaInfo;
}

export interface TransferGeneration {
  id: number;
  plainLength: number;
  encoded: Uint8Array;
  encoder: FountainEncoder;
}

export interface TransferPlan {
  manifest: TransferManifest;
  generations: TransferGeneration[];
  profile: TransmissionProfile;
  nextFrame(sequence: number): Uint8Array;
}

export async function prepareTransfer(file: File, profile: TransmissionProfile = DEFAULT_PROFILE, imagePreset: ImageQualityPreset = DEFAULT_IMAGE_PRESET, passphrase?: string): Promise<TransferPlan> {
  const processed: ProcessedFile = await processFileInWorker(file, imagePreset);
  const selectedProfile = PROFILES[profile];
  const transferId = randomBytes(16);
  const normalizedPassphrase = passphrase ? normalizePassphrase(passphrase) : "";
  const encryption = normalizedPassphrase ? "aes-gcm" as const : "none" as const;
  const encryptionKey = normalizedPassphrase ? await derivePassphraseKey(normalizedPassphrase, transferId) : undefined;
  let generationCount = 1;
  let finalManifest: TransferManifest | undefined;
  let combined = new Uint8Array();
  // The manifest carries the generation count, so serialising it can change its
  // own length and therefore the count. Keep rebuilding until the count is the
  // count derived from the actual bytes that will be sent.
  for (let pass = 0; pass < MAX_GENERATIONS; pass += 1) {
    const manifest: TransferManifest = {
      protocolVersion: 1,
      encryption,
      ...(encryption === "aes-gcm" ? { keyDerivation: PASSPHRASE_KDF } : {}),
      transferId: bytesToBase64Url(transferId),
      filename: sanitizeFilename(processed.filename),
      mime: processed.mime,
      originalLength: processed.originalLength,
      encodedLength: processed.encoded.length,
      compression: processed.compression,
      generationCount,
      sourceBlockSize: selectedProfile.sourceBlockSize,
      sha256: bytesToBase64Url(processed.sha256),
      ...(processed.recoded ? { recoded: processed.recoded } : {}),
    };
    const manifestBytes = utf8(JSON.stringify(manifest));
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, manifestBytes.length, true);
    combined = concatBytes(prefix, manifestBytes, processed.encoded);
    const nextCount = Math.max(1, Math.ceil(combined.length / GENERATION_PLAIN_LIMIT));
    if (nextCount === generationCount) {
      finalManifest = manifest;
      break;
    }
    generationCount = nextCount;
  }
  if (!finalManifest) throw new Error("Could not settle the transfer generation count");
  // Split on the bytes we actually have. The fixed point above makes this an
  // assertion rather than a second, potentially divergent source of truth.
  const splitCount = Math.max(1, Math.ceil(combined.length / GENERATION_PLAIN_LIMIT));
  if (splitCount !== finalManifest.generationCount) throw new Error("Transfer generation count mismatch");
  if (splitCount > MAX_GENERATIONS || combined.length > HARD_FILE_LIMIT + 256 * 1024) throw new Error("Transfer plan exceeds protocol bounds");
  const generations: TransferGeneration[] = [];
  for (let id = 0; id < splitCount; id += 1) {
    const start = id * GENERATION_PLAIN_LIMIT;
    const plaintext = combined.subarray(start, Math.min(start + GENERATION_PLAIN_LIMIT, combined.length));
    const context: GenerationCryptoContext = {
      transferId,
      generationId: id,
      generationCount: splitCount,
      plainLength: plaintext.length,
      encodedLength: encryption === "aes-gcm" ? plaintext.length + 28 : plaintext.length,
    };
    const encoded = encryptionKey ? await encryptGeneration(encryptionKey, plaintext, context) : plaintext.slice();
    generations.push({ id, plainLength: plaintext.length, encoded, encoder: new FountainEncoder(encoded, selectedProfile.sourceBlockSize, fountainSeed(transferId, id)) });
  }
  return {
    manifest: finalManifest,
    generations,
    profile,
    nextFrame(sequence: number): Uint8Array {
      const generation = generations[sequence % generations.length]!;
      const generationSequence = Math.floor(sequence / generations.length);
      const block = generation.encoder.encode(generationSequence);
      return packFrame(buildFrameHeader({ transferId, generationId: generation.id, generationCount: generations.length, sequence: generationSequence, sourceBlockCount: generation.encoder.blockCount, sourceBlockSize: selectedProfile.sourceBlockSize, encodedLength: generation.encoded.length, plainLength: generation.plainLength }), block);
    },
  };
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

export interface ReceivedFile {
  file: File;
  manifest: TransferManifest;
}

export interface ReceiveProgress {
  /** Frames that parsed and belong to this transfer. */
  accepted: number;
  /** Frames that were readable QR codes but not part of this transfer. */
  rejected: number;
  generationsSeen: number;
  generationCount: number;
  solvedBlocks: number;
  totalBlocks: number;
  /** How much of the whole file is recovered, 0 to 1, for a plain progress bar. */
  fraction: number;
  /** Base64url transfer ID this receiver has locked onto, once one is known. */
  transferId?: string | undefined;
}

export class TransferReconstructor {
  private readonly decoders = new Map<number, FountainDecoder>();
  private readonly completed = new Map<number, Uint8Array>();
  private generationCount = 0;
  private expectedTransferId: Uint8Array | undefined;
  private accepted = 0;
  private rejected = 0;
  private keyPromise: Promise<CryptoKey> | undefined;
  private readonly passphrase: string | undefined;

  constructor(passphrase?: string) {
    const normalized = passphrase ? normalizePassphrase(passphrase) : "";
    this.passphrase = normalized || undefined;
  }

  get progress(): ReceiveProgress {
    let solvedBlocks = 0;
    let totalBlocks = 0;
    for (const decoder of this.decoders.values()) {
      solvedBlocks += decoder.solvedCount;
      totalBlocks += decoder.blockCount;
    }
    // Only the generations seen so far have a known block count, so project the
    // rest from their average. Without that the bar would race to 100 percent on
    // the first generation and then fall back as later ones appear.
    const started = this.decoders.size;
    const projected = started > 0 && this.generationCount > 0
      ? (totalBlocks / started) * this.generationCount
      : totalBlocks;
    const fraction = projected > 0 ? Math.min(1, solvedBlocks / projected) : 0;
    return {
      accepted: this.accepted,
      rejected: this.rejected,
      generationsSeen: this.completed.size,
      generationCount: this.generationCount,
      solvedBlocks,
      totalBlocks,
      fraction,
      transferId: this.expectedTransferId ? bytesToBase64Url(this.expectedTransferId) : undefined,
    };
  }

  /**
   * Forget every partially decoded generation. Quick mode locks onto the first
   * transfer ID it sees, so a sender that restarts (new ID) would otherwise be
   * ignored forever with no way back other than reloading the page.
   */
  reset(): void {
    this.decoders.clear();
    this.completed.clear();
    this.generationCount = 0;
    this.accepted = 0;
    this.rejected = 0;
    this.expectedTransferId = undefined;
    this.keyPromise = undefined;
  }

  private async decryptIfNeeded(encoded: Uint8Array, header: {
    transferId: Uint8Array;
    generationId: number;
    generationCount: number;
    plainLength: number;
    encodedLength: number;
  }): Promise<Uint8Array> {
    if (!this.passphrase) return encoded;
    if (!this.expectedTransferId) throw new Error("Transfer session is not established");
    this.keyPromise ??= derivePassphraseKey(this.passphrase, this.expectedTransferId);
    return decryptGeneration(await this.keyPromise, encoded, header);
  }

  async addFrame(bytes: Uint8Array): Promise<ReceivedFile | null> {
    const frame = parseFrame(bytes, this.expectedTransferId);
    if (!frame) { this.rejected += 1; return null; }
    if (!this.expectedTransferId) this.expectedTransferId = frame.header.transferId.slice();
    if (this.generationCount === 0) this.generationCount = frame.header.generationCount;
    if (frame.header.generationCount !== this.generationCount) { this.rejected += 1; return null; }
    this.accepted += 1;
    let decoder = this.decoders.get(frame.header.generationId);
    if (!decoder) {
      decoder = new FountainDecoder(frame.header.sourceBlockCount, frame.header.sourceBlockSize, fountainSeed(frame.header.transferId, frame.header.generationId), frame.header.encodedLength);
      this.decoders.set(frame.header.generationId, decoder);
    }
    decoder.add(frame.header.sequence, frame.block);
    // Decryption and final verification are both terminal for the frames they
    // consume: a failure means this set of generations is wrong, not that more
    // frames are needed. Without dropping the set, the bad generation stays
    // cached and every later frame re-runs the same failure forever.
    try {
      if (decoder.complete && !this.completed.has(frame.header.generationId)) {
        const encoded = decoder.assemble();
        if (!encoded) return null;
        const plaintext = await this.decryptIfNeeded(encoded, frame.header);
        this.completed.set(frame.header.generationId, plaintext);
      }
      if (this.completed.size !== this.generationCount) return null;
      return await this.assemble();
    } catch (error: unknown) {
      this.reset();
      throw error;
    }
  }

  private async assemble(): Promise<ReceivedFile> {
    const expectedTransferId = this.expectedTransferId;
    if (!expectedTransferId) throw new Error("Transfer session is not established");
    const ordered = concatBytes(...[...this.completed.keys()].sort((a, b) => a - b).map((id) => this.completed.get(id)!));
    if (ordered.length < 4) throw new Error("Transfer manifest is truncated");
    const manifestLength = new DataView(ordered.buffer, ordered.byteOffset, ordered.byteLength).getUint32(0, true);
    if (manifestLength === 0 || manifestLength > ordered.length - 4) throw new Error("Invalid manifest length");
    const manifest = JSON.parse(fromUtf8(ordered.subarray(4, 4 + manifestLength))) as TransferManifest;
    if (manifest.protocolVersion !== 1 || manifest.transferId !== bytesToBase64Url(expectedTransferId)) throw new Error("Manifest session mismatch");
    if (manifest.generationCount !== this.generationCount) throw new Error("Manifest generation count mismatch");
    if (manifest.encryption === "aes-gcm") {
      if (!this.passphrase) throw new Error("Passphrase required for this transfer");
      if (manifest.keyDerivation !== PASSPHRASE_KDF) throw new Error("Unsupported passphrase key derivation");
    } else if (manifest.encryption === "none") {
      if (this.passphrase) throw new Error("This transfer is not encrypted");
    } else {
      throw new Error("Unsupported transfer mode");
    }
    const encoded = ordered.subarray(4 + manifestLength);
    if (encoded.length !== manifest.encodedLength) throw new Error("Encoded length mismatch");
    const original = manifest.compression === "gzip" ? await boundedGunzip(encoded) : encoded;
    if (original.length !== manifest.originalLength) throw new Error("Original length mismatch");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(original)));
    const digestText = bytesToBase64Url(digest);
    if (digestText !== manifest.sha256) throw new Error("File verification failed");
    // The manifest crossed the optical link, so the name and the type are
    // values that the other device chose. Clean them before they reach a
    // save dialog or a different application.
    const file = new File([toArrayBuffer(original)], sanitizeFilename(manifest.filename), { type: sanitizeMime(manifest.mime) });
    return { file, manifest };
  }
}
