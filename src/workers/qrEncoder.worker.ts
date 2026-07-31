import { writeQrSymbol } from "../services/qr";

interface EncodeRequest {
  type: "encode";
  id: number;
  frame: ArrayBuffer;
}

// One QR symbol costs roughly 20 ms to rasterise, so a single thread cannot
// reach the high-density frame rate. The sender runs a pool of these and paints
// whatever has arrived; fountain frames are order independent, so a symbol that
// comes back late is still useful.
self.onmessage = (event: MessageEvent<EncodeRequest>) => {
  if (event.data.type !== "encode") return;
  const { id, frame } = event.data;
  writeQrSymbol(new Uint8Array(frame))
    .then((symbol) => {
      const data = new Uint8Array(symbol.data);
      self.postMessage({ type: "symbol", id, width: symbol.width, height: symbol.height, data: data.buffer }, [data.buffer]);
    })
    .catch((error: unknown) => self.postMessage({ type: "error", id, message: error instanceof Error ? error.message : "The software cannot make the QR code" }));
};
