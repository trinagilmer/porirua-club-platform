const { pool } = require("../db");

const MAX_OCCURRENCES = 160;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const str = String(value).trim();
  if (!str) return null;
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function formatDateOnly(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  return dateObj.toISOString().slice(0, 10);
}

function addDays(dateObj, days) {
  const d = new Date(dateObj.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function startOfWeek(dateObj) {
  const d = new Date(dateObj.getTime());
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

function addMonthsPreserveDay(dateObj, monthsToAdd, explicitDay) {
  const year = dateObj.getUTCFullYear();
  const month = dateObj.getUTCMonth();
  const target = new Date(Date.UTC(year, month, 1));
  target.setUTCMonth(target.getUTCMonth() + monthsToAdd);
  const desiredDay = explicitDay || dateObj.getUTCDate();
  const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(desiredDay, daysInMonth));
  return target;
}

function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
  if (!Number.isInteger(weekday)) return null;
  if (nth === -1) {
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
    const diff = (lastDay.getUTCDay() - weekday + 7) % 7;
    lastDay.setUTCDate(lastDay.getUTCDate() - diff);
    return lastDay;
  }
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const offset = (weekday - firstDay.getUTCDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  const candidate = new Date(Date.UTC(year, monthIndex, day));
  if (candidate.getUTCMonth() !== monthIndex) return null;
  return candidate;
}

function normalizeIntegerArray(values, min, max) {
  if (!values && values !== 0) return [];
  const arr = Array.isArray(values) ? values : String(values).split(",");
  const set = new Set();
  arr.forEach((value) => {
    const num = parseInt(value, 10);
    if (!Number.isNaN(num)) {
      if (typeof min === "number" && num < min) return;
      if (typeof max === "number" && num > max) return;
      set.add(num);
    }
  });
  return Array.from(set.values());
}

function normalizeSkipDates(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : String(value).split(/[\s,]+/);
  const dates = raw
    .map((entry) => formatDateOnly(toDateOnly(entry)))
    .filter(Boolean);
  return Array.from(new Set(dates));
}

function parseRecurrenceForm(body = {}) {
  const enabled = body.recurrence_enabled || body.recurrence_frequency;
  if (!enabled) return null;
  const frequency = String(body.recurrence_frequency || "none").toLowerCase();
  if (frequency === "none") return null;
  const interval = Math.max(1, Math.min(parseInt(body.recurrence_interval, 10) || 1, 30));
  const endDate = formatDateOnly(toDateOnly(body.recurrence_end_date || body.recurrence_until));
  if (!endDate) return null;
  const weekdaySource = body.recurrence_weekdays ?? body["recurrence_weekdays[]"];
  const weekdays = normalizeIntegerArray(weekdaySource, 0, 6);
  const monthlyDay = body.recurrence_monthly_day
    ? Math.max(1, Math.min(parseInt(body.recurrence_monthly_day, 10), 31))
    : null;
  let monthlyWeek = null;
  if (body.recurrence_monthly_week) {
    const value = String(body.recurrence_monthly_week).toLowerCase();
    if (value === "last" || value === "-1") monthlyWeek = -1;
    else {
      const parsed = parseInt(value, 10);
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 4) {
        monthlyWeek = parsed;
      }
    }
  }
  const skipDates = normalizeSkipDates(body.recurrence_skip_dates || body.recurrence_exceptions);
  return {
    frequency,
    interval,
    endDate,
    weekdays,
    monthlyDay,
    monthlyWeek,
    skipDates,
  };
}

function generateOccurrenceDates({ startDate, recurrence }) {
  const start = toDateOnly(startDate);
  const end = toDateOnly(recurrence?.endDate);
  if (!start || !end || end.getTime() < start.getTime()) return [];
  const skipSet = new Set((recurrence?.skipDates || []).filter(Boolean));
  const dates = [];
  const pushDate = (dateObj) => {
    const iso = formatDateOnly(dateObj);
    if (!iso) return;
    if (skipSet.has(iso)) return;
    if (!dates.includes(iso)) dates.push(iso);
  };
  pushDate(start);
  if (!recurrence || recurrence.frequency === "none") return dates;
  const freq = recurrence.frequency;
  const interval = recurrence.interval || 1;
  if (freq === "daily") {
    let count = 1;
    let current = addDays(start, interval);
    while (current.getTime() <= end.getTime() && count < MAX_OCCURRENCES) {
      pushDate(current);
      count += 1;
      current = addDays(current, interval);
    }
    return dates;
  }
  if (freq === "weekly") {
    const weekdays = recurrence.weekdays && recurrence.weekdays.length
      ? recurrence.weekdays
      : [start.getUTCDay()];
    const weekdaySet = new Set(weekdays);
    let current = addDays(start, 1);
    let added = 1;
    const baselineWeekStart = startOfWeek(start);
    while (current.getTime() <= end.getTime() && added < MAX_OCCURRENCES) {
      const diffWeeks = Math.floor((current.getTime() - baselineWeekStart.getTime()) / WEEK_MS);
      if (diffWeeks >= 0 && diffWeeks % interval === 0 && weekdaySet.has(current.getUTCDay())) {
        pushDate(current);
        added += 1;
      }
      current = addDays(current, 1);
    }
    return dates;
  }
  if (freq === "monthly_date") {
    const day = recurrence.monthlyDay || start.getUTCDate();
    let added = 1;
    let months = interval;
    while (added < MAX_OCCURRENCES) {
      const candidate = addMonthsPreserveDay(start, months, day);
      if (candidate.getTime() > end.getTime()) break;
      pushDate(candidate);
      added += 1;
      months += interval;
    }
    return dates;
  }
  if (freq === "monthly_weekday") {
    const weekday = recurrence.weekdays && recurrence.weekdays.length
      ? recurrence.weekdays[0]
      : start.getUTCDay();
    const nth =
      typeof recurrence.monthlyWeek === "number"
        ? recurrence.monthlyWeek
        : Math.ceil(start.getUTCDate() / 7);
    let added = 1;
    let months = interval;
    while (added < MAX_OCCURRENCES) {
      const base = addMonthsPreserveDay(start, months, 1);
      const candidate = nthWeekdayOfMonth(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        weekday,
        nth === -1 ? -1 : Math.max(1, Math.min(nth, 4))
      );
      if (!candidate || candidate.getTime() > end.getTime()) break;
      if (candidate.getTime() >= start.getTime()) {
        pushDate(candidate);
        added += 1;
      }
      months += interval;
    }
    return dates;
  }
  return dates;
}

async function createSeriesRecord(dbOrClient, config) {
  const db = dbOrClient || pool;
  const { entityType, template, startDate, recurrence, createdBy, updatedBy } = config;
  if (!entityType || !startDate || !recurrence) return null;
  const occurrenceDates = generateOccurrenceDates({ startDate, recurrence });
  if (occurrenceDates.length <= 1) return null;
  const weekdaysArray =
    recurrence.weekdays && recurrence.weekdays.length ? recurrence.weekdays : null;
  const { rows } = await db.query(
    `
    INSERT INTO calendar_series
      (entity_type, template, frequency, interval, weekdays, monthly_day, monthly_week,
       start_date, end_date, created_by, updated_by, created_at, updated_at)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
    RETURNING id;
    `,
    [
      entityType,
      template || {},
      recurrence.frequency,
      recurrence.interval,
      weekdaysArray,
      recurrence.monthlyDay || null,
      recurrence.monthlyWeek || null,
      formatDateOnly(toDateOnly(startDate)),
      recurrence.endDate,
      createdBy || null,
      updatedBy || createdBy || null,
    ]
  );
  const seriesId = rows[0]?.id;
  if (!seriesId) return null;
  const skipDates = (recurrence.skipDates || []).filter(Boolean);
  if (skipDates.length) {
    const values = skipDates.map((_, idx) => `($1,$${idx + 2})`).join(",");
    await db.query(
      `INSERT INTO calendar_series_exceptions (series_id, exception_date) VALUES ${values}`,
      [seriesId, ...skipDates]
    );
  }
  return { seriesId, occurrenceDates };
}

module.exports = {
  parseRecurrenceForm,
  generateOccurrenceDates,
  createSeriesRecord,
};
