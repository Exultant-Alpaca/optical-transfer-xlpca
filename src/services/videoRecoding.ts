import {
  IMAGE_RECODE_MIN_BYTES, MEDIA_PRESETS, MEDIA_RECODE_MIN_SAVING, VIDEO_RECODE_MAX_SECONDS,
  supportsVideoRecoding, type ImageQualityPreset,
} from "../config/policy";

export interface RecodedVideo {
  file: File;
  width: number;
  height: number;
}

interface RecorderFormat {
  mimeType: string;
  outputMime: "video/mp4" | "video/webm";
  extension: "mp4" | "webm";
}

const RECORDER_FORMATS: RecorderFormat[] = [
  { mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", outputMime: "video/mp4", extension: "mp4" },
  { mimeType: "video/webm;codecs=vp9,opus", outputMime: "video/webm", extension: "webm" },
  { mimeType: "video/webm;codecs=vp8,opus", outputMime: "video/webm", extension: "webm" },
  { mimeType: "video/mp4", outputMime: "video/mp4", extension: "mp4" },
  { mimeType: "video/webm", outputMime: "video/webm", extension: "webm" },
];

function recorderFormat(): RecorderFormat | null {
  if (typeof MediaRecorder === "undefined") return null;
  return RECORDER_FORMATS.find(({ mimeType }) => MediaRecorder.isTypeSupported(mimeType)) ?? null;
}

function renamed(filename: string, extension: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  return `${stem}.${extension}`;
}

function eventOnce(target: EventTarget, type: string, errorType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("The browser cannot read this video.")); };
    const cleanup = () => {
      target.removeEventListener(type, done);
      target.removeEventListener(errorType, failed);
    };
    target.addEventListener(type, done, { once: true });
    target.addEventListener(errorType, failed, { once: true });
  });
}

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Re-records a short video with browser-native media APIs. It downloads no
 * codec and uploads no data. Unsupported browsers return null, as do outputs
 * that are not clearly smaller than the input.
 */
export async function recodeVideoFile(file: File, preset: ImageQualityPreset, onProgress?: (percent: number) => void): Promise<RecodedVideo | null> {
  let lastProgress = -1;
  const report = (percent: number) => {
    const next = Math.max(0, Math.min(100, Math.round(percent)));
    if (next === lastProgress) return;
    lastProgress = next;
    onProgress?.(next);
  };
  report(0);
  if (preset === "original" || !supportsVideoRecoding(file.type)) return null;
  if (file.size < IMAGE_RECODE_MIN_BYTES) return null;
  if (typeof document === "undefined" || typeof AudioContext === "undefined") return null;
  const format = recorderFormat();
  if (!format) return null;

  const audioContext = new AudioContext();
  try {
    await audioContext.resume();
    if (audioContext.state !== "running") return null;
  } catch {
    await audioContext.close().catch(() => undefined);
    return null;
  }

  const video = document.createElement("video");
  video.preload = "auto";
  video.playsInline = true;
  const sourceUrl = URL.createObjectURL(file);
  video.src = sourceUrl;

  let canvasStream: MediaStream | undefined;
  let combinedStream: MediaStream | undefined;
  let animationFrame = 0;
  let videoFrame = 0;
  let timeout = 0;
  try {
    await eventOnce(video, "loadeddata", "error");
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > VIDEO_RECODE_MAX_SECONDS) return null;

    const setting = MEDIA_PRESETS[preset];
    const longestEdge = Math.max(video.videoWidth, video.videoHeight);
    if (longestEdge <= 0) return null;
    const scale = Math.min(1, setting.videoMaxEdge / longestEdge);
    const width = evenDimension(video.videoWidth * scale);
    const height = evenDimension(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;

    canvasStream = canvas.captureStream(setting.videoFramesPerSecond);
    const mediaSource = audioContext.createMediaElementSource(video);
    const audioDestination = audioContext.createMediaStreamDestination();
    mediaSource.connect(audioDestination);
    combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ]);

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(combinedStream, {
      mimeType: format.mimeType,
      videoBitsPerSecond: setting.videoBitsPerSecond,
      audioBitsPerSecond: setting.audioBitsPerSecond,
    });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const stopped = eventOnce(recorder, "stop", "error");
    const ended = eventOnce(video, "ended", "error");

    let lastDrawnAt = -Infinity;
    const draw = (mediaTime: number) => {
      if (mediaTime - lastDrawnAt >= 1 / setting.videoFramesPerSecond || video.ended) {
        context.drawImage(video, 0, 0, width, height);
        lastDrawnAt = mediaTime;
        report((mediaTime / video.duration) * 96);
      }
    };
    const requestVideoFrame = () => {
      videoFrame = video.requestVideoFrameCallback((_now, metadata) => {
        draw(metadata.mediaTime);
        if (!video.ended) requestVideoFrame();
      });
    };
    const requestAnimation = () => {
      draw(video.currentTime);
      if (!video.ended) animationFrame = requestAnimationFrame(requestAnimation);
    };

    context.drawImage(video, 0, 0, width, height);
    recorder.start(1_000);
    if (typeof video.requestVideoFrameCallback === "function") requestVideoFrame();
    else requestAnimation();

    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = window.setTimeout(() => reject(new Error("Video compression took too long.")), video.duration * 1_000 + 30_000);
    });
    await video.play();
    await Promise.race([ended, timedOut]);
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    report(100);

    const blob = new Blob(chunks, { type: format.outputMime });
    if (blob.size === 0 || blob.size >= file.size * MEDIA_RECODE_MIN_SAVING) return null;
    return {
      file: new File([blob], renamed(file.name, format.extension), { type: format.outputMime }),
      width,
      height,
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
    if (animationFrame) cancelAnimationFrame(animationFrame);
    if (videoFrame && typeof video.cancelVideoFrameCallback === "function") video.cancelVideoFrameCallback(videoFrame);
    video.pause();
    video.removeAttribute("src");
    video.load();
    canvasStream?.getTracks().forEach((track) => track.stop());
    combinedStream?.getTracks().forEach((track) => track.stop());
    await audioContext.close().catch(() => undefined);
    URL.revokeObjectURL(sourceUrl);
  }
}
