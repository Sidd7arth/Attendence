"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Send, Loader2, Eye, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError } from "@/lib/sas/client";
import { relativeTime } from "@/lib/sas/dates";
import type { AnnouncementDTO, StudentDTO } from "@/lib/sas/types";

export function AnnouncementsTab({ onChanged }: { onChanged?: () => void }) {
  const { toast } = useToast();
  const [announcements, setAnnouncements] = useState<AnnouncementDTO[] | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [target, setTarget] = useState("ALL");
  const [highPriority, setHighPriority] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([api.adminAnnouncements(), api.adminStudents()]);
      setAnnouncements(a.announcements);
      setClasses(Array.from(new Set(s.students.filter((st) => st.active).map((st: StudentDTO) => st.class))).sort());
    } catch (e) {
      toast({
        title: "Failed to load announcements",
        description: e instanceof ApiError ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSend() {
    if (!title.trim() || !content.trim()) {
      toast({ title: "Missing fields", description: "Please add a title and a message.", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      await api.adminSendAnnouncement({
        title,
        content,
        targetClass: target === "ALL" ? null : target,
        priority: highPriority ? "HIGH" : "NORMAL",
      });
      toast({ title: "Announcement sent 📣", description: target === "ALL" ? "Delivered to all students." : `Delivered to class ${target}.` });
      setTitle("");
      setContent("");
      setHighPriority(false);
      await load();
      onChanged?.();
    } catch (e) {
      toast({
        title: "Could not send",
        description: e instanceof ApiError ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
      {/* Composer */}
      <Card className="h-fit border-emerald-100">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Megaphone className="h-5 w-5 text-emerald-600" />
            Send an update
          </CardTitle>
          <CardDescription>Students see it instantly in their Updates inbox</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="a-title">Title *</Label>
            <Input id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sports Day Schedule" maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-content">Message *</Label>
            <Textarea
              id="a-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write the announcement…"
              rows={6}
              maxLength={2000}
            />
            <p className="text-right text-xs text-muted-foreground">{content.length}/2000</p>
          </div>
          <div className="space-y-1.5">
            <Label>Recipients</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger aria-label="Choose recipients">
                <SelectValue placeholder="Choose recipients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">🏫 All students</SelectItem>
                {classes.map((c) => (
                  <SelectItem key={c} value={c}>
                    Class {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
            <div>
              <p className="text-sm font-medium">High priority</p>
              <p className="text-xs text-muted-foreground">Marked with a red badge for students</p>
            </div>
            <Switch checked={highPriority} onCheckedChange={setHighPriority} aria-label="High priority" />
          </div>
          <Button onClick={handleSend} disabled={sending} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send announcement
          </Button>
        </CardContent>
      </Card>

      {/* Sent list */}
      <Card className="border-emerald-100">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Sent Announcements</CardTitle>
          <CardDescription>Read receipts are tracked per student</CardDescription>
        </CardHeader>
        <CardContent>
          {!announcements ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : announcements.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Megaphone className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No announcements yet. Send your first update!</p>
            </div>
          ) : (
            <ul className="max-h-[36rem] space-y-3 overflow-y-auto sas-scroll pr-1">
              {announcements.map((a) => {
                const pct = a.totalTargets === 0 ? 0 : Math.round((a.readCount / a.totalTargets) * 100);
                return (
                  <li key={a.id} className="rounded-xl border border-emerald-50 bg-emerald-50/30 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{a.title}</p>
                      {a.priority === "HIGH" && (
                        <Badge variant="outline" className="border-rose-200 bg-rose-100 text-rose-700">
                          High priority
                        </Badge>
                      )}
                      <Badge variant="outline" className="border-emerald-200 bg-white text-emerald-800">
                        <Users className="mr-1 h-3 w-3" />
                        {a.targetClass ? `Class ${a.targetClass}` : "All students"}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground">{a.content}</p>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        {relativeTime(a.createdAt)} · by {a.adminName}
                      </p>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="flex items-center gap-1 text-emerald-700">
                          <Eye className="h-3.5 w-3.5" />
                          {a.readCount}/{a.totalTargets} read ({pct}%)
                        </span>
                      </div>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-emerald-100">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
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
