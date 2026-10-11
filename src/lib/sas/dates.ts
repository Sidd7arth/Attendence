/** Shared date utilities — calendar keys are client-local "YYYY-MM-DD". */

/** Strict date-key validation: shape AND calendar sanity (month 01-12, day 01-31). */
export function isValidDateKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
}

/** Whole-day difference between two date keys (a - b), calendar-exact. */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return (Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000;
}

export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDateLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const STATUS_META: Record<
  AttendanceStatus,
  { label: string; badge: string; dot: string; text: string }
> = {
  PRESENT: {
    label: "Present",
    badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-500",
    text: "text-emerald-600",
  },
  ABSENT: {
    label: "Absent",
    badge: "bg-rose-100 text-rose-800 border-rose-200",
    dot: "bg-rose-500",
    text: "text-rose-600",
  },
  LATE: {
    label: "Late",
    badge: "bg-amber-100 text-amber-800 border-amber-200",
    dot: "bg-amber-500",
    text: "text-amber-600",
  },
  EXCUSED: {
    label: "Excused",
    badge: "bg-teal-100 text-teal-800 border-teal-200",
    dot: "bg-teal-500",
    text: "text-teal-600",
  },
};
