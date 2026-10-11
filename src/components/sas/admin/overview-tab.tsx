"use client";

import { useEffect, useState } from "react";
import {
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Percent,
  CalendarCheck2,
  Loader2,
  Megaphone,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/sas/client";
import { dateKey, formatDateLabel, relativeTime, STATUS_META } from "@/lib/sas/dates";
import type { AdminStatsDTO } from "@/lib/sas/types";

export function OverviewTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [stats, setStats] = useState<AdminStatsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = dateKey();

  useEffect(() => {
    let active = true;
    api
      .adminStats(today)
      .then((s) => {
        if (active) setStats(s);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof ApiError ? e.message : "Failed to load stats");
      });
    return () => {
      active = false;
    };
  }, [today]);

  function retry() {
    setError(null);
    api
      .adminStats(today)
      .then(setStats)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Failed to load stats"));
  }

  if (error) {
    return (
      <Card className="border-rose-200">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-rose-500" />
          <p className="text-sm text-rose-700">{error}</p>
          <Button variant="outline" onClick={retry} className="border-emerald-200">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!stats) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="mt-3 h-8 w-12" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const t = stats.totals;
  const cards = [
    { label: "Total Students", value: t.students, icon: Users, tone: "text-emerald-700 bg-emerald-100" },
    { label: "Present", value: t.present, icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-100" },
    { label: "Absent", value: t.absent, icon: XCircle, tone: "text-rose-700 bg-rose-100" },
    { label: "Late", value: t.late, icon: Clock, tone: "text-amber-700 bg-amber-100" },
    { label: "Attendance Rate", value: `${t.rate}%`, icon: Percent, tone: "text-teal-700 bg-teal-100" },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label} className="border-emerald-100 transition-shadow hover:shadow-md hover:shadow-emerald-100/60">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground sm:text-sm">{c.label}</p>
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.tone}`}>
                  <c.icon className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {t.unmarked > 0 && (
        <Card className="border-amber-200 bg-amber-50/70">
          <CardContent className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-amber-900">
              <span className="font-semibold">{t.unmarked}</span> {t.unmarked === 1 ? "student has" : "students have"} not been marked for{" "}
              <span className="font-medium">{formatDateLabel(today)}</span>.
            </p>
            <Button size="sm" onClick={() => onNavigate("attendance")} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
              Take attendance <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Trend chart */}
      <Card className="border-emerald-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Attendance Trend</CardTitle>
          <CardDescription>Attended rate (present + late) over the last 14 days</CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="h-64 w-full sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e5" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => v.slice(5).replace("-", "/")}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={{ stroke: "#e2e8e5" }}
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} unit="%" />
                <ReTooltip
                  labelFormatter={(v) => formatDateLabel(String(v))}
                  formatter={(value) => [`${value}%`, "Attended"]}
                  contentStyle={{ borderRadius: 10, border: "1px solid #d1fae5", fontSize: 12 }}
                />
                <Area type="monotone" dataKey="rate" stroke="#059669" strokeWidth={2.5} fill="url(#rateFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Class breakdown */}
        <Card className="border-emerald-100">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Today by Class</CardTitle>
            <CardDescription>{formatDateLabel(today)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats.classes.length === 0 && <p className="text-sm text-muted-foreground">No classes found.</p>}
            {stats.classes.map((c) => (
              <div key={c.class} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Class {c.class}</span>
                  <span className="text-muted-foreground">
                    {c.present}/{c.total} · {c.rate}%
                  </span>
                </div>
                <Progress value={c.rate} className="h-2.5 [&>div]:bg-emerald-500" />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Top absentees */}
        <Card className="border-emerald-100">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Highest Absences</CardTitle>
            <CardDescription>Students with the most absences on record</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.topAbsentees.length === 0 ? (
              <p className="text-sm text-muted-foreground">No absences recorded. 🎉</p>
            ) : (
              <ul className="divide-y divide-emerald-50">
                {stats.topAbsentees.map((s) => (
                  <li key={s.studentId} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.rollNumber} · Class {s.class}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                      {s.absences} {s.absences === 1 ? "absence" : "absences"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent announcements */}
      <Card className="border-emerald-100">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-lg">Recent Announcements</CardTitle>
            <CardDescription>Latest updates sent to students</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => onNavigate("announcements")} className="gap-1.5 border-emerald-200 text-emerald-800 hover:bg-emerald-50">
            <Megaphone className="h-4 w-4" /> New
          </Button>
        </CardHeader>
        <CardContent>
          {stats.recentAnnouncements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
          ) : (
            <ul className="divide-y divide-emerald-50">
              {stats.recentAnnouncements.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{a.title}</p>
                      {a.priority === "HIGH" && (
                        <Badge className="bg-rose-100 text-rose-700 border-rose-200" variant="outline">
                          High
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{a.content}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.targetClass ? `To class ${a.targetClass}` : "To all students"} · {relativeTime(a.createdAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-emerald-700">
                      {a.readCount}/{a.totalTargets}
                    </p>
                    <p className="text-[11px] text-muted-foreground">read</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
