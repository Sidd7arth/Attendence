"use client";

/**
 * Student 1:1 face check-in dialog (rebuilt for the Python engine).
 *
 * Flow: fetch single-use challenge → capture raw frame burst → POST to
 * /api/face/verify (SELF mode) → server runs detection/quality/liveness/
 * 1:1 matching and applies attendance rules → replay verdict.
 * GPS is captured when the user grants permission (stored/validated server-side).
 */

import { useCallback, useEffect, useState } from "react";
import { Camera, CheckCircle2, Loader2, MapPin, ScanFace, ShieldCheck, XCircle } from "lucide-react";
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
import type { FaceVerifyResponse, GpsPayload } from "@/lib/sas/types";
import { dateKey } from "@/lib/sas/dates";
import { useCamera, captureBurst, sampleBrightness } from "@/lib/biometric/capture";

const BURST_COUNT = 4;

type Phase = "boot" | "live" | "countdown" | "uploading" | "success" | "already" | "confirm" | "error";

interface FaceVerifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarked?: () => void;
}

export function FaceVerifyDialog({ open, onOpenChange, onMarked }: FaceVerifyDialogProps) {
  const { videoRef, status: camStatus, errorMessage: camError } = useCamera(open);
  const [phase, setPhase] = useState<Phase>("boot");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [detailLine, setDetailLine] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [successName, setSuccessName] = useState<string>("");
  const [checkInAt, setCheckInAt] = useState<string | null>(null);
  const [pendingStudentId, setPendingStudentId] = useState<string | null>(null);
  const [dim, setDim] = useState(false);

  // Reset-on-close handled by handleOpenChange; camera readiness is derived.

  // Light guidance only.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => {
      const v = sampleBrightness(videoRef.current!);
      setDim(v !== null && v < 45);
    }, 800);
    return () => clearInterval(t);
  }, [phase, videoRef]);

  const getGps = useCallback(async (): Promise<GpsPayload | undefined> => {
    if (!("geolocation" in navigator)) return undefined;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), 5000);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
          });
        },
        () => {
          clearTimeout(timer);
          resolve(undefined);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 30_000 }
      );
    });
  }, []);

  const applyVerdict = useCallback(
    (res: FaceVerifyResponse) => {
      switch (res.reason) {
        case "MATCH_CONFIRMED":
          setSuccessName(res.student?.name ?? "You");
          setCheckInAt(res.record?.checkInAt ?? null);
          setPhase("success");
          onMarked?.();
          return;
        case "ALREADY_MARKED":
          setSuccessName(res.student?.name ?? "You");
          setCheckInAt(res.record?.checkInAt ?? null);
          setPhase("already");
          onMarked?.();
          return;
        case "MATCH_PENDING_CONFIRMATION":
          setPendingStudentId(res.student?.studentId ?? null);
          setPhase("confirm");
          return;
        case "FACE_MISMATCH":
          setPhase("error");
          setErrorText("Face doesn't match your registered biometric profile. Attendance was NOT marked.");
          setDetailLine(res.confidenceBand ? `Match confidence: ${res.confidenceBand}` : null);
          return;
        default:
          setPhase("error");
          setErrorText(verifyErrorText(res.reason, res.error));
          setDetailLine(
            res.liveness && res.reason === "LIVENESS_FAILED"
              ? "A live face is required — photos and screens are rejected."
              : null
          );
          return;
      }
    },
    [onMarked]
  );

  const runVerify = useCallback(
    async (confirmFor?: string) => {
      const video = videoRef.current;
      if (!video) return;
      setPhase("uploading");
      setProgress(15);
      try {
        const challenge = await api.faceChallenge();
        setProgress(25);
        const frames = await captureBurst(video, BURST_COUNT, 320);
        if (frames.length < 3) {
          setPhase("error");
          setErrorText("Could not capture enough frames. Hold still and try again.");
          return;
        }
        setProgress(55);
        const gps = await getGps();
        const res: FaceVerifyResponse = await api.faceVerify({
          frames,
          date: dateKey(),
          challengeId: challenge.challengeId,
          confirmFor,
          gps,
        });
        setProgress(100);
        applyVerdict(res);
      } catch (e) {
        setPhase("error");
        setErrorText(e instanceof ApiError ? e.message : "Verification failed. Please try again.");
      }
    },
    [videoRef, getGps, applyVerdict]
  );

  const startCountdown = useCallback(() => {
    setCountdown(3);
    const tick = () => {
      setCountdown((c) => {
        if (c === null) return null;
        if (c <= 1) {
          void runVerify(undefined);
          return null;
        }
        setTimeout(tick, 800);
        return c - 1;
      });
    };
    setTimeout(tick, 800);
  }, [runVerify]);

  const busy = phase === "uploading" || countdown !== null;
  const cameraReady = camStatus === "live";
  const showLive = (phase === "boot" || phase === "live") && cameraReady;

  function handleOpenChange(o: boolean) {
    if (busy) return;
    if (!o) {
      setPhase("boot");
      setErrorText(null);
      setDetailLine(null);
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
            <ScanFace className="h-5 w-5 text-emerald-600" /> Face check-in
          </DialogTitle>
          <DialogDescription>
            Your face is verified against your registered profile on the school server. Frames are
            analyzed live (anti-spoofing) and your location may be recorded with attendance.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr]">
          <div className="relative overflow-hidden rounded-xl border border-emerald-100 bg-slate-900">
            {/* Mirrored display wrapper — the only mirrored surface */}
            <div className="mirror-wrap relative aspect-video" style={{ transform: "scaleX(-1)" }}>
              <video ref={videoRef} muted playsInline autoPlay className="h-full w-full object-cover" />
              {(showLive || phase === "confirm") && (
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
              {(phase === "success" || phase === "already") && (
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

            {showLive && (
              <>
                <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                  <p className="font-medium">Ready</p>
                  <p className="mt-1 text-xs text-emerald-700">
                    Look straight at the camera inside the oval. The server checks that your face is
                    live — a photo of you will not pass.
                  </p>
                  {dim && <p className="mt-2 text-xs font-medium text-amber-700">It looks dim — find brighter light.</p>}
                </div>
                <Button onClick={startCountdown} disabled={busy} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                  <Camera className="h-4 w-4" /> Check in with face
                </Button>
              </>
            )}

            {phase === "confirm" && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Almost there — one more look</p>
                <p className="mt-1 text-xs">
                  The first match was not confident enough. Hold still and scan again to confirm it&apos;s you.
                </p>
                <Button
                  onClick={() => {
                    setPhase("live");
                    void runVerify(pendingStudentId ?? undefined);
                  }}
                  disabled={busy}
                  className="mt-3 gap-1.5 bg-amber-600 hover:bg-amber-700"
                >
                  <Camera className="h-4 w-4" /> Scan again to confirm
                </Button>
              </div>
            )}

            {phase === "uploading" && (
              <div className="space-y-2 rounded-lg bg-emerald-50 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-900">
                  <ShieldCheck className="h-4 w-4" /> Verifying with the server…
                </p>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-emerald-700">Liveness · quality · identity match</p>
              </div>
            )}

            {(phase === "success" || phase === "already") && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <p className="flex items-center gap-2 font-semibold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  {phase === "success" ? "Attendance marked" : "Already marked today"}
                </p>
                <p className="mt-1 text-xs text-emerald-700">
                  {successName}
                  {checkInAt ? ` · ${new Date(checkInAt).toLocaleTimeString()}` : ""}
                </p>
              </div>
            )}

            {phase === "error" && errorText && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                <p className="flex items-start gap-2 font-medium">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {errorText}
                </p>
                {detailLine && <p className="mt-1 text-xs text-rose-600">{detailLine}</p>}
                <Button variant="outline" size="sm" className="mt-3 border-rose-200" onClick={() => setPhase(camStatus === "live" ? "live" : "boot")}>
                  Try again
                </Button>
              </div>
            )}

            {phase === "live" && (
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <MapPin className="h-3 w-3" /> Location may be attached to your attendance record.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {phase === "success" || phase === "already" ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function verifyErrorText(reason: string, fallback?: string): string {
  switch (reason) {
    case "NO_FACE":
      return "No face was detected. Center your face in the oval and try again.";
    case "MULTIPLE_FACES":
      return "More than one face was detected — only one person may be in frame.";
    case "LOW_IMAGE_QUALITY":
      return "The frames were rejected for quality (blur, lighting or head pose). Improve the light, hold still and face the camera.";
    case "LIVENESS_FAILED":
      return "Liveness check failed. Attendance was NOT marked.";
    case "CHALLENGE_REQUIRED":
    case "CHALLENGE_FAILED":
      return "Your verification session expired. Please try again.";
    case "BIOMETRIC_NOT_ENROLLED":
      return "You don't have an active biometric profile yet. Ask the office to register your face.";
    case "GPS_REQUIRED_MISSING":
      return "This deployment requires a location fix for attendance. Enable location access and try again.";
    case "RATE_LIMITED":
      return "Too many attempts in a short time. Wait about a minute and try again.";
    case "SERVICE_UNREACHABLE":
    case "FACE_MODEL_NOT_READY":
      return "The biometric engine is unavailable right now. Please try again shortly.";
    default:
      return fallback ?? "Verification failed. Please try again.";
  }
}
