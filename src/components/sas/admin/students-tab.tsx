"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  UserPlus,
  KeyRound,
  Search,
  Trash2,
  Pencil,
  Copy,
  Users,
  Loader2,
  ShieldCheck,
  Eye,
  EyeOff,
  ScanFace,
  Fingerprint,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError } from "@/lib/sas/client";
import type { StudentDTO } from "@/lib/sas/types";
import { FaceEnrollDialog } from "./face-enroll-dialog";

interface StudentsTabProps {
  onChanged?: () => void;
}

export function StudentsTab({ onChanged }: StudentsTabProps) {
  const { toast } = useToast();
  const [students, setStudents] = useState<StudentDTO[] | null>(null);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("ALL");

  // add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: "", rollNumber: "", email: "", studentClass: "", phone: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);

  // edit dialog
  const [editTarget, setEditTarget] = useState<StudentDTO | null>(null);
  const [editForm, setEditForm] = useState({ name: "", rollNumber: "", email: "", studentClass: "", phone: "", password: "" });
  const [editSaving, setEditSaving] = useState(false);

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState<StudentDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  // face enrollment + biometric revocation (server-side engine)
  const [faceTarget, setFaceTarget] = useState<StudentDTO | null>(null);
  const [removeFaceTarget, setRemoveFaceTarget] = useState<StudentDTO | null>(null);
  const [removingFace, setRemovingFace] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.adminStudents();
      setStudents(res.students);
    } catch (e) {
      toast({
        title: "Failed to load students",
        description: e instanceof ApiError ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const classes = useMemo(() => {
    if (!students) return [];
    return Array.from(new Set(students.map((s) => s.class))).sort();
  }, [students]);

  const filtered = useMemo(() => {
    if (!students) return [];
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (classFilter !== "ALL" && s.class !== classFilter) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.rollNumber.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
    });
  }, [students, search, classFilter]);

  async function handleAdd() {
    if (!form.name.trim() || !form.rollNumber.trim() || !form.email.trim() || !form.studentClass.trim()) {
      toast({ title: "Missing fields", description: "Name, roll no, email and class are required.", variant: "destructive" });
      return;
    }
    if (form.password && form.password.length < 6) {
      toast({ title: "Weak password", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await api.adminCreateStudent({
        name: form.name,
        rollNumber: form.rollNumber,
        email: form.email,
        class: form.studentClass,
        phone: form.phone || undefined,
        password: form.password || undefined,
      });
      setAddOpen(false);
      setForm({ name: "", rollNumber: "", email: "", studentClass: "", phone: "", password: "" });
      await load();
      onChanged?.();
      toast({
        title: "Student enrolled 🎉",
        description: `${res.student.name} can now sign in with ${res.credentials.email} / ${res.credentials.password}`,
      });
    } catch (e) {
      toast({
        title: "Could not add student",
        description: e instanceof ApiError ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  function openEdit(s: StudentDTO) {
    setEditTarget(s);
    setEditForm({ name: s.name, rollNumber: s.rollNumber, email: s.email, studentClass: s.class, phone: s.phone ?? "", password: "" });
  }

  async function handleEditSave() {
    if (!editTarget) return;
    if (!editForm.name.trim() || !editForm.rollNumber.trim() || !editForm.email.trim() || !editForm.studentClass.trim()) {
      toast({ title: "Missing fields", description: "Name, roll no, email and class are required.", variant: "destructive" });
      return;
    }
    if (editForm.password && editForm.password.length < 6) {
      toast({ title: "Weak password", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    setEditSaving(true);
    try {
      await api.adminUpdateStudent(editTarget.studentId, {
        name: editForm.name,
        rollNumber: editForm.rollNumber,
        email: editForm.email,
        class: editForm.studentClass,
        phone: editForm.phone || null,
        password: editForm.password || undefined,
      });
      setEditTarget(null);
      await load();
      onChanged?.();
      toast({
        title: "Student updated",
        description: editForm.password ? "Profile and password updated." : "Profile updated.",
      });
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof ApiError ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleActive(s: StudentDTO, active: boolean) {
    try {
      await api.adminUpdateStudent(s.studentId, { active });
      await load();
      onChanged?.();
      toast({ title: active ? `${s.name} re-enabled` : `${s.name} deactivated`, description: active ? "They can sign in again." : "They can no longer sign in." });
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof ApiError ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function handleRemoveFace() {
    if (!removeFaceTarget) return;
    setRemovingFace(true);
    try {
      await api.adminDeleteFace(removeFaceTarget.studentId);
      setStudents((prev) =>
        prev ? prev.map((x) => (x.studentId === removeFaceTarget.studentId ? { ...x, faceRegistered: false } : x)) : prev
      );
      toast({
        title: "Face data removed",
        description: `${removeFaceTarget.name}'s biometric template was permanently deleted.`,
      });
      setRemoveFaceTarget(null);
    } catch (e) {
      toast({
        title: "Could not remove face data",
        description: e instanceof ApiError ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRemovingFace(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.adminDeleteStudent(deleteTarget.studentId);
      toast({ title: "Student removed", description: `${deleteTarget.name} and their attendance records were deleted.` });
      setDeleteTarget(null);
      await load();
      onChanged?.();
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof ApiError ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-emerald-100">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5 text-emerald-600" />
                Student Management
              </CardTitle>
              <CardDescription>Enroll students and assign their login credentials</CardDescription>
            </div>
            <Button onClick={() => setAddOpen(true)} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
              <UserPlus className="h-4 w-4" /> Enroll student
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row">
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
            <div className="flex gap-2 overflow-x-auto sas-scroll pb-1">
              <Button
                variant={classFilter === "ALL" ? "default" : "outline"}
                size="sm"
                onClick={() => setClassFilter("ALL")}
                className={classFilter === "ALL" ? "bg-emerald-600 hover:bg-emerald-700" : "border-emerald-200"}
              >
                All
              </Button>
              {classes.map((c) => (
                <Button
                  key={c}
                  variant={classFilter === c ? "default" : "outline"}
                  size="sm"
                  onClick={() => setClassFilter(c)}
                  className={classFilter === c ? "bg-emerald-600 hover:bg-emerald-700" : "border-emerald-200"}
                >
                  {c}
                </Button>
              ))}
            </div>
          </div>

          {!students ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <ul className="max-h-[34rem] divide-y divide-emerald-50 overflow-y-auto sas-scroll pr-1">
              {filtered.map((s) => (
                <li key={s.studentId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">
                      {s.name
                        .split(" ")
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{s.name}</p>
                        {s.faceRegistered && (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-emerald-50 text-emerald-700"
                            title="Biometric template enrolled"
                          >
                            <ScanFace className="mr-1 h-3 w-3" /> face
                          </Badge>
                        )}
                        {!s.active && (
                          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-500">
                            inactive
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.rollNumber} · Class {s.class} · {s.email}
                        {s.phone ? ` · ${s.phone}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="mr-1 flex items-center gap-1.5" title={s.active ? "Can sign in" : "Sign-in disabled"}>
                      <Switch checked={s.active} onCheckedChange={(v) => toggleActive(s, v)} aria-label={`Toggle access for ${s.name}`} />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFaceTarget(s)}
                      aria-label={`${s.faceRegistered ? "Update" : "Register"} face for ${s.name}`}
                      className={`gap-1.5 ${s.faceRegistered ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "border-emerald-200"}`}
                    >
                      <ScanFace className="h-4 w-4" />
                      <span className="hidden md:inline">{s.faceRegistered ? "Update face" : "Register face"}</span>
                    </Button>
                    {s.faceRegistered && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setRemoveFaceTarget(s)}
                        aria-label={`Remove biometric data for ${s.name}`}
                        title="Remove face data"
                        className="border-rose-200 text-rose-600 hover:bg-rose-50"
                      >
                        <Fingerprint className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="outline" size="icon" onClick={() => openEdit(s)} aria-label={`Edit ${s.name}`} className="border-emerald-200">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setDeleteTarget(s)}
                      aria-label={`Delete ${s.name}`}
                      className="border-rose-200 text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="py-10 text-center text-sm text-muted-foreground">No students match your filters.</li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Add student dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-emerald-600" /> Enroll a student
            </DialogTitle>
            <DialogDescription>
              Assign login credentials. Leave the password empty to use the default <span className="font-mono">Student@123</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="f-name">Full name *</Label>
                <Input id="f-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Rahul Khanna" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-roll">Roll no *</Label>
                <Input id="f-roll" value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} placeholder="e.g. 10A-05" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="f-email">Email (login) *</Label>
                <Input id="f-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="rahul@edutrack.in" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-class">Class *</Label>
                <Input id="f-class" value={form.studentClass} onChange={(e) => setForm({ ...form, studentClass: e.target.value })} placeholder="e.g. 10-A" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-phone">Phone (optional)</Label>
              <Input id="f-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 …" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-password" className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" /> Password
              </Label>
              <div className="relative">
                <Input
                  id="f-password"
                  type={showPw ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Default: Student@123"
                  className="pr-10"
                />
                <button
                  type="button"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Enroll student
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit student dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-emerald-600" /> Edit {editTarget?.name}
            </DialogTitle>
            <DialogDescription>Update profile details or reset the password.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-name">Full name *</Label>
                <Input id="e-name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-roll">Roll no *</Label>
                <Input id="e-roll" value={editForm.rollNumber} onChange={(e) => setEditForm({ ...editForm, rollNumber: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-email">Email (login) *</Label>
                <Input id="e-email" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-class">Class *</Label>
                <Input id="e-class" value={editForm.studentClass} onChange={(e) => setEditForm({ ...editForm, studentClass: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-phone">Phone (optional)</Label>
              <Input id="e-phone" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-password" className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Reset password
              </Label>
              <Input
                id="e-password"
                type="text"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                placeholder="Leave empty to keep current password"
              />
              {editForm.password.length >= 6 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs text-emerald-700 hover:bg-emerald-50"
                  onClick={() => {
                    navigator.clipboard?.writeText(editForm.password).catch(() => {});
                    toast({ title: "Password copied", description: "Share it with the student securely." });
                  }}
                >
                  <Copy className="h-3 w-3" /> Copy new password
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={editSaving} className="bg-emerald-600 hover:bg-emerald-700">
              {editSaving && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Face enrollment dialog (server-side engine) */}
      <FaceEnrollDialog
        student={faceTarget!}
        open={!!faceTarget}
        onOpenChange={(open) => !open && setFaceTarget(null)}
        onSaved={(updated) => {
          setStudents((prev) =>
            prev ? prev.map((s) => (s.studentId === updated.studentId ? { ...s, ...updated } : s)) : prev
          );
        }}
      />

      {/* Remove biometric data confirm */}
      <AlertDialog open={!!removeFaceTarget} onOpenChange={(open) => !open && setRemoveFaceTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove face data for {removeFaceTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes their biometric template. They will no longer be recognized at
              the attendance camera and would need to re-register. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveFace} disabled={removingFace} className="bg-rose-600 hover:bg-rose-700">
              {removingFace && <Loader2 className="h-4 w-4 animate-spin" />} Remove face data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the student, their login access and all attendance history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-rose-600 hover:bg-rose-700">
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />} Delete student
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
