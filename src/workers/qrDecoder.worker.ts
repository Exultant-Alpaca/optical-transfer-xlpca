import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

// The frame arrives as a transferred RGBA buffer rather than an ImageData so it
// moves between threads instead of being cloned. A 1280x720 frame is 3.7 MB, and
// copying that for every captured frame starved the decode loop on phones.
interface DecodeRequest { type: "decode"; frame: ArrayBuffer; width: number; height: number; wasmBaseUrl: string; }

let configured = "";
let modulePromise: Promise<unknown> | undefined;

async function decode(request: DecodeRequest): Promise<void> {
  if (request.frame.byteLength !== request.width * request.height * 4) {
    self.postMessage({ type: "error", message: "The captured frame was the wrong size." });
    return;
  }
  const imageData = new ImageData(new Uint8ClampedArray(request.frame), request.width, request.height);
  if (configured !== request.wasmBaseUrl) {
    configured = request.wasmBaseUrl;
    modulePromise = prepareZXingModule({
      fireImmediately: true,
      overrides: { locateFile: (path: string, prefix: string) => path.endsWith(".wasm") ? `${request.wasmBaseUrl}${path}` : `${prefix}${path}` },
    });
  }
  try { await modulePromise; } catch (error) { configured = ""; modulePromise = undefined; throw error; }
  const results = await readBarcodes(imageData, { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 1 });
  const result = results[0];
  if (!result) {
    self.postMessage({ type: "empty" });
    return;
  }
  const rawBytes = "bytes" in result && result.bytes instanceof Uint8Array ? result.bytes : undefined;
  const bytes = rawBytes?.slice();
  const text = result.text || (bytes ? new TextDecoder().decode(bytes) : undefined);
  self.postMessage({ type: "decoded", text, bytes: bytes?.buffer }, bytes ? [bytes.buffer] : []);
}

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  if (event.data.type !== "decode") return;
  decode(event.data).catch((error: unknown) => self.postMessage({ type: "error", message: error instanceof Error ? error.message : "QR decoding failed" }));
};
