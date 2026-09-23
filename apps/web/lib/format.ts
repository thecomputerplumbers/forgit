const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["week", 604_800_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const absolute = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const day = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });

export function toMillis(value: number | string): number {
  return typeof value === "number" ? value : Date.parse(value);
}

export function timeAgo(value: number | string, now = Date.now()): string {
  const delta = toMillis(value) - now;
  if (Number.isNaN(delta)) return "";
  for (const [unit, size] of UNITS) {
    if (Math.abs(delta) >= size) return relative.format(Math.round(delta / size), unit);
  }
  return "just now";
}

export function formatDate(value: number | string): string {
  const millis = toMillis(value);
  return Number.isNaN(millis) ? "" : `${absolute.format(millis)} UTC`;
}

export function formatDay(value: number | string): string {
  const millis = toMillis(value);
  return Number.isNaN(millis) ? "Unknown date" : day.format(millis);
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function initials(name: string): string {
  const parts = name.split(/[\s._@-]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]?.[0]}${parts[1]?.[0]}` : name.slice(0, 2);
  return letters.toUpperCase();
}

/** A stable hue per name so the same person keeps the same avatar color. */
export function hue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return hash % 360;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
