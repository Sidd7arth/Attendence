/**
 * Internal client for the Python biometric service.
 *
 * The browser NEVER calls this service directly and NEVER sees biometric
 * data. All calls originate from Next.js route handlers after authentication
 * and are authenticated with the shared internal token.
 *
 * The Python service is the SINGLE authority for biometric computation:
 * detection → exactly-one-face → quality → alignment → liveness → embedding
 * → matching. Nothing here computes or trusts client-side biometrics.
 */
import "server-only";

const SERVICE_URL = process.env.BIOMETRIC_SERVICE_URL ?? "http://127.0.0.1:3010";
const INTERNAL_TOKEN = process.env.BIOMETRIC_INTERNAL_TOKEN ?? "";

/** Frames accepted per request (must match Python's BIOMETRIC_MIN/MAX_FRAMES). */
export const MIN_FRAMES = 3;
export const MAX_FRAMES = 8;

export interface BiometricQualityReport {
  passed: boolean;
  quality_score: number;
  sharpness_score: number;
  brightness_score: number;
  pose_score: number;
  face_confidence: number;
  blur_variance: number;
  mean_luma: number;
  yaw: number;
  pitch: number;
  roll: number;
  face_size_px: number;
  reasons: string[];
}

export interface BiometricModelInfo {
  name: string;
  version: string;
  embedding_version: number;
  embedding_dim: number;
  quality_mean?: number;
}

export interface BiometricLiveness {
  label: "LIVE" | "FAKE" | "UNCERTAIN" | "INPUT_REJECTED";
  score: number;
  model: string;
  per_frame_scores?: number[];
}

export interface EnrollOk {
  ok: true;
  embedding: number[];
  embedding_dim: number;
  samples_used: number;
  frames_received: number;
  quality: BiometricQualityReport[];
  quality_mean: number;
  liveness: BiometricLiveness;
  model: BiometricModelInfo;
}

export interface VerifyOk {
  ok: true;
  mode: "SELF" | "KIOSK";
  matched: boolean;
  student_id: string | null;
  similarity: number;
  band: "high" | "medium" | "low";
  threshold: number;
  runner_up_similarity?: number;
  margin_ok?: boolean;
  candidates_considered?: number;
  frames_used: number;
  quality: BiometricQualityReport[];
  quality_mean: number;
  liveness: BiometricLiveness;
  model: BiometricModelInfo;
}

export interface BiometricRejection {
  ok: false;
  code:
    | "NO_FACE"
    | "MULTIPLE_FACES"
    | "LOW_IMAGE_QUALITY"
    | "LIVENESS_FAILED"
    | "INPUT_REJECTED"
    | "INSUFFICIENT_FRAMES"
    | "BIOMETRIC_NOT_ENROLLED"
    | "STUDENT_CONTEXT_MISSING"
    | "INVALID_MODE"
    | "RATE_LIMITED"
    | "UNAUTHORIZED_CALLER"
    | "FACE_MODEL_NOT_READY"
    | "REPOSITORY_ERROR"
    | "SERVICE_UNREACHABLE";
  detail: string;
  frame_index?: number;
  face_count?: number;
  quality?: BiometricQualityReport;
  reason?: string;
  liveness?: BiometricLiveness;
  model?: BiometricModelInfo;
}

export type EnrollResult = EnrollOk | BiometricRejection;
export type VerifyResult = VerifyOk | BiometricRejection;

/** Body cap for frame payloads (8 frames × ~680KB base64 + envelope). */
export const MAX_BIOMETRIC_BODY_BYTES = 8 * 1024 * 1024;

class BiometricServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function postToService<T>(path: string, body: unknown, timeoutMs = 120_000): Promise<T> {
  if (!INTERNAL_TOKEN) {
    throw new BiometricServiceError(500, "BIOMETRIC_INTERNAL_TOKEN is not configured");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SERVICE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": INTERNAL_TOKEN,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as (T & { detail?: string }) | null;
    if (!res.ok) {
      // Structured biometric rejections ({ok:false, code, detail}) pass
      // through untouched so callers get the precise failure code.
      if (
        data &&
        typeof data === "object" &&
        (data as { ok?: unknown }).ok === false &&
        typeof (data as { code?: unknown }).code === "string"
      ) {
        return data as T;
      }
      throw new BiometricServiceError(res.status, data?.detail ?? `biometric service error ${res.status}`);
    }
    return data as T;
  } catch (e) {
    if (e instanceof BiometricServiceError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new BiometricServiceError(504, "biometric service timed out");
    }
    throw new BiometricServiceError(502, "biometric service unreachable");
  } finally {
    clearTimeout(timer);
  }
}

/** Convert a fetch failure into a structured rejection (no exceptions to UI). */
async function postAndClassify<T extends EnrollResult | VerifyResult>(
  path: string,
  body: unknown
): Promise<T> {
  try {
    return await postToService<T>(path, body);
  } catch (e) {
    const status = e instanceof BiometricServiceError ? e.status : 502;
    const detail = e instanceof Error ? e.message : "unknown biometric service failure";
    return {
      ok: false,
      code: status === 503 ? "FACE_MODEL_NOT_READY" : "SERVICE_UNREACHABLE",
      detail,
    } as T;
  }
}

export function enrollFrames(frames: string[]): Promise<EnrollResult> {
  return postAndClassify<EnrollResult>("/enroll", { frames });
}

export function verifyFrames(
  frames: string[],
  mode: "SELF" | "KIOSK",
  studentId?: string
): Promise<VerifyResult> {
  return postAndClassify<VerifyResult>("/verify", { frames, mode, student_id: studentId });
}

export async function biometricServiceReady(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVICE_URL}/ready`, { cache: "no-store" });
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}
