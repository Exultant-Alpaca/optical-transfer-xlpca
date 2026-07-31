import { decodeTemporalBlock, QRSTATIC_FRAME_COUNT, QRSTATIC_FRAME_HEIGHT, QRSTATIC_FRAME_WIDTH, QRSTATIC_KEY } from "../services/qrstatic";

interface DecodeRequest {
  type: "decode";
  frames: ArrayBuffer;
  wasmUrl: string;
}

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  if (event.data.type !== "decode") return;
  const expected = QRSTATIC_FRAME_COUNT * QRSTATIC_FRAME_WIDTH * QRSTATIC_FRAME_HEIGHT;
  const frames = new Float32Array(event.data.frames);
  if (frames.length !== expected) {
    self.postMessage({ type: "error", message: "The window of frames is not complete." });
    return;
  }
  decodeTemporalBlock(QRSTATIC_KEY, frames, event.data.wasmUrl)
    .then((block) => {
      if (!block) {
        self.postMessage({ type: "empty" });
        return;
      }
      self.postMessage({ type: "decoded", block: block.buffer }, [block.buffer]);
    })
    .catch((error: unknown) => self.postMessage({ type: "error", message: error instanceof Error ? error.message : "The QRStatic decode did not operate" }));
};
