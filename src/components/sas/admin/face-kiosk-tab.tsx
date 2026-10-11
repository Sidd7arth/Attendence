"use client";

/**
 * Admin Face Kiosk (rebuilt for the Python engine).
 *
 * The kiosk operator (ADMIN) scans whoever is at the camera. Raw frames go
 * to /api/face/verify in KIOSK mode; the server identifies 1:N with a
 * strict ambiguity margin and marks attendance. Medium-band matches require
 * a second confirming scan. No browser-side biometrics.
 */

import { useCallback, useEffect, useState } from "react";
import { Camera, CheckCircle2, Loader2, RefreshCw, ScanFace, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError } from "@/lib/sas/client";
import type { FaceVerifyResponse, GpsPayload, RosterRow } from "@/lib/sas/types";
import { dateKey, formatDateLabel, formatTime } from "@/lib/sas/dates";
import { useCamera, captureBurst, sampleBrightness } from "@/lib/biometric/capture";

const BURST_COUNT = 4;
const COOLDOWN_MS = 2500;

type Banner =
  | { kind: "success"; text: string }
  | { kind: "already"; text: string }
  | { kind: "confirm"; text: string }
  | { kind: "error"; text: string }
  | null;

export function FaceKioskTab() {
  const { toast } = useToast();
  const today = dateKey();
  const { videoRef, status: camStatus, errorMessage: camError } = useCamera(true);
  const [scanning, setScanning] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [pendingStudentId, setPendingStudentId] = useState<string | null>(null);
  const [dim, setDim] = useState(false);
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadDay = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.adminRoster(today);
      setRoster(res.roster);
    } catch {
      // silent — polling
    } finally {
      setRefreshing(false);
    }
  }, [today]);

  useEffect(() => {
    loadDay();
    const t = setInterval(loadDay, 30_000);
    return () => clearInterval(t);
  }, [loadDay]);

  useEffect(() => {
    if (!videoRef.current) return;
    const t = setInterval(() => {
      const v = sampleBrightness(videoRef.current!);
      setDim(v !== null && v < 45);
    }, 1000);
    return () => clearInterval(t);
  }, [camStatus, videoRef]);

  const getGps = useCallback(async (): Promise<GpsPayload | undefined> => {
    if (!("geolocation" in navigator)) return undefined;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), 4000);
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
        { enableHighAccuracy: true, timeout: 4000, maximumAge: 60_000 }
      );
    });
  }, []);

  const applyVerdict = useCallback(
    (res: FaceVerifyResponse) => {
      switch (res.reason) {
        case "MATCH_CONFIRMED":
          setBanner({
            kind: "success",
            text: `✓ ${res.student?.name} (${res.student?.rollNumber}) — attendance marked`,
          });
          void loadDay();
          return;
        case "ALREADY_MARKED":
          setBanner({
            kind: "already",
            text: `${res.student?.name} already checked in today`,
          });
          return;
        case "MATCH_PENDING_CONFIRMATION":
          setPendingStudentId(res.student?.studentId ?? null);
          setBanner({
            kind: "confirm",
            text: `Possible match: ${res.student?.name} — scan again to confirm`,
          });
          return;
        case "FACE_MISMATCH":
          setBanner({ kind: "error", text: "No matching student — attendance NOT marked" });
          return;
        default:
          setBanner({
            kind: "error",
            text: kioskErrorText(res.reason, res.error),
          });
          return;
      }
    },
    [loadDay]
  );

  const scan = useCallback(
    async (confirmFor?: string) => {
      const video = videoRef.current;
      if (!video || scanning) return;
      setScanning(true);
      setBanner(null);
      try {
        const frames = await captureBurst(video, BURST_COUNT, 320);
        if (frames.length < 3) {
          setBanner({ kind: "error", text: "Could not capture enough frames — try again." });
          return;
        }
        const gps = await getGps();
        const res: FaceVerifyResponse = await api.faceVerify({
          frames,
          date: today,
          confirmFor,
          gps,
        });
        applyVerdict(res);
      } catch (e) {
        setBanner({
          kind: "error",
          text: e instanceof ApiError ? e.message : "Verification failed — try again.",
        });
      } finally {
        setScanning(false);
        setCooldown(true);
        setTimeout(() => setCooldown(false), COOLDOWN_MS);
      }
    },
    [videoRef, scanning, today, getGps, applyVerdict]
  );

  // Today's face check-ins + simple stats from the roster
  const faceCheckins = (roster ?? []).filter((r) => r.attendance?.method === "FACE");
  const marked = (roster ?? []).filter((r) => r.attendance);
  const present = (roster ?? []).filter(
    (r) => r.attendance && (r.attendance.status === "PRESENT" || r.attendance.status === "LATE")
  ).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      {/* Camera card */}
      <Card className="min-w-0 border-emerald-100">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ScanFace className="h-5 w-5 text-emerald-600" /> Attendance Camera
          </CardTitle>
          <CardDescription>
            Position the student in the oval, then scan. The server detects, quality-checks,
            anti-spoofs and identifies — a photo will be rejected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative min-w-0 overflow-hidden rounded-xl border border-emerald-100 bg-slate-900">
            {/* Mirrored display wrapper — the only mirrored surface */}
            <div className="mirror-wrap relative aspect-video" style={{ transform: "scaleX(-1)" }}>
              <video ref={videoRef} muted playsInline autoPlay className="h-full w-full object-cover" />
              {!scanning && camStatus === "live" && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-[80%] w-[54%] rounded-[45%] border-2 border-dashed border-emerald-300/80" />
                </div>
              )}
              {scanning && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-9 w-9 animate-spin text-emerald-300" />
                </div>
              )}
            </div>
            {camStatus !== "live" && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 text-sm text-emerald-200">
                {camStatus === "starting" ? (
                  <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Starting camera…</span>
                ) : (
                  <span className="px-6 text-center">{camError ?? "Camera unavailable."}</span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void scan(pendingStudentId ?? undefined)}
              disabled={camStatus !== "live" || scanning || cooldown}
              className="h-14 flex-1 gap-2 bg-emerald-600 text-base hover:bg-emerald-700"
            >
              {scanning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              {scanning ? "Verifying…" : pendingStudentId ? "Scan again to confirm" : "Scan student"}
            </Button>
            {dim && camStatus === "live" && (
              <span className="text-xs font-medium text-amber-700">Low light — results may degrade</span>
            )}
          </div>

          {banner && (
            <div
              role="status"
              className={`rounded-lg border p-3 text-sm font-medium ${
                banner.kind === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : banner.kind === "already"
                    ? "border-teal-200 bg-teal-50 text-teal-800"
                    : banner.kind === "confirm"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              <span className="flex items-start gap-2">
                {banner.kind === "success" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                {banner.text}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Today panel */}
      <Card className="min-w-0 border-emerald-100">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Today · {formatDateLabel(today)}</CardTitle>
              <CardDescription>Camera check-ins and daily totals</CardDescription>
            </div>
            <Button variant="outline" size="icon" onClick={loadDay} aria-label="Refresh" className="border-emerald-200">
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-emerald-50 p-3 text-center">
              <p className="text-xl font-bold text-emerald-800">{present}</p>
              <p className="text-xs text-emerald-700">present</p>
            </div>
            <div className="rounded-lg bg-teal-50 p-3 text-center">
              <p className="text-xl font-bold text-teal-800">{faceCheckins.length}</p>
              <p className="text-xs text-teal-700">face check-ins</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-center">
              <p className="text-xl font-bold text-slate-700">{(roster?.length ?? 0) - marked.length}</p>
              <p className="text-xs text-slate-600">unmarked</p>
            </div>
          </div>

          {faceCheckins.length === 0 ? (
            <p className="rounded-lg border border-dashed border-emerald-200 p-6 text-center text-sm text-muted-foreground">
              No face check-ins yet today.
            </p>
          ) : (
            <ul className="max-h-[24rem] space-y-2 overflow-y-auto sas-scroll pr-1">
              {faceCheckins.map((r) => (
                <li key={r.attendance!.attendanceId} className="flex items-center justify-between rounded-lg border border-emerald-100 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.student.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.student.rollNumber} · Class {r.student.class} · {formatTime(r.attendance!.checkInAt)}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                    face
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function kioskErrorText(reason: string, fallback?: string): string {
  switch (reason) {
    case "NO_FACE":
      return "No face detected — position the student in the oval.";
    case "MULTIPLE_FACES":
      return "Multiple faces detected — only one student may be in frame.";
    case "LOW_IMAGE_QUALITY":
      return "Image quality rejected (blur/light/pose) — improve lighting and hold still.";
    case "LIVENESS_FAILED":
      return "Liveness check failed — a photo or screen cannot check in.";
    case "BIOMETRIC_NOT_ENROLLED":
      return "No registered biometric profiles (or none matched this student's stage).";
    case "GPS_REQUIRED_MISSING":
      return "Location is required in this deployment — enable GPS on this device.";
    case "RATE_LIMITED":
      return "Too many scans in a short time — wait a moment.";
    case "SERVICE_UNREACHABLE":
    case "FACE_MODEL_NOT_READY":
      return "Biometric engine unavailable — check the biometric service.";
    default:
      return fallback ?? "Verification failed — try again.";
  }
}
