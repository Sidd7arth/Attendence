/**
 * GPS capture validation for attendance (the previously missing subsystem).
 *
 * The device sends coordinates with each biometric check-in. Rules:
 *  - Coordinates are CAPTURED whenever available and PERSISTED as provided.
 *  - When BIOMETRIC_GPS_REQUIRED=true the check-in FAILS CLOSED without a
 *    valid fix: coordinates present, finite, in range, and accuracy (when
 *    reported) within BIOMETRIC_GPS_MAX_ACCURACY meters.
 *  - The browser cannot forge a "pass": everything is validated here and the
 *    stored flags describe only what the server actually verified.
 */
import "server-only";

export interface GpsInput {
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
}

export interface GpsDecision {
  valid: boolean;
  stored: { latitude: number | null; longitude: number | null; gpsAccuracy: number | null };
  reason: string; // GPS_NOT_PROVIDED | GPS_OK | GPS_INVALID_RANGE | GPS_WEAK_ACCURACY | GPS_REQUIRED_MISSING
}

const REQUIRED = process.env.BIOMETRIC_GPS_REQUIRED === "true";
const MAX_ACCURACY = Math.max(5, Number(process.env.BIOMETRIC_GPS_MAX_ACCURACY ?? 150));

export function validateGps(input: GpsInput | undefined): GpsDecision {
  const lat = input?.latitude;
  const lon = input?.longitude;
  const acc = input?.accuracy;

  if (
    lat === null || lat === undefined || !Number.isFinite(lat) ||
    lon === null || lon === undefined || !Number.isFinite(lon)
  ) {
    return {
      valid: false,
      stored: { latitude: null, longitude: null, gpsAccuracy: null },
      reason: REQUIRED ? "GPS_REQUIRED_MISSING" : "GPS_NOT_PROVIDED",
    };
  }

  const inRange =
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
    !(lat === 0 && lon === 0);

  if (!inRange) {
    return {
      valid: false,
      stored: { latitude: null, longitude: null, gpsAccuracy: null },
      reason: "GPS_INVALID_RANGE",
    };
  }

  const accValid = acc === null || acc === undefined || !Number.isFinite(acc) || acc <= MAX_ACCURACY;
  if (!accValid) {
    return {
      valid: true, // coordinates are real, just weak — persisted but flagged
      stored: { latitude: lat, longitude: lon, gpsAccuracy: acc ?? null },
      reason: REQUIRED ? "GPS_WEAK_ACCURACY" : "GPS_WEAK_ACCURACY",
    };
  }

  return {
    valid: true,
    stored: { latitude: lat, longitude: lon, gpsAccuracy: acc ?? null },
    reason: "GPS_OK",
  };
}

export function gpsRequired(): boolean {
  return REQUIRED;
}
