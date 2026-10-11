"use client";
/**
 * Client capture utilities for the biometric UIs.
 *
 * MIRROR DISCIPLINE (invariant preserved from the previous generation):
 *   - The ONLY mirroring is the display wrapper (CSS scaleX(-1) around the
 *     <video> element). The video element itself is never transformed.
 *   - Frame capture samples the RAW video pixels via canvas drawImage —
 *     CSS transforms never affect canvas sampling, so the server always
 *     receives un-mirrored frames. (Server CV is mirror-agnostic for
 *     detection but this keeps every consumer consistent.)
 *
 * IMPORTANT: this module performs NO biometric verification — no detection,
 * no matching, no quality verdicts. The browser only captures frames and
 * displays previews. Every decision comes from the Python engine.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: "idle" | "starting" | "live" | "denied" | "error";
  errorMessage: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

/** Single authoritative camera lifecycle hook (only getUserMedia site). */
export function useCamera(active: boolean): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<UseCameraResult["status"]>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return;
    setStatus("starting");
    setErrorMessage(null);
    if (!window.isSecureContext) {
      setStatus("error");
      setErrorMessage("Camera access requires a secure (HTTPS) context.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
        // wait until frames are actually flowing
        await new Promise<void>((resolve) => {
          const check = () => {
            if (video.readyState >= 2 && video.videoWidth > 0) resolve();
            else requestAnimationFrame(check);
          };
          check();
        });
      }
      setStatus("live");
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError") {
        setStatus("denied");
        setErrorMessage("Camera permission was denied. Enable it in your browser settings.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setStatus("error");
        setErrorMessage("No usable camera was found on this device.");
      } else {
        setStatus("error");
        setErrorMessage("The camera could not be started.");
      }
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    // Defer start() so state updates never happen synchronously inside the
    // effect body (avoids cascading renders per react-hooks guidance).
    const t = setTimeout(() => void start(), 0);
    return () => {
      clearTimeout(t);
      stop();
    };
  }, [active, start, stop]);

  // Release the hard way on page unload.
  useEffect(() => {
    const handler = () => stop();
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, [stop]);

  return { videoRef, status, errorMessage, start, stop };
}

/** Raw frame → downscaled JPEG base64 (no data-URL prefix). */
export function captureFrameB64(video: HTMLVideoElement, maxWidth = 720, quality = 0.85): string | null {
  if (video.readyState < 2 || video.videoWidth === 0) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;
  const scale = Math.min(1, maxWidth / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return dataUrl.split(",")[1] ?? null;
}

/** Capture N frames spaced by `intervalMs` (a short human burst). */
export async function captureBurst(
  video: HTMLVideoElement,
  count: number,
  intervalMs = 350
): Promise<string[]> {
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    const f = captureFrameB64(video);
    if (f) frames.push(f);
    if (i < count - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return frames;
}

/** Coarse brightness probe for UI guidance only (canvas downsample mean luma).
 *  NOT a quality verdict — the server decides everything. */
export function sampleBrightness(video: HTMLVideoElement): number | null {
  if (video.readyState < 2 || video.videoWidth === 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 36;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, 64, 36);
  const d = ctx.getImageData(0, 0, 64, 36).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  return Math.round(sum / (d.length / 4));
}

/** Anti-replay nonce for enrollment attestation. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(36).padStart(2, "0");
  return s.slice(0, 32);
}
