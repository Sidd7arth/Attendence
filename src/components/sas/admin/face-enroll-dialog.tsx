"use client";

/**
 * Admin biometric enrollment dialog (rebuilt for the Python engine).
 *
 * The browser captures RAW FRAMES only. Detection, quality, liveness and
 * embedding all happen server-side; this dialog replays the structured
 * verdicts. The preview is mirror-displayed; captured frames are raw.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, ScanFace, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { api, ApiError } from "@/lib/sas/client";
import type { StudentDTO, FaceEnrollResponse } from "@/lib/sas/types";
import { useCamera, captureBurst, sampleBrightness, newNonce } from "@/lib/biometric/capture";

const BURST_COUNT = 4;

type Phase = "boot" | "live" | "countdown" | "uploading" | "done" | "error";

interface FaceEnrollDialogProps {
  student: StudentDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (updated: Partial<StudentDTO>) => void;
}

export function FaceEnrollDialog(props: FaceEnrollDialogProps) {
  // student is null while the dialog is closed — render nothing then.
  if (!props.student) return null;
  return (
    <FaceEnrollDialogInner
      key={props.student.studentId}
      student={props.student}
      open={props.open}
      onOpenChange={props.onOpenChange}
      onSaved={props.onSaved}
    />
  );
}

function FaceEnrollDialogInner({
  student,
  open,
  onOpenChange,
  onSaved,
}: FaceEnrollDialogProps & { student: StudentDTO }) {
  const { videoRef, status: camStatus, errorMessage: camError } = useCamera(open);
  const [phase, setPhase] = useState<Phase>("boot");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<FaceEnrollResponse | null>(null);
  const [dim, setDim] = useState(false);

  // Reset-on-close is handled by handleOpenChange (event handler, not effect).
  // Camera readiness is DERIVED (camStatus), never synced into phase.

  // Coarse light guidance (display only — never a verdict).
  useEffect(() => {
    if (phase !== "live" || camStatus !== "live") return;
    const t = setInterval(() => {
      const v = sampleBrightness(videoRef.current!);
      setDim(v !== null && v < 45);
    }, 800);
    return () => clearInterval(t);
  }, [phase, camStatus, videoRef]);

  const enroll = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setPhase("uploading");
    setProgress(10);
    try {
      const frames = await captureBurst(video, BURST_COUNT, 350);
      if (frames.length < 3) {
        setPhase("error");
        setErrorText("Could not capture enough frames. Try again with steadier lighting.");
        return;
      }
      setProgress(40);
      const nonce = newNonce();
      const res = student.faceRegistered
        ? await api.faceReEnroll(student.studentId, { frames, nonce, timestamp: Date.now() })
        : await api.faceEnroll(student.studentId, { frames, nonce, timestamp: Date.now() });
      setProgress(100);
      if (res.ok) {
        setResult(res);
        setPhase("done");
        onSaved?.({ studentId: student.studentId, faceRegistered: true });
      } else {
        setPhase("error");
        setErrorText(enrollErrorText(res.code, res.error));
      }
    } catch (e) {
      setPhase("error");
      setErrorText(e instanceof ApiError ? e.message : "Enrollment failed. Please try again.");
    }
  }, [videoRef, student.studentId, student.faceRegistered, onSaved]);

  const startCountdown = useCallback(() => {
    setCountdown(3);
    const tick = () => {
      setCountdown((c) => {
        if (c === null) return null;
        if (c <= 1) {
          void enroll();
          return null;
        }
        setTimeout(tick, 800);
        return c - 1;
      });
    };
    setTimeout(tick, 800);
  }, [enroll]);

  const busy = phase === "uploading" || countdown !== null;
  const cameraReady = camStatus === "live";
  const showLive = (phase === "boot" || phase === "live") && cameraReady;
  function handleOpenChange(o: boolean) {
    if (busy) return;
    if (!o) {
      setPhase("boot");
      setErrorText(null);
      setResult(null);
      setProgress(0);
      setCountdown(null);
    }
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[92vw] sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanFace className="h-5 w-5 text-emerald-600" />
            {student.faceRegistered ? "Update face" : "Register face"} — {student.name}
          </DialogTitle>
          <DialogDescription>
            The camera captures a few live frames. Detection, photo-spoof (liveness) checks and the
            biometric template are computed on the server — the browser never verifies anything.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr]">
          {/* Mirrored preview — the ONLY mirrored surface */}
          <div className="relative overflow-hidden rounded-xl border border-emerald-100 bg-slate-900">
            <div className="mirror-wrap relative aspect-video" style={{ transform: "scaleX(-1)" }}>
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className="h-full w-full object-cover"
              />
              {showLive && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-[78%] w-[52%] rounded-[45%] border-2 border-dashed border-emerald-300/80" />
                </div>
              )}
              {countdown !== null && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <span className="text-7xl font-bold text-white drop-shadow">{countdown}</span>
                </div>
              )}
              {phase === "uploading" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-8 w-8 animate-spin text-emerald-300" />
                </div>
              )}
              {phase === "done" && (
                <div className="absolute inset-0 flex items-center justify-center bg-emerald-900/60">
                  <CheckCircle2 className="h-16 w-16 text-emerald-300" />
                </div>
              )}
            </div>
            {camStatus === "starting" && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-emerald-200">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting camera…
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {(camStatus === "denied" || camStatus === "error") && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                <p className="font-medium">Camera unavailable</p>
                <p className="mt-1 text-xs">{camError}</p>
              </div>
            )}
            {!cameraReady && phase !== "done" && camStatus === "starting" && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                <Loader2 className="h-4 w-4 animate-spin" /> Preparing camera…
              </div>
            )}

            {showLive && (
              <>
                <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                  <p className="font-medium">Ready to capture</p>
                  <p className="mt-1 text-xs text-emerald-700">
                    Face the camera directly in good light, inside the oval. Frames are checked for
                    blur, brightness and head pose, and a live-face (anti-spoof) check runs on the
                    server — a photo cannot enroll.
                  </p>
                  {dim && (
                    <p className="mt-2 text-xs font-medium text-amber-700">It looks dim — find brighter light.</p>
                  )}
                </div>
                <Button onClick={startCountdown} disabled={busy} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                  <Camera className="h-4 w-4" /> Capture {BURST_COUNT} live frames
                </Button>
              </>
            )}

            {phase === "uploading" && (
              <div className="space-y-2 rounded-lg bg-emerald-50 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-900">
                  <ShieldCheck className="h-4 w-4" /> Running server-side biometric checks…
                </p>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-emerald-700">Liveness · quality · template creation</p>
              </div>
            )}

            {phase === "done" && result?.ok && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <p className="flex items-center gap-2 font-semibold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" /> Biometric profile saved
                </p>
                <ul className="mt-2 space-y-1 text-xs text-emerald-700">
                  <li>Live frames used: {result.samples}</li>
                  <li>Average quality: {Math.round((result.qualityMean ?? 0) * 100)}%</li>
                  <li>Liveness: passed ({result.liveness?.label})</li>
                  <li>Model: {result.model?.name} · {result.model?.embeddingDim}-D</li>
                </ul>
              </div>
            )}

            {phase === "error" && errorText && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                <p className="flex items-start gap-2 font-medium">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {errorText}
                </p>
                <Button variant="outline" size="sm" className="mt-3 border-rose-200" onClick={() => { setErrorText(null); setPhase("live"); }}>
                  Try again
                </Button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {phase === "done" ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function enrollErrorText(code?: string, fallback?: string): string {
  switch (code) {
    case "NO_FACE":
      return "No face was detected in the captured frames. Center your face in the oval and try again.";
    case "MULTIPLE_FACES":
      return "More than one face was detected. Only one person may be in frame during enrollment.";
    case "LOW_IMAGE_QUALITY":
      return "The frames were rejected for quality (blur, lighting or head pose). Improve the light, hold still and face the camera.";
    case "LIVENESS_FAILED":
      return "Liveness check failed — a photo or screen cannot enroll. Present your live face to the camera.";
    case "ALREADY_ENROLLED":
      return "This student already has an active biometric profile. Use Update face to replace it.";
    case "NOT_ENROLLED":
      return "There is no existing profile to update. Register a face first.";
    case "REPLAY_REJECTED":
      return "The capture was flagged as stale. Please try again.";
    case "RATE_LIMITED":
      return "Too many attempts in a short time. Wait about a minute and try again.";
    case "SERVICE_UNREACHABLE":
    case "FACE_MODEL_NOT_READY":
      return "The biometric engine is unavailable. Please try again shortly.";
    case "GPS_REQUIRED_MISSING":
      return "Location is required but unavailable. Enable location and try again.";
    default:
      return fallback ?? "Enrollment failed. Please try again.";
  }
}
