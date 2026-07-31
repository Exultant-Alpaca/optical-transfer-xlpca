import { useCallback, useEffect, useRef, useState } from "react";

export interface ScanResult { text?: string; bytes?: Uint8Array; }

interface CameraScannerProps {
  label: string;
  instruction: string;
  onDecoded: (result: ScanResult) => void;
  onStop?: () => void;
}

export function CameraScanner({ label, instruction, onDecoded, onStop }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | undefined>(undefined);
  const framePending = useRef(false);
  const captureToken = useRef(0);
  const [status, setStatus] = useState<"idle" | "starting" | "ready" | "denied" | "unsupported">("idle");
  const [message, setMessage] = useState<string>();

  const stop = useCallback(() => {
    captureToken.current += 1;
    const video = videoRef.current;
    const stream = video?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    if (video) video.srcObject = null;
    workerRef.current?.terminate();
    workerRef.current = undefined;
    framePending.current = false;
    setStatus("idle");
    onStop?.();
  }, [onStop]);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setStatus("unsupported"); setMessage("Camera capture requires a secure browser context such as HTTPS or localhost."); return; }
    setStatus("starting");
    setMessage(undefined);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable");
      video.srcObject = stream;
      await video.play();
      workerRef.current = new Worker(new URL("../workers/qrDecoder.worker.ts", import.meta.url), { type: "module" });
      workerRef.current.onmessage = (event: MessageEvent<{ type: string; text?: string; bytes?: ArrayBuffer; message?: string }>) => {
        framePending.current = false;
        if (event.data.type === "decoded") {
          const result: ScanResult = {};
          if (event.data.text) result.text = event.data.text;
          if (event.data.bytes) result.bytes = new Uint8Array(event.data.bytes);
          onDecoded(result);
        }
        if (event.data.type === "error") setMessage(event.data.message);
      };
      setStatus("ready");
      const token = ++captureToken.current;
      const scheduleCapture = () => {
        if (captureToken.current !== token) return;
        if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(() => capture());
        else requestAnimationFrame(capture);
      };
      const capture = () => {
        if (captureToken.current !== token || !workerRef.current) return;
        if (video.videoWidth && video.videoHeight && !framePending.current) {
          const canvas = canvasRef.current;
          const context = canvas?.getContext("2d", { willReadFrequently: true });
          if (canvas && context) {
            const scale = Math.min(1, 1280 / video.videoWidth, 720 / video.videoHeight);
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            framePending.current = true;
            // getImageData hands back a fresh buffer each call, so transferring
            // it is safe and avoids cloning several megabytes per frame.
            workerRef.current.postMessage(
              { type: "decode", frame: frame.data.buffer, width: canvas.width, height: canvas.height, wasmBaseUrl: new URL("wasm/", new URL(import.meta.env.BASE_URL, window.location.origin)).toString() },
              [frame.data.buffer],
            );
          }
        }
        scheduleCapture();
      };
      capture();
    } catch (error: unknown) {
      stop();
      setStatus("denied");
      setMessage(error instanceof DOMException && error.name === "NotAllowedError" ? "Camera access was not granted. You can allow it in browser settings and try again." : "The camera does not start on this device.");
    }
  }, [onDecoded, stop]);

  return (
    <div className="camera-scanner">
      <div className="camera-actions">
        {status === "ready" ? <button className="button quiet" type="button" onClick={stop}>Turn the camera off</button> : <button className="button primary" type="button" onClick={start} disabled={status === "starting"}>{status === "starting" ? "Please wait" : "Turn the camera on"}</button>}
      </div>
      <div className="camera-stage">
        <video ref={videoRef} muted playsInline aria-label={label} />
        <div className="camera-target" aria-hidden="true"><span /></div>
        {status !== "ready" && <div className="camera-idle"><span className="camera-glyph">⌁</span><p>{status === "idle" ? "The camera is off" : status === "starting" ? "The camera starts" : status === "unsupported" ? "No camera is available" : "The camera needs permission"}</p></div>}
      </div>
      <p className="camera-instruction">{instruction}</p>
      {message && <p className="inline-error" role="alert">{message}</p>}
      <canvas ref={canvasRef} className="sr-only" aria-hidden="true" />
    </div>
  );
}
