"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  GraduationCap,
  ShieldCheck,
  UserRound,
  CalendarCheck2,
  BellRing,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError } from "@/lib/sas/client";
import type { MeResponse } from "@/lib/sas/types";

interface LoginViewProps {
  onLoggedIn: (user: MeResponse) => void;
}

export function LoginView({ onLoggedIn }: LoginViewProps) {
  const { toast } = useToast();
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [showAdminPw, setShowAdminPw] = useState(false);
  const [showStudentPw, setShowStudentPw] = useState(false);
  const [loading, setLoading] = useState<"ADMIN" | "STUDENT" | null>(null);

  async function handleLogin(role: "ADMIN" | "STUDENT") {
    const email = role === "ADMIN" ? adminEmail : studentEmail;
    const password = role === "ADMIN" ? adminPassword : studentPassword;
    if (!email.trim() || !password) {
      toast({ title: "Missing fields", description: "Please enter both email and password.", variant: "destructive" });
      return;
    }
    setLoading(role);
    try {
      const res = await api.login(role, email, password);
      toast({ title: `Welcome back, ${res.user.name.split(" ")[0]}!`, description: `Signed in as ${role === "ADMIN" ? "Administrator" : "Student"}.` });
      onLoggedIn(res.user);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
      toast({ title: "Login failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] w-full grid lg:grid-cols-2">
      {/* Branding panel */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-700 p-10 text-emerald-50">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <GraduationCap className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xl font-bold tracking-tight">EduTrack</p>
              <p className="text-sm text-emerald-100/80">Student Attendance System</p>
            </div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="relative space-y-8"
        >
          <h1 className="max-w-md text-4xl font-bold leading-tight tracking-tight">
            Attendance, simplified for everyone.
          </h1>
          <div className="space-y-5">
            {[
              { icon: CalendarCheck2, title: "One-tap self check-in", desc: "Students mark their own attendance in seconds." },
              { icon: ShieldCheck, title: "Full admin control", desc: "Track, edit and audit daily attendance for every class." },
              { icon: BellRing, title: "Instant updates", desc: "Broadcast announcements straight to students." },
            ].map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.12, duration: 0.5 }}
                className="flex items-start gap-4"
              >
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <f.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold">{f.title}</p>
                  <p className="text-sm text-emerald-100/80">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <p className="relative text-xs text-emerald-100/60">
          © {new Date().getFullYear()} EduTrack · Greenfield Public School
        </p>
      </div>

      {/* Login card */}
      <div className="flex items-center justify-center bg-gradient-to-b from-emerald-50/60 to-background p-4 sm:p-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          <div className="mb-6 flex flex-col items-center gap-2 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <GraduationCap className="h-7 w-7" />
            </div>
            <p className="text-lg font-bold">EduTrack</p>
            <p className="text-sm text-muted-foreground">Student Attendance System</p>
          </div>

          <Card className="border-emerald-100 shadow-lg shadow-emerald-100/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-2xl">Sign in</CardTitle>
              <CardDescription>Choose your role to continue</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="admin">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="admin" className="gap-2 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                    <ShieldCheck className="h-4 w-4" /> Admin
                  </TabsTrigger>
                  <TabsTrigger value="student" className="gap-2 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                    <UserRound className="h-4 w-4" /> Student
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="admin" className="mt-0 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="admin-email">Email</Label>
                    <Input
                      id="admin-email"
                      type="email"
                      placeholder="admin@edutrack.in"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleLogin("ADMIN")}
                      autoComplete="username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="admin-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="admin-password"
                        type={showAdminPw ? "text" : "password"}
                        placeholder="••••••••"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleLogin("ADMIN")}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        aria-label={showAdminPw ? "Hide password" : "Show password"}
                        onClick={() => setShowAdminPw((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showAdminPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => handleLogin("ADMIN")}
                    disabled={loading !== null}
                  >
                    {loading === "ADMIN" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Sign in as Admin
                  </Button>
                </TabsContent>

                <TabsContent value="student" className="mt-0 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="student-email">Email</Label>
                    <Input
                      id="student-email"
                      type="email"
                      placeholder="you@school.edu"
                      value={studentEmail}
                      onChange={(e) => setStudentEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleLogin("STUDENT")}
                      autoComplete="username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="student-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="student-password"
                        type={showStudentPw ? "text" : "password"}
                        placeholder="••••••••"
                        value={studentPassword}
                        onChange={(e) => setStudentPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleLogin("STUDENT")}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        aria-label={showStudentPw ? "Hide password" : "Show password"}
                        onClick={() => setShowStudentPw((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showStudentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => handleLogin("STUDENT")}
                    disabled={loading !== null}
                  >
                    {loading === "STUDENT" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
                    Sign in as Student
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Credentials are assigned by the school administrator.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
