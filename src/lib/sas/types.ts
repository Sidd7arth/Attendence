/** Shared client/server types for EduTrack.
 *
 *  Student DTO spec:    studentId, name, rollNumber, class
 *  Attendance DTO spec: attendanceId, studentId, date, status, markedBy
 */
import type { AttendanceStatus } from "./dates";

// ───────────────────────── Biometric capture ─────────────────────────
// The browser sends RAW FRAMES; every biometric decision (quality,
// liveness, identity) is computed server-side by the Python engine.

export interface GpsPayload {
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
}

export interface FaceVerifyResponse {
  success: boolean;
  verified: boolean;
  reason: string;
  error?: string;
  similarity?: number;
  confidenceBand?: "high" | "medium" | "low";
  qualityScore?: number;
  livenessScore?: number;
  requiresConfirmation?: boolean;
  already?: boolean;
  locationValid?: boolean;
  locationReason?: string;
  student?: {
    studentId: string;
    name: string;
    rollNumber: string;
    class: string;
  };
  record?: AttendanceDTO | null;
  liveness?: { label: string; score: number; model: string };
}

export interface FaceChallengeResponse {
  challengeId: string;
  expiresAt: number;
}

export interface FaceEnrollResponse {
  ok: boolean;
  faceRegistered?: boolean;
  replaced?: boolean;
  samples?: number;
  qualityMean?: number;
  liveness?: { label: string; score: number; model: string };
  model?: { name: string; version: string; embeddingVersion: number; embeddingDim: number };
  code?: string;
  error?: string;
}

export interface FaceChallengeResponse {
  challengeId: string;
  expiresAt: number;
}

export interface FaceStatusResponse {
  enrolled: boolean;
  status?: string;
  samples?: number;
  qualityScore?: number | null;
  livenessMethod?: string | null;
  modelName?: string;
  modelVersion?: string;
  embeddingVersion?: number;
  embeddingDimension?: number;
  enrolledAt?: string;
  lastVerifiedAt?: string | null;
}

export interface StudentDTO {
  studentId: string;
  name: string;
  rollNumber: string;
  class: string;
  email: string;
  phone: string | null;
  active: boolean;
  /** Biometric status flag (template lives in FaceProfile — never in DTOs). */
  faceRegistered: boolean;
  createdAt: string;
}

export interface AttendanceDTO {
  attendanceId: string;
  studentId: string;
  date: string;
  status: AttendanceStatus; // PRESENT | ABSENT | LATE | EXCUSED
  markedBy: "ADMIN" | "STUDENT";
  method: "MANUAL" | "FACE" | "SELF"; // how the record was created
  note: string | null;
  checkInAt: string | null;
  /** GPS capture (validated server-side; null when unavailable/not required). */
  latitude?: number | null;
  longitude?: number | null;
  gpsAccuracy?: number | null;
  /** Server-stamped biometric proof flags (never settable by the client). */
  faceVerified?: boolean;
  livenessVerified?: boolean;
  verificationId?: string | null;
}

export interface RosterRow {
  student: StudentDTO;
  attendance: AttendanceDTO | null;
}

export interface TrendPoint {
  date: string;
  present: number;
  late: number;
  absent: number;
  excused: number;
  rate: number; // %
}

export interface ClassStat {
  class: string;
  total: number;
  present: number;
  rate: number; // %
}

export interface AdminStatsDTO {
  totals: {
    students: number;
    present: number;
    absent: number;
    late: number;
    excused: number;
    unmarked: number;
    rate: number; // % of marked students present (present+late count as attended)
  };
  trend: TrendPoint[];
  classes: ClassStat[];
  recentAnnouncements: AnnouncementDTO[];
  topAbsentees: Array<{ studentId: string; name: string; rollNumber: string; class: string; absences: number }>;
}

export interface AnnouncementDTO {
  id: string;
  title: string;
  content: string;
  targetClass: string | null;
  priority: "NORMAL" | "HIGH";
  adminName: string;
  createdAt: string;
  readCount: number;
  totalTargets: number;
}

export interface StudentAnnouncementDTO extends AnnouncementDTO {
  read: boolean;
}

export interface StudentHistory {
  today: AttendanceDTO | null;
  records: AttendanceDTO[];
  stats: {
    totalDays: number;
    present: number;
    absent: number;
    late: number;
    excused: number;
    rate: number; // %
    streak: number; // consecutive most-recent attended days
  };
}

export interface MeResponse {
  role: "ADMIN" | "STUDENT";
  name: string;
  email: string;
  studentId?: string;
  rollNumber?: string;
  class?: string;
  /** Biometric status flag — enables the student face check-in option. */
  faceRegistered?: boolean;
}

export interface LoginResponse {
  user: MeResponse;
  /** Opaque server-side session token. The client stores it under the single
   *  key "edutrack.auth-token" and sends it as `Authorization: Bearer <token>`
   *  on every API request; the httpOnly cookie remains the first-party path. */
  token: string;
}
