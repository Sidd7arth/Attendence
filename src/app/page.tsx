"use client";

import { useEffect, useState } from "react";
import { GraduationCap, Loader2 } from "lucide-react";
import { LoginView } from "@/components/sas/login-view";
import { AdminDashboard } from "@/components/sas/admin/admin-dashboard";
import { StudentDashboard } from "@/components/sas/student/student-dashboard";
import { api } from "@/lib/sas/client";
import type { MeResponse } from "@/lib/sas/types";

type View = "loading" | "login" | "admin" | "student";

export default function Home() {
  const [view, setView] = useState<View>("loading");
  const [user, setUser] = useState<MeResponse | null>(null);

  useEffect(() => {
    let active = true;
    api
      .me()
      .then((res) => {
        if (!active) return;
        if (res.user) {
          setUser(res.user);
          setView(res.user.role === "ADMIN" ? "admin" : "student");
        } else {
          setUser(null);
          setView("login");
        }
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setView("login");
      });
    return () => {
      active = false;
    };
  }, []);

  function handleLoggedIn(u: MeResponse) {
    setUser(u);
    setView(u.role === "ADMIN" ? "admin" : "student");
  }

  function handleLogout() {
    setUser(null);
    setView("login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex-1">
        {view === "loading" && (
          <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white">
              <GraduationCap className="h-8 w-8" />
            </div>
            <p className="text-lg font-semibold">EduTrack</p>
            <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          </div>
        )}

        {view === "login" && <LoginView onLoggedIn={handleLoggedIn} />}

        {view === "admin" && user && <AdminDashboard user={user} onLogout={handleLogout} />}

        {view === "student" && user && <StudentDashboard user={user} onLogout={handleLogout} />}
      </div>

      {/* Sticky footer — sits at viewport bottom, pushed down naturally on long pages */}
      <footer className="mt-auto border-t border-emerald-100 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex h-16 w-full max-w-7xl flex-col items-center justify-center gap-0.5 px-4 sm:flex-row sm:justify-between sm:px-6">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <GraduationCap className="h-4 w-4 text-emerald-600" />
            <span className="font-semibold text-foreground">EduTrack</span> — Student Attendance System
          </p>
          <p className="text-xs text-muted-foreground">
            Admin console & student portal · Credentials are assigned by the administrator
          </p>
        </div>
      </footer>
    </div>
  );
}
