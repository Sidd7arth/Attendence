"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  GraduationCap,
  LogOut,
  CalendarCheck2,
  History,
  Bell,
  Fingerprint,
  Clock,
  Flame,
  Percent,
  CheckCircle2,
  XCircle,
  Loader2,
  Mail,
  MailOpen,
  AlertTriangle,
  RefreshCw,
  ScanFace,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError } from "@/lib/sas/client";
import { dateKey, formatDateLabel, formatTime, relativeTime, STATUS_META, type AttendanceStatus } from "@/lib/sas/dates";
import type { AttendanceDTO, MeResponse, StudentAnnouncementDTO, StudentHistory } from "@/lib/sas/types";
import { FaceVerifyDialog } from "./face-verify-dialog";

interface StudentDashboardProps {
  user: MeResponse;
  onLogout: () => void;
}

export function StudentDashboard({ user, onLogout }: StudentDashboardProps) {
  const { toast } = useToast();
  const today = dateKey();
  const [tab, setTab] = useState("today");
  const [history, setHistory] = useState<StudentHistory | null>(null);
  const [announcements, setAnnouncements] = useState<StudentAnnouncementDTO[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [marking, setMarking] = useState<"PRESENT" | "LATE" | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [faceOpen, setFaceOpen] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      setMarkError(null);
      const h = await api.studentHistory(today);
      setHistory(h);
    } catch (e) {
      setMarkError(e instanceof ApiError ? e.message : "Failed to load your attendance.");
    }
  }, [today]);

  const loadAnnouncements = useCallback(async () => {
    try {
      const a = await api.studentAnnouncements();
      setAnnouncements(a.announcements);
      setUnread(a.unread);
    } catch {
      // silent — polling
    }
  }, []);

  useEffect(() => {
    loadHistory();
    loadAnnouncements();
    // light polling so admin updates appear without a manual refresh
    const t = setInterval(loadAnnouncements, 30000);
    return () => clearInterval(t);
  }, [loadHistory, loadAnnouncements]);

  async function handleLogout() {
    await api.logout().catch(() => {});
    onLogout();
  }

  async function markAttendance(status: "PRESENT" | "LATE") {
    setMarking(status);
    try {
      const rec = await api.studentMark(today, status);
      toast({
        title: "Attendance recorded ✅",
        description: `You are marked ${STATUS_META[rec.status as AttendanceStatus].label.toLowerCase()} at ${formatTime(rec.checkInAt)}.`,
      });
      await loadHistory();
    } catch (e) {
      toast({
        title: "Could not mark attendance",
        description: e instanceof ApiError ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setMarking(null);
    }
  }

  async function openAnnouncement(a: StudentAnnouncementDTO) {
    if (!a.read) {
      setAnnouncements((prev) => (prev ? prev.map((x) => (x.id === a.id ? { ...x, read: true } : x)) : prev));
      setUnread((u) => Math.max(0, u - 1));
      api.studentMarkRead(a.id).catch(() => {});
    }
  }

  async function refreshAll() {
    setRefreshing(true);
    await Promise.all([loadHistory(), loadAnnouncements()]);
    setRefreshing(false);
    toast({ title: "Refreshed", description: "You are up to date." });
  }

  const s = history?.stats;
  const markedToday = !!history?.today;
  const todayMeta = history?.today ? STATUS_META[history.today.status as AttendanceStatus] : null;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-emerald-100 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <GraduationCap className="h-6 w-6" />
            </div>
            <div className="leading-tight">
              <p className="font-bold tracking-tight">EduTrack</p>
              <p className="text-xs text-muted-foreground">
                {user.name} · {user.rollNumber} · Class {user.class}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={refreshAll}
              aria-label="Refresh"
              className="text-emerald-700 hover:bg-emerald-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <Avatar className="h-9 w-9 border border-emerald-200">
              <AvatarFallback className="bg-emerald-100 font-semibold text-emerald-800">
                {user.name
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")}
              </AvatarFallback>
            </Avatar>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="gap-1.5 border-emerald-200 text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <TabsList className="h-11 bg-emerald-50 p-1">
              <TabsTrigger value="today" className="gap-2 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                <Fingerprint className="h-4 w-4" /> <span className="hidden xs:inline">Mark attendance</span><span className="xs:hidden">Today</span>
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-2 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                <History className="h-4 w-4" /> History
              </TabsTrigger>
              <TabsTrigger value="updates" className="gap-2 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                <span className="relative">
                  <Bell className="h-4 w-4" />
                  {unread > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                      {unread}
                    </span>
                  )}
                </span>
                Updates
              </TabsTrigger>
            </TabsList>
          </div>

          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            {/* ── Today ── */}
            <TabsContent value="today" className="mt-0 space-y-6">
              {markError && (
                <Card className="border-rose-200">
                  <CardContent className="flex items-center gap-3 p-4 text-sm text-rose-700">
                    <AlertTriangle className="h-5 w-5" /> {markError}
                  </CardContent>
                </Card>
              )}

              {/* Mark card */}
              <Card className="overflow-hidden border-emerald-100">
                <CardHeader className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <CalendarCheck2 className="h-5 w-5" />
                    Today · {formatDateLabel(today)}
                  </CardTitle>
                  <CardDescription className="text-emerald-50/90">Mark your attendance for today</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                  {!history ? (
                    <div className="space-y-4">
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : markedToday && history.today ? (
                    <div className="flex flex-col items-center gap-4 py-4 text-center">
                      <span className={`flex h-16 w-16 items-center justify-center rounded-full ${todayMeta!.badge} border`}>
                        {history.today.status === "ABSENT" ? (
                          <XCircle className="h-8 w-8" />
                        ) : (
                          <CheckCircle2 className="h-8 w-8" />
                        )}
                      </span>
                      <div>
                        <p className="text-lg font-semibold">You are marked {todayMeta!.label.toLowerCase()}</p>
                        <p className="text-sm text-muted-foreground">
                          {history.today.markedBy === "STUDENT" ? "Self-marked" : "Recorded by admin"}
                          {history.today.checkInAt ? ` at ${formatTime(history.today.checkInAt)}` : ""}
                        </p>
                        {history.today.note && (
                          <p className="mt-1 text-sm text-amber-700">Note: {history.today.note}</p>
                        )}
                      </div>
                      <p className="max-w-sm text-xs text-muted-foreground">
                        Your attendance for today is locked. If something looks wrong, contact the school office.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <p className="text-center text-sm text-muted-foreground">
                        You have <span className="font-medium text-foreground">not</span> marked attendance yet today. Pick one:
                      </p>
                      {user.faceRegistered && (
                        <Button
                          size="lg"
                          onClick={() => setFaceOpen(true)}
                          className="h-16 w-full flex-col gap-1 border-2 border-dashed border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                          variant="outline"
                        >
                          <ScanFace className="h-6 w-6" />
                          Use face check-in
                        </Button>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Button
                          size="lg"
                          onClick={() => markAttendance("PRESENT")}
                          disabled={marking !== null}
                          className="h-20 flex-col gap-1 bg-emerald-600 text-base hover:bg-emerald-700"
                        >
                          {marking === "PRESENT" ? <Loader2 className="h-6 w-6 animate-spin" /> : <CheckCircle2 className="h-6 w-6" />}
                          I&apos;m present
                        </Button>
                        <Button
                          size="lg"
                          variant="outline"
                          onClick={() => markAttendance("LATE")}
                          disabled={marking !== null}
                          className="h-20 flex-col gap-1 border-amber-300 text-base text-amber-800 hover:bg-amber-50"
                        >
                          {marking === "LATE" ? <Loader2 className="h-6 w-6 animate-spin" /> : <Clock className="h-6 w-6" />}
                          I&apos;m late
                        </Button>
                      </div>
                      <p className="text-center text-xs text-muted-foreground">
                        Your check-in time is recorded automatically.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Face check-in (server-side 1:1 verification + liveness) */}
              <FaceVerifyDialog open={faceOpen} onOpenChange={setFaceOpen} onMarked={() => void loadHistory()} />

              {/* Mini stats */}
              {s && (
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {[
                    { label: "Attendance rate", value: `${s.rate}%`, icon: Percent, tone: "text-teal-700 bg-teal-100" },
                    { label: "Present days", value: s.present, icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-100" },
                    { label: "Current streak", value: `${s.streak}🔥`.replace("🔥", ""), icon: Flame, tone: "text-amber-700 bg-amber-100", suffix: s.streak === 1 ? "day" : "days" },
                    { label: "Total days", value: s.totalDays, icon: History, tone: "text-emerald-700 bg-emerald-100" },
                  ].map((c) => (
                    <Card key={c.label} className="border-emerald-100">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">{c.label}</p>
                          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${c.tone}`}>
                            <c.icon className="h-4 w-4" />
                          </span>
                        </div>
                        <p className="mt-1.5 text-xl font-bold">
                          {c.value}
                          {"suffix" in c && c.suffix ? <span className="ml-1 text-xs font-normal text-muted-foreground">{c.suffix}</span> : null}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── History ── */}
            <TabsContent value="history" className="mt-0">
              <Card className="border-emerald-100">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">My Attendance History</CardTitle>
                  <CardDescription>Last 60 school days</CardDescription>
                </CardHeader>
                <CardContent>
                  {!history ? (
                    <div className="space-y-2">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50/70 p-4">
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            Overall attendance: <span className="font-bold text-emerald-700">{s?.rate}%</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {s?.present} present · {s?.late} late · {s?.absent} absent · {s?.excused} excused
                          </p>
                        </div>
                        <div className="w-32">
                          <Progress value={s?.rate ?? 0} className="h-2.5 [&>div]:bg-emerald-500" />
                        </div>
                      </div>
                      <ul className="max-h-[28rem] divide-y divide-emerald-50 overflow-y-auto sas-scroll pr-1">
                        {history.records.length === 0 && (
                          <li className="py-8 text-center text-sm text-muted-foreground">No records yet.</li>
                        )}
                        {history.records.map((r: AttendanceDTO) => {
                          const meta = STATUS_META[r.status as AttendanceStatus];
                          return (
                            <li key={r.attendanceId} className="flex items-center justify-between gap-3 py-2.5">
                              <div className="min-w-0">
                                <p className="text-sm font-medium">{formatDateLabel(r.date)}</p>
                                <p className="text-xs text-muted-foreground">
                                  {r.markedBy === "STUDENT" ? "Self-marked" : "By admin"}
                                  {r.checkInAt ? ` · in at ${formatTime(r.checkInAt)}` : ""}
                                  {r.note ? ` · ${r.note}` : ""}
                                </p>
                              </div>
                              <Badge variant="outline" className={meta.badge}>
                                <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${meta.dot}`} />
                                {meta.label}
                              </Badge>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Updates ── */}
            <TabsContent value="updates" className="mt-0">
              <Card className="border-emerald-100">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Bell className="h-5 w-5 text-emerald-600" />
                    Updates from Admin
                  </CardTitle>
                  <CardDescription>
                    {unread > 0 ? `You have ${unread} unread ${unread === 1 ? "update" : "updates"}` : "You are all caught up"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!announcements ? (
                    <div className="space-y-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-24 w-full" />
                      ))}
                    </div>
                  ) : announcements.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-12 text-center">
                      <Bell className="h-8 w-8 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">No updates yet. Announcements from your school will appear here.</p>
                    </div>
                  ) : (
                    <ul className="max-h-[34rem] space-y-3 overflow-y-auto sas-scroll pr-1">
                      {announcements.map((a) => (
                        <li
                          key={a.id}
                          className={`rounded-xl border p-4 transition-colors ${
                            a.read ? "border-emerald-50 bg-white" : "border-emerald-200 bg-emerald-50/50"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => openAnnouncement(a)}
                            className="w-full cursor-pointer text-left"
                            aria-label={`${a.read ? "Read" : "Unread"} announcement: ${a.title}`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              {!a.read && <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />}
                              <p className="font-semibold">{a.title}</p>
                              {a.priority === "HIGH" && (
                                <Badge variant="outline" className="border-rose-200 bg-rose-100 text-rose-700">
                                  High priority
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1.5 text-sm text-muted-foreground">{a.content}</p>
                            <div className="mt-2 flex items-center justify-between">
                              <p className="text-xs text-muted-foreground">
                                {relativeTime(a.createdAt)} · {a.adminName}
                                {a.targetClass ? ` · Class ${a.targetClass}` : " · All students"}
                              </p>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                {a.read ? (
                                  <>
                                    <MailOpen className="h-3.5 w-3.5" /> Read
                                  </>
                                ) : (
                                  <>
                                    <Mail className="h-3.5 w-3.5 text-emerald-600" /> New
                                  </>
                                )}
                              </span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </motion.div>
        </Tabs>
      </main>
    </div>
  );
}
