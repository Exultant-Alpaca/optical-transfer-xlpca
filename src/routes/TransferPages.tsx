import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_IMAGE_PRESET, DEFAULT_PROFILE, FOUNTAIN_OVERHEAD, frameIntervalMs, GENERATION_PLAIN_LIMIT,
  IMAGE_PRESETS, PROFILES, receiverUrl,
  type ImageQualityPreset, type TransferMode, type TransmissionProfile,
} from "../config/policy";
import { CameraScanner, type ScanResult } from "../components/CameraScanner";
import { QRCodePanel } from "../components/QRCodePanel";
import { generatePassphrase, isPassphraseValid, normalizePassphrase, PASSPHRASE_PART_COUNT } from "../protocol/passphrase";
import { prepareTransfer, TransferReconstructor, type ReceiveProgress, type ReceivedFile, type TransferPlan } from "../protocol/transfer";
import { validateFile } from "../services/fileProcessing";
import { downloadBlob } from "../services/gif";
import { buildTransferGif, gifFrameBudget } from "../services/gifExport";
import { symbolToImageData } from "../services/qr";
import { QrFrameSource } from "../services/qrFrameSource";

type Route = "home" | "send" | "receive";
type SendStage = "link" | "choose" | "preparing" | "sending";
type ReceiveStage = "start" | "receiving" | "done";

function passphraseRequested(): boolean {
  return new URLSearchParams(window.location.search).get("mode") === "passphrase";
}

function modeWasSelectedInLink(): boolean {
  return new URLSearchParams(window.location.search).has("mode");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function estimateTransferSeconds(byteLength: number, profile: TransmissionProfile = DEFAULT_PROFILE): number {
  const { sourceBlockSize, framesPerSecond } = PROFILES[profile];
  const generations = Math.max(1, Math.ceil(byteLength / GENERATION_PLAIN_LIMIT));
  const onWire = byteLength + generations * 28 + 512;
  const blocks = Math.max(1, Math.ceil(onWire / sourceBlockSize));
  return (blocks * FOUNTAIN_OVERHEAD) / framesPerSecond;
}

export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  if (seconds < 3_600) return `${Math.ceil(seconds / 60)} minutes`;
  const hours = seconds / 3_600;
  return hours < 2 ? "over an hour" : `about ${Math.round(hours)} hours`;
}

function Steps({ current, total }: { current: number; total: number }) {
  return <p className="steps">Step {current} of {total}</p>;
}

function Panel({ step, steps, title, lede, children }: { step?: number; steps?: number; title: string; lede?: string; children: ReactNode }) {
  return <div className="panel">
    {step !== undefined && steps !== undefined && <Steps current={step} total={steps} />}
    <h1>{title}</h1>
    {lede && <p className="lede">{lede}</p>}
    {children}
  </div>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>;
}

function modeLabel(mode: TransferMode): string {
  return mode === "passphrase" ? "Passphrase" : "Quick QR";
}

function PassphraseDisplay({ passphrase, compact = false }: { passphrase: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(passphrase);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      setCopied(false);
    }
  };
  return <div className={compact ? "passphrase-display compact" : "passphrase-display"}>
    <div className="passphrase-heading"><span className="field-label">Passphrase</span><button type="button" className="copy-button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button></div>
    <code className="passphrase-value">{passphrase}</code>
    {!compact && <Note>Give all {PASSPHRASE_PART_COUNT} parts to the other person. The software uses the phrase on this device only. It does not send the phrase.</Note>}
  </div>;
}

function ModePicker({ mode, onChange, disabled = false }: { mode: TransferMode; onChange: (mode: TransferMode) => void; disabled?: boolean }) {
  const options: Array<{ value: TransferMode; label: string; detail: string }> = [
    { value: "quick", label: "Quick QR", detail: "Most reliable. No encryption." },
    { value: "passphrase", label: "Passphrase", detail: "AES-GCM. You type a phrase." },
  ];
  return <div className="segment-field mode-field">
    <span className="field-label">Mode</span>
    <div className="segment" role="group" aria-label="Mode">
      {options.map((option) => <button
        key={option.value}
        type="button"
        className={mode === option.value ? "segment-item selected" : "segment-item"}
        onClick={() => onChange(option.value)}
        disabled={disabled}
      >
        <strong>{option.label}</strong>
        <small>{option.detail}</small>
      </button>)}
    </div>
  </div>;
}

function FileRow({ name, detail, onChange }: { name: string; detail: string; onChange?: () => void }) {
  return <div className="file-row">
    <span className="file-row-body"><strong>{name}</strong><small>{detail}</small></span>
    {onChange && <button type="button" className="link-button" onClick={onChange}>Change</button>}
  </div>;
}

function PhotoQuality({ preset, onChange }: { preset: ImageQualityPreset; onChange: (preset: ImageQualityPreset) => void }) {
  return <div className="segment-field">
    <span className="field-label">Photo size</span>
    <div className="segment" role="group" aria-label="Photo size">
      {(Object.keys(IMAGE_PRESETS) as ImageQualityPreset[]).map((key) => <button key={key} type="button" className={preset === key ? "segment-item selected" : "segment-item"} onClick={() => onChange(key)}>
        <strong>{IMAGE_PRESETS[key].label}</strong>
        <small>{IMAGE_PRESETS[key].detail}</small>
      </button>)}
    </div>
    <Note>{preset === "original" ? "The software sends each photo without a change." : "The software can make a large photo smaller on this device. This makes the transfer more quick. It sends all other files without a change."}</Note>
  </div>;
}

const SPEED_OPTIONS: Record<TransmissionProfile, { label: string; detail: string }> = {
  conservative: { label: "Compatibility", detail: "For old cameras" },
  balanced: { label: "Balanced", detail: "Use this speed first" },
  "high-density": { label: "High density", detail: "2,896 bytes in each frame" },
};

function TransmissionSpeed({ profile, onChange }: { profile: TransmissionProfile; onChange: (profile: TransmissionProfile) => void }) {
  return <div className="segment-field speed-field">
    <span className="field-label">Transmission speed</span>
    <div className="segment" role="group" aria-label="Transmission speed">
      {(Object.keys(SPEED_OPTIONS) as TransmissionProfile[]).map((key) => <button key={key} type="button" className={profile === key ? "segment-item selected" : "segment-item"} onClick={() => onChange(key)}>
        <strong>{SPEED_OPTIONS[key].label}</strong>
        <small>{SPEED_OPTIONS[key].detail}</small>
      </button>)}
    </div>
    <Note>The other device reads the speed from the frames. Select Compatibility if the camera does not read the codes.</Note>
  </div>;
}

/**
 * Sizes the sending pattern to whatever the window leaves over.
 *
 * The pattern is the physical layer, so its size on the glass decides whether
 * the camera can resolve a module. A fixed size wastes a desktop window and
 * overflows a phone, so measure everything that is not the pattern and give the
 * pattern the rest.
 */
function useSendingStageSize(stageRef: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    let frame = 0;
    let applied = 0;
    const measure = () => {
      const stage = stageRef.current;
      const wrapper = stage?.parentElement;
      const panel = wrapper?.parentElement;
      const main = panel?.closest("main");
      const header = document.querySelector(".app-header");
      const footer = document.querySelector(".app-footer");
      if (!wrapper || !panel || !main || !header || !footer) return;

      // Add up only what is not the pattern. Reading the shell height instead
      // would feed back on itself, because the shell has a 100vh floor: as the
      // pattern shrank the floor held the total steady and the pattern kept
      // shrinking.
      const mainStyle = getComputedStyle(main);
      const padding = parseFloat(mainStyle.paddingTop) + parseFloat(mainStyle.paddingBottom);
      // offsetHeight excludes margins, so add the pattern's own margins back.
      const wrapperStyle = getComputedStyle(wrapper);
      const margins = parseFloat(wrapperStyle.marginTop) + parseFloat(wrapperStyle.marginBottom);
      const rest = panel.scrollHeight - wrapper.offsetHeight;
      const reserved = Math.max(180, (header as HTMLElement).offsetHeight + (footer as HTMLElement).offsetHeight + padding + margins + rest + 16);
      if (Math.abs(reserved - applied) > 4) {
        applied = reserved;
        document.documentElement.style.setProperty("--qr-reserved", `${reserved}px`);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    window.addEventListener("orientationchange", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("orientationchange", schedule);
      document.documentElement.style.removeProperty("--qr-reserved");
    };
  }, [stageRef]);
}

function SendingScreen({ plan, passphrase, onStop }: { plan: TransferPlan; passphrase?: string | undefined; onStop: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const [elapsed, setElapsed] = useState(0);
  const [rate, setRate] = useState<{ fps: number; bytesPerSecond: number }>();
  const [gif, setGif] = useState<{ done: number; total: number }>();

  useEffect(() => {
    let active = true;
    let lock: WakeLockSentinel | undefined;
    let animation = 0;
    let painted = 0;
    let windowStart = performance.now();
    let due = windowStart;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const interval = frameIntervalMs(plan.profile);
    const source = new QrFrameSource(plan.nextFrame);

    const paint = (now: number) => {
      if (!active) return;
      animation = requestAnimationFrame(paint);
      if (source.error) { setError(source.error); return; }
      // Animation frames land on a 16.7 ms grid, so a frame that is due within
      // half a tick is painted now rather than waiting a whole tick for it.
      if (now < due - 8) return;

      const symbol = source.take();
      if (!symbol) return; // The queue is refilling; hold the current frame.
      if (canvas.width !== symbol.width) { canvas.width = symbol.width; canvas.height = symbol.height; }
      context.putImageData(symbolToImageData(symbol), 0, 0);
      // Advance from the deadline, not from now, so the average rate holds.
      due = Math.max(now, due + interval);
      painted += 1;

      // Report what the device actually sustains rather than the target, since
      // that is the number that decides whether a transfer finishes on time.
      if (now - windowStart >= 1_000) {
        const seconds = (now - windowStart) / 1_000;
        setRate({ fps: painted / seconds, bytesPerSecond: (painted * PROFILES[plan.profile].sourceBlockSize) / seconds });
        painted = 0;
        windowStart = now;
      }
    };

    navigator.wakeLock?.request("screen").then((next) => { lock = next; }).catch(() => undefined);
    animation = requestAnimationFrame(paint);
    const ticker = window.setInterval(() => { if (active) setElapsed((value) => value + 1); }, 1_000);
    return () => {
      active = false;
      cancelAnimationFrame(animation);
      window.clearInterval(ticker);
      source.stop();
      lock?.release().catch(() => undefined);
    };
  }, [plan]);

  useSendingStageSize(stageRef);

  const budget = gifFrameBudget(plan);
  const exportGif = async () => {
    setGif({ done: 0, total: budget.needed });
    setError(undefined);
    try {
      const blob = await buildTransferGif(plan, (done, total) => setGif({ done, total }));
      downloadBlob(blob, `${plan.manifest.filename}.qr.gif`);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The software cannot make the GIF file.");
    } finally {
      setGif(undefined);
    }
  };

  const remaining = Math.max(0, estimateTransferSeconds(plan.manifest.encodedLength, plan.profile) - elapsed);
  const recoded = plan.manifest.recoded;
  return <div className="panel sending-panel">
    <div className="qr-stage">
      <div className="sending-stage" ref={stageRef}>
        <canvas ref={canvasRef} aria-label="The QR pattern that contains the file" />
      </div>
    </div>
    <p className="sending-line">
      <strong>{plan.manifest.filename}</strong>
      <span>{recoded ? `${formatBytes(recoded.sourceLength)} photo, sent as ${formatBytes(plan.manifest.originalLength)}` : formatBytes(plan.manifest.originalLength)}</span>
      <span>{remaining > 0 ? `${formatDuration(remaining)} for one pass` : "the stream repeats"}</span>
      <span className="rate">{rate ? `${rate.fps.toFixed(0)} fps, ${(rate.bytesPerSecond / 1024).toFixed(0)} kB/s` : "measuring"}</span>
    </p>
    {passphrase && <PassphraseDisplay passphrase={passphrase} compact />}
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="button-row">
      <button className="button" type="button" onClick={() => void exportGif()} disabled={gif !== undefined || !budget.withinBudget} title={budget.withinBudget ? `This makes a GIF file of ${budget.needed} frames` : `This file needs ${budget.needed} frames. That is more than a GIF file can hold.`}>
        {gif ? `GIF ${Math.round((gif.done / Math.max(1, gif.total)) * 100)}%` : "Download GIF"}
      </button>
      <button className="button quiet" type="button" onClick={onStop}>Stop</button>
    </div>
  </div>;
}

export function TransferSendPage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const [mode, setMode] = useState<TransferMode>("quick");
  const [profile, setProfile] = useState<TransmissionProfile>(DEFAULT_PROFILE);
  const [imagePreset, setImagePreset] = useState<ImageQualityPreset>(DEFAULT_IMAGE_PRESET);
  const [stage, setStage] = useState<SendStage>("link");
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<TransferPlan>();
  const [passphrase, setPassphrase] = useState(() => generatePassphrase());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const restart = () => {
    setStage("link");
    setFile(null);
    setPlan(undefined);
    setError(undefined);
    setBusy(false);
    setPassphrase(generatePassphrase());
  };

  const chooseMode = (next: TransferMode) => {
    if (next === "passphrase" && mode !== "passphrase") setPassphrase(generatePassphrase());
    setMode(next);
  };

  const selectFile = (next: File | undefined) => {
    if (!next) return;
    const problem = validateFile(next);
    if (problem) { setError(problem); return; }
    setFile(next);
    setError(undefined);
  };

  const prepareFile = async () => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    setStage("preparing");
    try {
      setPlan(await prepareTransfer(file, profile, imagePreset, mode === "passphrase" ? passphrase : undefined));
      setStage("sending");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The software cannot prepare this file. Select a different file.");
      setStage("choose");
    } finally {
      setBusy(false);
    }
  };

  return <main className="flow">
    <div><button className="back-button" type="button" onClick={() => stage === "link" ? onNavigate("home") : restart()}>{stage === "link" ? "Back" : "Start over"}</button></div>

    {stage === "link" && <Panel step={1} steps={3} title="Open the receiver" lede="Read this code with the other device. It opens the Receive page in the selected mode." >
      <div className="qr-stage"><QRCodePanel value={receiverUrl(window.location.origin, mode)} label="The link to the Receive page" /></div>
      <ModePicker mode={mode} onChange={chooseMode} />
      {mode === "passphrase" && <PassphraseDisplay passphrase={passphrase} />}
      <button className="button primary full-width" type="button" onClick={() => setStage("choose")}>The other device is ready</button>
      <Note>The link contains the mode. Thus the two devices use the same mode.</Note>
    </Panel>}

    {stage === "choose" && <Panel step={2} steps={3} title="Select a file" lede="Send one file at a time. The maximum size is 10 MB.">
      <ModePicker mode={mode} onChange={setMode} disabled />
      <Note>You selected the mode before you opened the link on the other device.</Note>
      {mode === "passphrase" && <PassphraseDisplay passphrase={passphrase} />}
      {mode === "quick" && <TransmissionSpeed profile={profile} onChange={setProfile} />}
      {file ? <FileRow name={file.name} detail={formatBytes(file.size)} onChange={() => setFile(null)} /> : <label className="picker">
        <input type="file" onChange={(event) => selectFile(event.target.files?.[0])} />
        <strong>Select a file</strong><small>Any file. The maximum size is 10 MB.</small>
      </label>}
      {mode === "quick" && <PhotoQuality preset={imagePreset} onChange={setImagePreset} />}
      {error && <p className="alert" role="alert">{error}</p>}
      <button className="button primary full-width" type="button" onClick={() => void prepareFile()} disabled={!file || busy}>{busy ? "Please wait" : "Start the transfer"}</button>
    </Panel>}

    {stage === "preparing" && <div className="panel"><span className="spinner" /><h1>Please wait</h1><p className="lede">This browser prepares the file. Keep this page open.</p></div>}

    {stage === "sending" && plan && <SendingScreen plan={plan} passphrase={mode === "passphrase" ? passphrase : undefined} onStop={restart} />}
  </main>;
}

function ReceivingProgress({ progress }: { progress?: ReceiveProgress | undefined }) {
  const percent = Math.round((progress?.fraction ?? 0) * 100);
  const started = (progress?.accepted ?? 0) > 0;
  return <div className="progress-block">
    <div className="progress-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="File received"><span className="progress-fill" style={{ width: `${Math.max(started ? 3 : 0, percent)}%` }} /></div>
    <p className="progress-label">{started ? <><strong>{percent}%</strong> received</> : "Looking for the other screen"}</p>
  </div>;
}

export function TransferReceivePage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const modeFromLink = modeWasSelectedInLink();
  const [mode, setMode] = useState<TransferMode>(() => passphraseRequested() ? "passphrase" : "quick");
  const [stage, setStage] = useState<ReceiveStage>("start");
  const [error, setError] = useState<string>();
  const [passphrase, setPassphrase] = useState("");
  const [progress, setProgress] = useState<ReceiveProgress>();
  const [sawFrames, setSawFrames] = useState(false);
  const [received, setReceived] = useState<ReceivedFile>();
  const reconstructor = useRef<TransferReconstructor | undefined>(undefined);

  const begin = () => {
    if (mode === "passphrase" && !isPassphraseValid(passphrase)) {
      setError(`Type all ${PASSPHRASE_PART_COUNT} parts of the passphrase before you start.`);
      return;
    }
    setError(undefined);
    setProgress(undefined);
    setSawFrames(false);
    setReceived(undefined);
    reconstructor.current = new TransferReconstructor(mode === "passphrase" ? normalizePassphrase(passphrase) : undefined);
    setStage("receiving");
  };

  const listenAgain = () => {
    reconstructor.current?.reset();
    setProgress(reconstructor.current?.progress);
    setSawFrames(false);
    setError(undefined);
  };

  const scanFrame = async (result: ScanResult) => {
    const current = reconstructor.current;
    if (!result.bytes || !current) return;
    setSawFrames(true);
    try {
      const next = await current.addFrame(result.bytes);
      setProgress(current.progress);
      if (next) { setReceived(next); setStage("done"); }
    } catch {
      setProgress(current.progress);
      setError(mode === "passphrase" ? "The passphrase does not open this transfer. Start again and examine each part." : "The frames were not complete. Tell the other person to start again.");
    }
  };

  const save = () => {
    if (!received) return;
    const url = URL.createObjectURL(received.file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = received.file.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const share = async () => {
    if (!received || !navigator.share) { setError("This browser cannot send the file to another app. Use Save."); return; }
    try { await navigator.share({ files: [received.file], title: received.file.name }); }
    catch (caught: unknown) { if (!(caught instanceof DOMException && caught.name === "AbortError")) setError("The software cannot send the file to another app. Use Save."); }
  };

  const ignoringEverything = sawFrames && progress !== undefined && progress.accepted === 0;
  return <main className="flow">
    <div><button className="back-button" type="button" onClick={() => stage === "start" ? onNavigate("home") : setStage("start")}>{stage === "start" ? "Back" : "Start over"}</button></div>

    {stage === "start" && <Panel title="Receive a file" lede="Select a mode. Then point this camera at the other screen.">
      <ModePicker mode={mode} onChange={setMode} disabled={modeFromLink} />
      {modeFromLink && <Note>The other device selected {modeLabel(mode)} in the link.</Note>}
      {mode === "passphrase" && <label className="passphrase-field">
        <span className="field-label">Type the passphrase from the other device</span>
        <input type="text" inputMode="text" autoComplete="off" autoCapitalize="none" spellCheck={false} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="amber-river ..." />
        <Note>Type all {PASSPHRASE_PART_COUNT} parts. Capital letters and extra spaces have no effect.</Note>
      </label>}
      <button className="button primary full-width" type="button" onClick={begin}>Start the receiver</button>
      {error && <p className="alert" role="alert">{error}</p>}
    </Panel>}

    {stage === "receiving" && <Panel title="Point at the other screen" lede="Keep all of the pattern in the view of the camera until the file arrives.">
      <CameraScanner label="The other screen" instruction="Keep all of the QR pattern in the view." onDecoded={(result) => void scanFrame(result)} />
      <ReceivingProgress progress={progress} />
      {ignoringEverything && <div className="alert" role="alert"><p>This pattern is from a different transfer.</p><button type="button" className="link-button" onClick={listenAgain}>Look for a new transfer</button></div>}
      {error && <p className="alert" role="alert">{error}</p>}
    </Panel>}

    {stage === "done" && received && <div className="panel">
      <span className="done-mark">✓</span><h1>The transfer is complete</h1>
      <FileRow name={received.file.name} detail={formatBytes(received.file.size)} />
      <div className="button-row"><button className="button primary" type="button" onClick={save}>Save</button><button className="button secondary" type="button" onClick={share}>Share</button></div>
      {received.manifest.recoded && <Note>The other device made this photo smaller before it sent the photo.</Note>}
      <button className="button quiet full-width" type="button" onClick={() => { setReceived(undefined); setStage("start"); }}>Receive one more file</button>
      {error && <p className="alert" role="alert">{error}</p>}
    </div>}
  </main>;
}
