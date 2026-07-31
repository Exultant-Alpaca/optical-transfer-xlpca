import { useEffect, useRef, useState } from "react";
import { prepareTemporalTransfer, TemporalTransferReconstructor } from "../protocol/temporalTransfer";
import { downloadBlob } from "../services/gif";
import { buildTemporalGif } from "../services/gifExport";
import {
  QRSTATIC_FRAME_COUNT, QRSTATIC_FRAME_HEIGHT, QRSTATIC_FRAME_INTERVAL_MS, QRSTATIC_FRAME_WIDTH,
  qrstaticWasmUrl, temporalFrameToImageData,
} from "../services/qrstatic";

type Stage = "idle" | "running" | "done" | "failed";

interface DemoResult {
  filename: string;
  bytes: number;
  text: string;
  blocks: number;
}

const FRAME_PIXELS = QRSTATIC_FRAME_WIDTH * QRSTATIC_FRAME_HEIGHT;
const DEFAULT_MESSAGE = "hello from qrstatic";

/** Decodes one 64-frame window off the main thread, as the camera receiver used to. */
function decodeWindow(worker: Worker, frames: Float32Array): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const copy = frames.slice();
    worker.onmessage = (event: MessageEvent<{ type: string; block?: ArrayBuffer; message?: string }>) => {
      if (event.data.type === "decoded" && event.data.block) resolve(new Uint8Array(event.data.block));
      else if (event.data.type === "empty") resolve(null);
      else reject(new Error(event.data.message ?? "The QRStatic decode did not operate"));
    };
    worker.onerror = () => reject(new Error("The QRStatic decoder stopped"));
    worker.postMessage({ type: "decode", frames: copy.buffer, wasmUrl: qrstaticWasmUrl() }, [copy.buffer]);
  });
}

export function QrStaticDemoPage({ onBack }: { onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [stage, setStage] = useState<Stage>("idle");
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<DemoResult>();
  const [window64, setWindow64] = useState<Float32Array>();

  // Play whichever window is current at the encoder's own frame rate. This is
  // what the sending screen showed in the old camera mode.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !window64) return;
    canvas.width = QRSTATIC_FRAME_WIDTH;
    canvas.height = QRSTATIC_FRAME_HEIGHT;
    let frame = 0;
    const timer = globalThis.setInterval(() => {
      context.putImageData(temporalFrameToImageData(window64.subarray(frame * FRAME_PIXELS, (frame + 1) * FRAME_PIXELS)), 0, 0);
      frame = (frame + 1) % QRSTATIC_FRAME_COUNT;
    }, QRSTATIC_FRAME_INTERVAL_MS);
    return () => globalThis.clearInterval(timer);
  }, [window64]);

  const saveGif = () => {
    if (!window64) return;
    try {
      downloadBlob(buildTemporalGif(window64), "qrstatic-window.gif");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The software cannot make the GIF file.");
    }
  };

  const run = async () => {
    setStage("running");
    setError(undefined);
    setResult(undefined);
    setStatus("Encoding");
    const worker = new Worker(new URL("../workers/qrstaticDecoder.worker.ts", import.meta.url), { type: "module" });
    try {
      const file = new File([message || DEFAULT_MESSAGE], "message.txt", { type: "text/plain" });
      const plan = await prepareTemporalTransfer(file);
      const reconstructor = new TemporalTransferReconstructor();

      for (let index = 0; index < plan.blockCount; index += 1) {
        setStatus(`Window ${index + 1} of ${plan.blockCount}`);
        const frames = await plan.getFrames(index);
        setWindow64(frames);
        const block = await decodeWindow(worker, frames);
        if (!block) throw new Error(`The decoder did not accept window ${index + 1}.`);
        const received = await reconstructor.addBlock(block);
        if (received) {
          setResult({ filename: received.file.name, bytes: received.file.size, text: await received.file.text(), blocks: plan.blockCount });
          setStage("done");
          setStatus(undefined);
          return;
        }
      }
      throw new Error("The windows decoded, but the software cannot assemble the file.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The QRStatic demonstration did not operate.");
      setStage("failed");
      setStatus(undefined);
    } finally {
      worker.terminate();
    }
  };

  return <main>
    <button className="back-button" type="button" onClick={onBack}>Back</button>
    <h1>QRStatic demo</h1>
    <p className="lede">
      QRStatic hides a QR code in noise. Each frame looks like static. The code becomes visible only when
      the software compares 64 frames with the key. This page encodes and decodes the data in this browser.
    </p>

    <label className="passphrase-field">
      <span className="field-label">The message to encode</span>
      <input type="text" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={DEFAULT_MESSAGE} />
    </label>
    <div className="button-row">
      <button className="button primary" type="button" onClick={() => void run()} disabled={stage === "running"}>
        {stage === "running" ? "Please wait" : "Start the demonstration"}
      </button>
      <button className="button" type="button" onClick={saveGif} disabled={!window64}>Download the GIF file</button>
    </div>
    {status && <p className="note">{status}</p>}

    <div className="demo-stage">
      <canvas ref={canvasRef} aria-label="The QRStatic noise frames" />
    </div>

    <p className="note">
      The GIF file contains the 64 frames of this window. It is approximately 7 MB, because noise does
      not compress. Most programs that show a GIF also make it more slow than the encoder specifies.
    </p>

    <table className="demo-facts">
      <tbody>
        <tr><th scope="row">Window</th><td>{QRSTATIC_FRAME_COUNT} frames of {QRSTATIC_FRAME_WIDTH} x {QRSTATIC_FRAME_HEIGHT}</td></tr>
        <tr><th scope="row">Decoder</th><td>Correlation with a key, tile parity, one CRC32 for each block</td></tr>
        <tr><th scope="row">Blocks</th><td>{result ? result.blocks : "-"}</td></tr>
      </tbody>
    </table>

    {result && <div className="demo-result">
      <p><strong>The decode is correct.</strong> {result.filename}, {result.bytes} bytes. The SHA-256 value agrees.</p>
      <p><code>{result.text}</code></p>
    </div>}
    {error && <p className="alert" role="alert">{error}</p>}

    <h2>Why this is not a transfer mode</h2>
    <p>
      The codec moves each cell of the frame to a different position in each frame. Thus the decoder needs
      the same pixel positions and the same frame sequence that the encoder made. A camera cannot give
      either one. The tests in <code>native/qrstatic-wasm/</code> measure this. One pixel of movement, one
      frame of offset, or a small blur stops the decode. The window above always decodes correctly.
    </p>
    <p>
      Use <strong>Quick QR</strong> mode or <strong>Passphrase</strong> mode to send a file. See
      <code> docs/qrstatic-notes.md</code> for the changes that a camera version needs.
    </p>
  </main>;
}
