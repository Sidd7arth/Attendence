#!/usr/bin/env python3
"""Reset student data — destructive, ADMIN-USE ONLY (spec PHASE 5 scripts/).

Removes EVERY student profile and all dependent biometric/attendance rows
from the shared EduTrack SQLite database, leaving the admin account and
schema intact. Equivalent to the application-layer reset in PHASE 2; kept
here as the canonical maintenance tool.

Usage:
    python scripts/reset_student_data.py            # interactive
    python scripts/reset_student_data.py --yes      # non-interactive
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2].parent / "db" / "custom.db"


def reset(db_path: Path, assume_yes: bool) -> None:
    if not db_path.exists():
        print(f"ERROR: database not found at {db_path}")
        sys.exit(1)

    counts = {}
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        for table in ("students", "face_profiles", "face_challenges", "attendances",
                      "announcement_reads", "sessions"):
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            counts[table] = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM admins")
        counts["admins"] = cur.fetchone()[0]
    finally:
        conn.close()

    print("Current state:")
    for k, v in counts.items():
        print(f"  {k:20s} {v}")

    if counts["students"] == 0:
        print("Nothing to reset — no students exist.")
        return

    if not assume_yes:
        answer = input("\nDelete ALL students + biometrics + attendance? Type 'RESET' to confirm: ")
        if answer.strip() != "RESET":
            print("Aborted.")
            return

    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        # FK-safe order (children first). announcements are NOT deleted here —
        # they belong to the admin account, not to student data.
        cur.execute("DELETE FROM face_profiles")
        cur.execute("DELETE FROM face_challenges")
        cur.execute("DELETE FROM attendances")
        cur.execute("DELETE FROM announcement_reads")
        cur.execute("DELETE FROM sessions")
        cur.execute("DELETE FROM students")
        conn.commit()
        print("\nReset complete:")
        print("  students=0 face_profiles=0 face_challenges=0 attendances=0")
        print("  admin accounts and schema preserved")
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="EduTrack student data reset")
    parser.add_argument("--yes", action="store_true", help="skip confirmation")
    parser.add_argument("--db", default=str(DB_PATH), help="database path override")
    args = parser.parse_args()
    reset(Path(args.db), args.yes)
