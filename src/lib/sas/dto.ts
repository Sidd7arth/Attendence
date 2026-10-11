/** Shared Prisma → DTO mappers so every route serializes entities identically. */
import type { Student, Attendance } from "@prisma/client";
import type { StudentDTO, AttendanceDTO } from "./types";

export function toStudentDTO(s: Student): StudentDTO {
  return {
    studentId: s.id,
    name: s.name,
    rollNumber: s.rollNumber,
    class: s.studentClass,
    email: s.email,
    phone: s.phone,
    active: s.active,
    faceRegistered: s.faceRegistered,
    createdAt: s.createdAt.toISOString(),
  };
}

export function toAttendanceDTO(a: Attendance): AttendanceDTO {
  return {
    attendanceId: a.id,
    studentId: a.studentId,
    date: a.date,
    status: a.status as AttendanceDTO["status"],
    markedBy: a.markedBy as AttendanceDTO["markedBy"],
    method: a.method as AttendanceDTO["method"],
    note: a.note,
    checkInAt: a.checkInAt ? a.checkInAt.toISOString() : null,
    latitude: a.latitude,
    longitude: a.longitude,
    gpsAccuracy: a.gpsAccuracy,
    faceVerified: a.faceVerified,
    livenessVerified: a.livenessVerified,
    verificationId: a.verificationId,
  };
}
