// Independent implementation guided by the MIT-licensed Decimen Optical
// Transfer fountain design. See docs/adr/0001-reference-decisions.md.
const LN2 = 0.6931471805599453;

function deterministicLog(value: number): number {
  let exponent = 0;
  let mantissa = value;
  while (mantissa >= 1.5) { mantissa /= 2; exponent += 1; }
  while (mantissa < 0.75) { mantissa *= 2; exponent -= 1; }
  const z = (mantissa - 1) / (mantissa + 1);
  const z2 = z * z;
  let term = z;
  let sum = 0;
  for (let n = 1; n <= 21; n += 2) { sum += term / n; term *= z2; }
  return exponent * LN2 + 2 * sum;
}

function splitmix32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let value = state ^ (state >>> 16);
    value = Math.imul(value, 0x21f0aaad);
    value ^= value >>> 15;
    value = Math.imul(value, 0x735a2d97);
    value ^= value >>> 15;
    return value >>> 0;
  };
}

function cdfFor(k: number): Float64Array {
  const cdf = new Float64Array(k);
  if (k === 1) { cdf[0] = 1; return cdf; }
  const robust = Math.max(1, 0.1 * deterministicLog(k / 0.5) * Math.sqrt(k));
  const spike = Math.min(k, Math.ceil(k / robust));
  let total = 0;
  for (let degree = 1; degree <= k; degree += 1) {
    const rho = degree === 1 ? 1 / k : 1 / (degree * (degree - 1));
    const tau = degree < spike ? robust / (degree * k) : degree === spike ? (robust * Math.max(0, deterministicLog(robust / 0.5))) / k : 0;
    total += rho + tau;
    cdf[degree - 1] = total;
  }
  for (let index = 0; index < k; index += 1) cdf[index] = cdf[index]! / total;
  cdf[k - 1] = 1;
  return cdf;
}

function frameSeed(generationSeed: number, sequence: number): number {
  let value = (Math.imul(generationSeed + 1, 0x9e3779b1) ^ (sequence + 0x85ebca6b)) | 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) | 0;
}

function frameIndexes(k: number, cdf: Float64Array, generationSeed: number, sequence: number): number[] {
  const random = splitmix32(frameSeed(generationSeed, sequence));
  const probability = random() * 2 ** -32;
  let low = 0;
  let high = k - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cdf[middle]! >= probability) high = middle; else low = middle + 1;
  }
  const degree = Math.min(k, low + 1);
  if (degree > k >> 3) {
    const scratch = new Uint32Array(k);
    for (let index = 0; index < k; index += 1) scratch[index] = index;
    const result: number[] = [];
    for (let index = 0; index < degree; index += 1) {
      const pick = index + (random() % (k - index));
      [scratch[index], scratch[pick]] = [scratch[pick]!, scratch[index]!];
      result.push(scratch[index]!);
    }
    return result;
  }
  const result = new Set<number>();
  while (result.size < degree) result.add(random() % k);
  return [...result];
}

function xorInto(target: Uint32Array, source: Uint32Array): void {
  for (let index = 0; index < target.length; index += 1) target[index] = (target[index]! ^ source[index]!) >>> 0;
}

export function fountainSeed(transferId: Uint8Array, generationId: number): number {
  let seed = 0x811c9dc5 ^ generationId;
  for (const byte of transferId) seed = Math.imul(seed ^ byte, 0x01000193);
  return seed | 0;
}

// Both ends store source blocks as 32-bit words so the XOR loop stays cheap. The
// encoder therefore lays block `i` down at `i * ceil(blockSize / 4)` words while
// the decoder reassembles at `i * blockSize` bytes. Those two only describe the
// same partition when the block size is word aligned, and a mismatch corrupts
// every byte past the first block instead of failing loudly.
function assertWordAligned(blockSize: number): void {
  if (!Number.isInteger(blockSize) || blockSize <= 0 || blockSize % 4 !== 0) {
    throw new Error(`Fountain block size must be a positive multiple of 4, received ${blockSize}`);
  }
}

export class FountainEncoder {
  readonly blockCount: number;
  private readonly wordCount: number;
  private readonly blocks: Uint32Array;
  private readonly cdf: Float64Array;

  constructor(private readonly payload: Uint8Array, readonly blockSize: number, readonly generationSeed: number) {
    assertWordAligned(blockSize);
    this.blockCount = Math.max(1, Math.ceil(payload.length / blockSize));
    this.wordCount = Math.ceil(blockSize / 4);
    this.blocks = new Uint32Array(this.blockCount * this.wordCount);
    new Uint8Array(this.blocks.buffer).set(payload);
    this.cdf = cdfFor(this.blockCount);
  }

  encode(sequence: number): Uint8Array {
    const output = new Uint32Array(this.wordCount);
    for (const index of frameIndexes(this.blockCount, this.cdf, this.generationSeed, sequence)) {
      const offset = index * this.wordCount;
      for (let word = 0; word < this.wordCount; word += 1) output[word] = (output[word]! ^ this.blocks[offset + word]!) >>> 0;
    }
    return new Uint8Array(output.buffer, 0, this.blockSize).slice();
  }
}

interface PendingFrame { indexes: Set<number>; words: Uint32Array; }

export class FountainDecoder {
  private readonly wordCount: number;
  private readonly cdf: Float64Array;
  private readonly solved: (Uint32Array | null)[];
  private readonly waiting = new Map<number, Set<PendingFrame>>();
  private readonly seen = new Set<number>();
  received = 0;
  duplicates = 0;
  solvedCount = 0;

  constructor(readonly blockCount: number, readonly blockSize: number, readonly generationSeed: number, readonly totalLength: number) {
    assertWordAligned(blockSize);
    this.wordCount = Math.ceil(blockSize / 4);
    this.cdf = cdfFor(blockCount);
    this.solved = new Array<Uint32Array | null>(blockCount).fill(null);
  }

  get complete(): boolean { return this.solvedCount === this.blockCount; }

  add(sequence: number, block: Uint8Array): void {
    if (this.seen.has(sequence)) { this.duplicates += 1; return; }
    this.seen.add(sequence);
    this.received += 1;
    if (this.complete) return;
    const indexes = new Set(frameIndexes(this.blockCount, this.cdf, this.generationSeed, sequence));
    const words = new Uint32Array(this.wordCount);
    new Uint8Array(words.buffer).set(block.subarray(0, this.blockSize));
    for (const index of [...indexes]) {
      const solved = this.solved[index];
      if (solved) { xorInto(words, solved); indexes.delete(index); }
    }
    if (indexes.size === 0) return;
    if (indexes.size === 1) { this.resolve(indexes.values().next().value!, words); return; }
    const pending: PendingFrame = { indexes, words };
    for (const index of indexes) {
      let set = this.waiting.get(index);
      if (!set) { set = new Set(); this.waiting.set(index, set); }
      set.add(pending);
    }
  }

  private resolve(start: number, words: Uint32Array): void {
    const queue: Array<[number, Uint32Array]> = [[start, words]];
    while (queue.length > 0) {
      const [index, value] = queue.pop()!;
      if (this.solved[index]) continue;
      this.solved[index] = value;
      this.solvedCount += 1;
      const waiting = this.waiting.get(index);
      if (!waiting) continue;
      this.waiting.delete(index);
      for (const pending of waiting) {
        xorInto(pending.words, value);
        pending.indexes.delete(index);
        if (pending.indexes.size === 1) {
          const next = pending.indexes.values().next().value!;
          this.waiting.get(next)?.delete(pending);
          if (!this.solved[next]) queue.push([next, pending.words]);
        }
      }
    }
  }

  assemble(): Uint8Array | null {
    if (!this.complete) return null;
    const output = new Uint8Array(this.totalLength);
    for (let index = 0; index < this.blockCount; index += 1) {
      const start = index * this.blockSize;
      const length = Math.min(this.blockSize, this.totalLength - start);
      if (length > 0) output.set(new Uint8Array(this.solved[index]!.buffer, 0, length), start);
    }
    return output;
  }
}
