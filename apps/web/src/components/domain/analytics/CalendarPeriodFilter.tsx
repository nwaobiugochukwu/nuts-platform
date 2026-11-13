"use client";

import { useState } from "react";

const REPORTING_TIME_ZONE = "Africa/Lagos";
const ANALYTICS_EVENT_RETENTION_DAYS = 730;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CalendarPeriodMode = "day" | "month" | "year";

export interface CalendarPeriodBounds {
  startDate: string;
  endDate: string;
  label: string;
}

function localDateInputValue(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateAtReportingMidnight(year: number, month: number, day: number): Date {
  const targetUtc = Date.UTC(year, month - 1, day);
  let instant = targetUtc;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  // Resolve the local midnight to an instant without assuming the browser's
  // timezone or a fixed UTC offset.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = formatter.formatToParts(new Date(instant));
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const representedUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    const adjustment = targetUtc - representedUtc;
    instant += adjustment;
    if (adjustment === 0) break;
  }

  return new Date(instant);
}

function getMinimumSelectableDates(now: Date) {
  const oldestAllowed = new Date(
    now.getTime() - ANALYTICS_EVENT_RETENTION_DAYS * DAY_MS + DAY_MS,
  );
  const minDay = localDateInputValue(oldestAllowed);
  const [cutoffYear = now.getFullYear(), cutoffMonth = now.getMonth() + 1] =
    minDay.split("-").map(Number);
  let year = cutoffYear;
  let month = cutoffMonth + 1;
  if (month > 12) {
    year += 1;
    month = 1;
  }
  const minMonth = `${year}-${String(month).padStart(2, "0")}`;
  const minYear = minDay.endsWith("-01-01")
    ? Number(minDay.slice(0, 4))
    : Number(minDay.slice(0, 4)) + 1;
  return { minDay, minMonth, minYear };
}

export function useCalendarPeriod() {
  const [mode, setMode] = useState<CalendarPeriodMode>("day");
  const [day, setDay] = useState(() => localDateInputValue(new Date()));
  const [month, setMonth] = useState(() => day.slice(0, 7));
  const [year, setYear] = useState(() => day.slice(0, 4));
  const value = mode === "day" ? day : mode === "month" ? month : year;

  function setValue(nextValue: string) {
    if (!nextValue) return;
    if (mode === "day") setDay(nextValue);
    else if (mode === "month") setMonth(nextValue);
    else setYear(nextValue);
  }

  return {
    mode,
    setMode,
    value,
    setValue,
    bounds: getCalendarPeriodBounds(mode, value),
  };
}

export function getCalendarPeriodBounds(
  mode: CalendarPeriodMode,
  value: string,
): CalendarPeriodBounds {
  const now = new Date();
  const today = localDateInputValue(now);
  let start: Date;
  let end: Date;
  let label: string;

  if (mode === "day") {
    const [todayYear = 1970, todayMonth = 1, todayDay = 1] = today
      .split("-")
      .map(Number);
    const selectedParts = value.split("-").map(Number);
    const year = selectedParts[0] ?? todayYear;
    const month = selectedParts[1] ?? todayMonth;
    const day = selectedParts[2] ?? todayDay;
    start = dateAtReportingMidnight(year, month, day);
    end = dateAtReportingMidnight(year, month, day + 1);
    label =
      value === today
        ? "Today"
        : start.toLocaleDateString(undefined, {
            timeZone: REPORTING_TIME_ZONE,
            year: "numeric",
            month: "long",
            day: "numeric",
          });
  } else if (mode === "month") {
    const [year = now.getFullYear(), month = now.getMonth() + 1] = value
      .split("-")
      .map(Number);
    start = dateAtReportingMidnight(year, month, 1);
    end = dateAtReportingMidnight(year, month + 1, 1);
    label = start.toLocaleDateString(undefined, {
      timeZone: REPORTING_TIME_ZONE,
      year: "numeric",
      month: "long",
    });
  } else {
    const year = Number(value);
    start = dateAtReportingMidnight(year, 1, 1);
    end = dateAtReportingMidnight(year + 1, 1, 1);
    label = String(year);
  }

  // Report periods follow Africa/Lagos calendar boundaries on every device.
  return {
    startDate: start.toISOString(),
    endDate: new Date(end.getTime() - 1).toISOString(),
    label,
  };
}

interface CalendarPeriodFilterProps {
  mode: CalendarPeriodMode;
  value: string;
  onModeChange: (mode: CalendarPeriodMode) => void;
  onValueChange: (value: string) => void;
}

export function CalendarPeriodFilter({
  mode,
  value,
  onModeChange,
  onValueChange,
}: CalendarPeriodFilterProps) {
  const now = new Date();
  const today = localDateInputValue(now);
  const currentMonth = today.slice(0, 7);
  const { minDay, minMonth, minYear } = getMinimumSelectableDates(now);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-neutral-200 bg-white/70 p-2 shadow-xs dark:border-neutral-800 dark:bg-neutral-900/70">
      <div className="flex items-center gap-1" aria-label="Analytics calendar view">
        {(["day", "month", "year"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={mode === item}
            onClick={() => onModeChange(item)}
            className={`rounded-xl px-3 py-2 text-xs font-semibold capitalize transition-colors ${
              mode === item
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-950"
                : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {mode === "day" ? (
        <input
          aria-label="Choose analytics day"
          type="date"
          min={minDay}
          max={today}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          className="rounded-xl border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:text-white"
        />
      ) : mode === "month" ? (
        <input
          aria-label="Choose analytics month"
          type="month"
          min={minMonth}
          max={currentMonth}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          className="rounded-xl border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:text-white"
        />
      ) : (
        <select
          aria-label="Choose analytics year"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          className="rounded-xl border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:text-white"
        >
          {Array.from(
            { length: now.getFullYear() - minYear + 1 },
            (_, index) => String(now.getFullYear() - index),
          ).map((year) => (
            <option key={year} value={year} className="text-neutral-900">
              {year}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
