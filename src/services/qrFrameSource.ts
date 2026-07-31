import type { QrSymbol } from "./qr";

interface PendingSymbol { id: number; symbol: QrSymbol }

/**
 * Keeps a small queue of rasterised QR symbols ahead of the display loop.
 *
 * The QR encoder is the slow part of sending, not the fountain or the paint, so
 * the loop can only hold a high frame rate if symbols are produced in parallel
 * and ahead of time. Frames are order independent, so the queue hands back
 * whatever finished first.
 */
export class QrFrameSource {
  private readonly workers: Worker[] = [];
  private readonly ready: PendingSymbol[] = [];
  private inFlight = 0;
  private nextId = 0;
  private stopped = false;
  private failure?: string;

  constructor(
    private readonly nextFrame: (sequence: number) => Uint8Array,
    private readonly depth = 8,
    workerCount = Math.min(6, Math.max(2, (navigator.hardwareConcurrency ?? 4) - 2)),
  ) {
    for (let index = 0; index < workerCount; index += 1) {
      const worker = new Worker(new URL("../workers/qrEncoder.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ type: string; id: number; width?: number; height?: number; data?: ArrayBuffer; message?: string }>) => {
        this.inFlight -= 1;
        if (event.data.type === "symbol" && event.data.data) {
          this.ready.push({
            id: event.data.id,
            symbol: { data: new Uint8ClampedArray(event.data.data), width: event.data.width!, height: event.data.height! },
          });
        } else if (event.data.type === "error") {
          this.failure ??= event.data.message ?? "QR encoding failed";
        }
        this.fill();
      };
      worker.onerror = () => { this.failure ??= "The QR encoder stopped."; };
      this.workers.push(worker);
    }
    this.fill();
  }

  /** The oldest symbol that is ready, or undefined while the queue is refilling. */
  take(): QrSymbol | undefined {
    const next = this.ready.shift();
    this.fill();
    return next?.symbol;
  }

  /** Waits for the next symbol. Used when collecting a fixed run of frames. */
  async next(): Promise<QrSymbol> {
    while (!this.stopped) {
      const ready = this.take();
      if (ready) return ready;
      if (this.failure) throw new Error(this.failure);
      await new Promise((resolve) => globalThis.setTimeout(resolve, 4));
    }
    throw new Error("The QR encoder stopped");
  }

  get error(): string | undefined { return this.failure; }

  get buffered(): number { return this.ready.length; }

  stop(): void {
    this.stopped = true;
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.ready.length = 0;
  }

  private fill(): void {
    if (this.stopped || this.failure) return;
    while (this.ready.length + this.inFlight < this.depth) {
      const frame = this.nextFrame(this.nextId);
      const worker = this.workers[this.nextId % this.workers.length];
      if (!worker) return;
      const copy = frame.slice();
      worker.postMessage({ type: "encode", id: this.nextId, frame: copy.buffer }, [copy.buffer]);
      this.nextId += 1;
      this.inFlight += 1;
    }
  }
}
