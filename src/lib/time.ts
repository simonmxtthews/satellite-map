export const MAX_TIME_OFFSET_MS = 12 * 60 * 60 * 1000;

// Playback speed presets, as a multiplier of real time (e.g. 60 = 1
// simulated minute per real second).
export const PLAYBACK_SPEEDS = [1, 60, 300, 1800];

export function simulatedNow(offsetMs: number): Date {
  return new Date(Date.now() + offsetMs);
}

export function formatOffset(offsetMs: number): string {
  if (Math.abs(offsetMs) < 60000) return "now";
  const sign = offsetMs > 0 ? "+" : "-";
  const abs = Math.abs(offsetMs);
  const hours = Math.floor(abs / 3600000);
  const minutes = Math.round((abs % 3600000) / 60000);
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours === 0) parts.push(`${minutes}m`);
  return `${sign}${parts.join(" ")}`;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

export function formatDateTime(date: Date): string {
  return dateFormatter.format(date);
}

// Short "4m 12s"-style duration, distinct from formatOffset (which formats a
// signed offset from now, not a plain span) — used for pass durations.
export function formatDurationShort(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
