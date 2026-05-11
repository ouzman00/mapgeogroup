const DEFAULT_DATE_OPTIONS = { day: "2-digit", month: "short", year: "numeric" };
const DEFAULT_TIME_OPTIONS = { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };

export function parseValidDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateLabel(value, fallback = "—", options = DEFAULT_DATE_OPTIONS) {
  const date = parseValidDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString("fr-FR", options);
}

export function formatDateTimeLabel(value, fallback = "—", options = DEFAULT_TIME_OPTIONS) {
  const date = parseValidDate(value);
  if (!date) return fallback;
  return date.toLocaleString("fr-FR", options);
}
