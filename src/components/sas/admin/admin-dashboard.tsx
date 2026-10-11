"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  GraduationCap,
  LogOut,
  LayoutDashboard,
  CalendarCheck2,
  Users,
  Megaphone,
  ScanFace,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { OverviewTab } from "./overview-tab";
import { AttendanceTab } from "./attendance-tab";
import { StudentsTab } from "./students-tab";
import { AnnouncementsTab } from "./announcements-tab";
import { FaceKioskTab } from "./face-kiosk-tab";
import { api } from "@/lib/sas/client";
import type { MeResponse } from "@/lib/sas/types";

interface AdminDashboardProps {
  user: MeResponse;
  onLogout: () => void;
}

export function AdminDashboard({ user, onLogout }: AdminDashboardProps) {
  const [tab, setTab] = useState("overview");

  async function handleLogout() {
    await api.logout().catch(() => {});
    onLogout();
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-emerald-100 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <GraduationCap className="h-6 w-6" />
            </div>
            <div className="leading-tight">
              <p className="font-bold tracking-tight">EduTrack</p>
              <p className="text-xs text-muted-foreground">Admin Console</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
            <Avatar className="h-9 w-9 border border-emerald-200">
              <AvatarFallback className="bg-emerald-100 text-emerald-800 font-semibold">
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

      {/* Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
          <div className="overflow-x-auto sas-scroll pb-1">
            <TabsList className="inline-flex h-11 min-w-full justify-start gap-1 bg-emerald-50 p-1 sm:min-w-0">
              {[
                { value: "overview", icon: LayoutDashboard, label: "Overview" },
                { value: "attendance", icon: CalendarCheck2, label: "Attendance" },
                { value: "facekiosk", icon: ScanFace, label: "Face Kiosk" },
                { value: "students", icon: Users, label: "Students" },
                { value: "announcements", icon: Megaphone, label: "Announcements" },
              ].map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="gap-2 px-3 data-[state=active]:bg-emerald-600 data-[state=active]:text-white sm:px-4"
                >
                  <t.icon className="h-4 w-4" />
                  <span className="hidden xs:inline sm:inline">{t.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <TabsContent value="overview" className="mt-0">
              <OverviewTab onNavigate={setTab} />
            </TabsContent>
            <TabsContent value="attendance" className="mt-0">
              <AttendanceTab />
            </TabsContent>
            <TabsContent value="facekiosk" className="mt-0">
              <FaceKioskTab />
            </TabsContent>
            <TabsContent value="students" className="mt-0">
              <StudentsTab />
            </TabsContent>
            <TabsContent value="announcements" className="mt-0">
              <AnnouncementsTab />
            </TabsContent>
          </motion.div>
        </Tabs>
      </main>
    </div>
  );
}
