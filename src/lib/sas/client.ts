/** Typed client-side API helpers for EduTrack. */
import type {
  AdminStatsDTO,
  AnnouncementDTO,
  AttendanceDTO,
  FaceChallengeResponse,
  FaceEnrollResponse,
  FaceStatusResponse,
  FaceVerifyResponse,
  GpsPayload,
  LoginResponse,
  MeResponse,
  RosterRow,
  StudentAnnouncementDTO,
  StudentDTO,
  StudentHistory,
} from "./types";

// ── Session token storage (single key, single place) ──
// The login API returns the same opaque session token that the server sets as
// an httpOnly cookie. Storing it here and sending it as
// `Authorization: Bearer <token>` keeps authentication working in contexts
// where the browser refuses SameSite=Lax cookies (e.g. cross-origin preview
// iframes). All storage handling lives in THIS file only — components never
// touch tokens directly.

const TOKEN_STORAGE_KEY = "edutrack.auth-token";

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // storage unavailable (private mode etc.) — cookie path still works
  }
}

function clearStoredToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Central fetch wrapper — the ONLY place that talks to the API. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Automatically attach the session token to every protected request.
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "same-origin", // cookie still honoured in first-party contexts
  });

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    // 401 ⇒ the stored token is missing/invalid/expired server-side. Drop it
    // so the app cleanly falls back to the login screen instead of looping on
    // misleading "Not authenticated" errors.
    if (res.status === 401) clearStoredToken();
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

// ── Auth ──

export const api = {
  me: () => request<{ user: MeResponse | null }>("/api/auth/me"),

  login: async (role: "ADMIN" | "STUDENT", email: string, password: string) => {
    const res = await request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ role, email, password }),
    });
    // Persist the session token returned by the login API (response property:
    // `token`). Sent automatically as `Authorization: Bearer <token>` from now on.
    if (res.token) setStoredToken(res.token);
    return res;
  },

  logout: async () => {
    try {
      await request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
    } finally {
      clearStoredToken();
    }
  },

  // ── Admin ──

  adminStats: (date: string) => request<AdminStatsDTO>(`/api/admin/stats?date=${date}`),

  adminStudents: () => request<{ students: StudentDTO[] }>("/api/admin/students"),

  adminCreateStudent: (body: {
    name: string;
    rollNumber: string;
    email: string;
    class: string;
    phone?: string;
    password?: string;
  }) =>
    request<{ student: StudentDTO; credentials: { email: string; password: string } }>(
      "/api/admin/students",
      { method: "POST", body: JSON.stringify(body) }
    ),

  adminUpdateStudent: (
    id: string,
    body: Partial<{ name: string; rollNumber: string; email: string; class: string; phone: string | null; active: boolean; password: string }>
  ) => request<{ ok: boolean }>(`/api/admin/students/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  adminDeleteStudent: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/students/${id}`, { method: "DELETE" }),

  adminRoster: (date: string) => request<{ date: string; roster: RosterRow[] }>(`/api/admin/attendance?date=${date}`),

  adminMarkAttendance: (studentId: string, date: string, status: string, note?: string | null) =>
    request<AttendanceDTO>("/api/admin/attendance", {
      method: "POST",
      body: JSON.stringify({ studentId, date, status, note: note ?? null }),
    }),

  adminBulkMark: (date: string, status: string, studentIds: string[], onlyUnmarked: boolean) =>
    request<{ ok: boolean; count: number }>("/api/admin/attendance", {
      method: "PUT",
      body: JSON.stringify({ date, status, studentIds, onlyUnmarked }),
    }),

  adminAnnouncements: () => request<{ announcements: AnnouncementDTO[] }>("/api/admin/announcements"),

  adminSendAnnouncement: (body: { title: string; content: string; targetClass: string | null; priority: "NORMAL" | "HIGH" }) =>
    request<{ ok: boolean }>("/api/admin/announcements", { method: "POST", body: JSON.stringify(body) }),

  // ── Biometric (frames in — decisions out; never embeddings) ──

  faceEnroll: (id: string, body: { frames: string[]; nonce: string; timestamp: number }) =>
    request<FaceEnrollResponse>(`/api/admin/students/${id}/face/enroll`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  faceReEnroll: (id: string, body: { frames: string[]; nonce: string; timestamp: number }) =>
    request<FaceEnrollResponse>(`/api/admin/students/${id}/face/re-enroll`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  adminDeleteFace: (id: string) =>
    request<{ ok: boolean; faceRegistered: boolean }>(`/api/admin/students/${id}/face`, { method: "DELETE" }),

  faceStatus: (id: string) => request<FaceStatusResponse>(`/api/admin/students/${id}/face`),

  faceChallenge: () => request<FaceChallengeResponse>("/api/face/challenge", { method: "POST" }),

  faceVerify: (body: {
    frames: string[];
    date: string;
    challengeId?: string;
    confirmFor?: string;
    gps?: GpsPayload;
  }) => request<FaceVerifyResponse>("/api/face/verify", { method: "POST", body: JSON.stringify(body) }),

  // ── Student ──

  studentHistory: (today: string) => request<StudentHistory>(`/api/student/attendance?today=${today}`),

  studentMark: (date: string, status: "PRESENT" | "LATE") =>
    request<AttendanceDTO>("/api/student/attendance", {
      method: "POST",
      body: JSON.stringify({ date, status }),
    }),

  studentAnnouncements: () =>
    request<{ announcements: StudentAnnouncementDTO[]; unread: number }>("/api/student/announcements"),

  studentMarkRead: (announcementId: string) =>
    request<{ ok: boolean }>("/api/student/announcements", {
      method: "POST",
      body: JSON.stringify({ announcementId }),
    }),
};

export { ApiError };
