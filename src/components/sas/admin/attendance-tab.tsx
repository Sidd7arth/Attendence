"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  Users,
  Wand2,
  CheckCheck,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError } from "@/lib/sas/client";
import { dateKey, formatDateLabel, formatTime, STATUS_META, type AttendanceStatus } from "@/lib/sas/dates";
import type { RosterRow } from "@/lib/sas/types";

function shiftDate(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return dateKey(dt);
}

export function AttendanceTab() {
  const { toast } = useToast();
  const today = dateKey();
  const [date, setDate] = useState(today);
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("ALL");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.adminRoster(date);
      setRoster(res.roster);
    } catch (e) {
      toast({
        title: "Failed to load roster",
        description: e instanceof ApiError ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  }, [date, toast]);

  useEffect(() => {
    setRoster(null);
    load();
  }, [load]);

  const classes = useMemo(() => {
    if (!roster) return [];
    return Array.from(new Set(roster.map((r) => r.student.class))).sort();
  }, [roster]);

  const filtered = useMemo(() => {
    if (!roster) return [];
    const q = search.trim().toLowerCase();
    return roster.filter((r) => {
      if (classFilter !== "ALL" && r.student.class !== classFilter) return false;
      if (!q) return true;
      return (
        r.student.name.toLowerCase().includes(q) ||
        r.student.rollNumber.toLowerCase().includes(q) ||
        r.student.email.toLowerCase().includes(q)
      );
    });
  }, [roster, search, classFilter]);

  const counts = useMemo(() => {
    const c = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, UNMARKED: 0 };
    for (const r of filtered) {
      if (r.attendance) c[r.attendance.status as AttendanceStatus]++;
      else c.UNMARKED++;
    }
    return c;
  }, [filtered]);

  async function mark(studentId: string, status: AttendanceStatus) {
    setSavingId(studentId);
    try {
      const rec = await api.adminMarkAttendance(studentId, date, status);
      setRoster((prev) =>
        prev
          ? prev.map((r) =>
              r.student.studentId === studentId
                ? { ...r, attendance: rec }
                : r
            )
          : prev
      );
    } catch (e) {
      toast({
        title: "Could not save",
        description: e instanceof ApiError ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingId(null);
    }
  }

  async function bulk(status: AttendanceStatus, onlyUnmarked: boolean) {
    setBulkLoading(true);
    try {
      const ids = filtered.map((r) => r.student.studentId);
      const res = await api.adminBulkMark(date, status, ids, onlyUnmarked);
      toast({
        title: "Bulk update applied",
        description: `${res.count} ${res.count === 1 ? "student" : "students"} marked ${STATUS_META[status].label.toLowerCase()}.`,
      });
      await load();
    } catch (e) {
      toast({
        title: "Bulk update failed",
        description: e instanceof ApiError ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card className="border-emerald-100">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarCheck2 className="h-5 w-5 text-emerald-600" />
                Daily Attendance
              </CardTitle>
              <CardDescription>{formatDateLabel(date)}</CardDescription>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous day"
                onClick={() => setDate(shiftDate(date, -1))}
                className="border-emerald-200"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                type="date"
                value={date}
                max={today}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="w-40"
                aria-label="Select date"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Next day"
                onClick={() => setDate(shiftDate(date, 1))}
                disabled={date >= today}
                className="border-emerald-200"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              {date !== today && (
                <Button variant="ghost" size="sm" onClick={() => setDate(today)} className="text-emerald-700 hover:bg-emerald-50">
                  Today
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, roll no or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Search students"
              />
            </div>
            <div className="flex gap-3">
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger className="w-[150px]" aria-label="Filter by class">
                  <SelectValue placeholder="Class" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All classes</SelectItem>
                  {classes.map((c) => (
                    <SelectItem key={c} value={c}>
                      Class {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 text-sm">
                <Users className="h-4 w-4 text-emerald-700" />
                <span className="font-semibold text-emerald-800">{filtered.length}</span>
                <span className="text-muted-foreground">shown</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" /> {counts.PRESENT} present
            </Badge>
            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-800">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-500" /> {counts.ABSENT} absent
            </Badge>
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" /> {counts.LATE} late
            </Badge>
            <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-800">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-teal-500" /> {counts.EXCUSED} excused
            </Badge>
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400" /> {counts.UNMARKED} unmarked
            </Badge>

            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={bulkLoading || counts.UNMARKED === 0}
                onClick={() => bulk("PRESENT", true)}
                className="gap-1.5 border-emerald-200 text-emerald-800 hover:bg-emerald-50"
              >
                {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Fill remaining as present
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={bulkLoading || filtered.length === 0}
                onClick={() => bulk("PRESENT", false)}
                className="gap-1.5 border-emerald-200 text-emerald-800 hover:bg-emerald-50"
              >
                {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                Mark all present
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={bulkLoading || filtered.length === 0}
                onClick={() => bulk("ABSENT", false)}
                className="gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50"
              >
                {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Reset to absent
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Roster */}
      <Card className="border-emerald-100">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Student Register</CardTitle>
          <CardDescription>Change a status to save it instantly</CardDescription>
        </CardHeader>
        <CardContent>
          {!roster ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Users className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No students match your filters.</p>
            </div>
          ) : (
            <ul className="max-h-[34rem] divide-y divide-emerald-50 overflow-y-auto sas-scroll pr-1">
              {filtered.map(({ student, attendance }) => {
                const meta = attendance ? STATUS_META[attendance.status as AttendanceStatus] : null;
                return (
                  <li
                    key={student.studentId}
                    className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                          meta ? meta.badge : "bg-slate-100 text-slate-500 border border-slate-200"
                        }`}
                      >
                        {student.name
                          .split(" ")
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join("")}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{student.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {student.rollNumber} · Class {student.class}
                          {attendance?.checkInAt && (
                            <span> · checked in {formatTime(attendance.checkInAt)}</span>
                          )}
                          {attendance?.markedBy === "STUDENT" && (
                            <span className="ml-1 inline-flex items-center rounded bg-emerald-100 px-1 py-px text-[10px] font-medium text-emerald-800">
                              self-marked
                            </span>
                          )}
                          {attendance?.method === "FACE" && (
                            <span className="ml-1 inline-flex items-center rounded bg-teal-100 px-1 py-px text-[10px] font-medium text-teal-800">
                              face check-in
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pl-13 sm:pl-0">
                      {savingId === student.studentId && <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />}
                      <Select
                        value={attendance?.status ?? "UNMARKED"}
                        onValueChange={(v) => {
                          if (v === "UNMARKED") return;
                          mark(student.studentId, v as AttendanceStatus);
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          className={`w-32 font-medium ${meta ? meta.badge : "bg-slate-50 text-slate-600"}`}
                          aria-label={`Attendance for ${student.name}`}
                        >
                          <SelectValue placeholder="Mark" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PRESENT">✅ Present</SelectItem>
                          <SelectItem value="ABSENT">❌ Absent</SelectItem>
                          <SelectItem value="LATE">⏰ Late</SelectItem>
                          <SelectItem value="EXCUSED">📝 Excused</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
