import type { TimeHorizon } from "../models/cityTypes";

export const TIME_HORIZONS: Record<TimeHorizon, { label: string; cityMinutesPerSecond: number; description: string }> = {
  day: { label: "Day", cityMinutesPerSecond: 60, description: "One city hour per second" },
  week: { label: "Week", cityMinutesPerSecond: 360, description: "Six city hours per second" },
  month: { label: "Month", cityMinutesPerSecond: 1440, description: "One city day per second" },
  year: { label: "Year", cityMinutesPerSecond: 10080, description: "One city week per second" },
};

export function cityMinutesPerSecond(horizon: TimeHorizon): number {
  return TIME_HORIZONS[horizon].cityMinutesPerSecond;
}

export function calendarFromElapsedDays(startYear: number, elapsedDays: number): {
  year: number;
  month: number;
  dayOfMonth: number;
  dayOfYear: number;
} {
  let remaining = Math.max(0, Math.floor(elapsedDays));
  let year = startYear;
  while (remaining >= daysInYear(year)) {
    remaining -= daysInYear(year);
    year += 1;
  }
  const monthLengths = monthLengthsForYear(year);
  let month = 1;
  while (remaining >= monthLengths[month - 1]!) {
    remaining -= monthLengths[month - 1]!;
    month += 1;
  }
  return { year, month, dayOfMonth: remaining + 1, dayOfYear: Math.floor(elapsedDays) - daysBeforeYear(startYear, year) + 1 };
}

export function formatLongDate(startYear: number, elapsedDays: number): string {
  const calendar = calendarFromElapsedDays(startYear, elapsedDays);
  return `${MONTH_NAMES[calendar.month - 1]} ${calendar.dayOfMonth}, ${calendar.year}`;
}

export function formatClockTime(timeOfDayMinutes: number): string {
  const normalizedMinutes = ((Math.floor(timeOfDayMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function daysBeforeYear(startYear: number, targetYear: number): number {
  let days = 0;
  for (let year = startYear; year < targetYear; year += 1) days += daysInYear(year);
  return days;
}

function monthLengthsForYear(year: number): number[] {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
}

function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
