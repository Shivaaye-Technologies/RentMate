/** Weekly availability for companions (public.companion_availability; times in the slot's time zone). */
export type Slot = {
  id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  timezone: string;
};

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** 30-minute steps from 06:00 to 23:30 for starts, up to 24:00 for ends (public meetups, daytime and evening). */
export const START_CHOICES = Array.from({ length: 36 }, (_, i) => 360 + i * 30);
export const END_CHOICES = Array.from({ length: 36 }, (_, i) => 390 + i * 30);

export function minuteLabel(m: number): string {
  if (m === 1440) return "24:00";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Returns an error message, or null when the slot can be added next to the existing ones. */
export function slotProblem(slots: Slot[], weekday: number, start: number, end: number): string | null {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return "Choose a day.";
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440)
    return "Choose valid times.";
  if (end <= start) return "The end time must be after the start time.";
  if (end - start < 60) return "Make the window at least one hour.";
  const clash = slots.some((s) => s.weekday === weekday && start < s.end_minute && s.start_minute < end);
  return clash ? `This overlaps a window you already have on ${WEEKDAYS[weekday]}.` : null;
}

export function sortSlots(slots: Slot[]): Slot[] {
  return [...slots].sort((a, b) => a.weekday - b.weekday || a.start_minute - b.start_minute);
}
