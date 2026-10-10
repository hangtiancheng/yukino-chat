import {
  format,
  formatDistanceToNowStrict,
  isToday,
  isValid,
  isYesterday,
  parse,
} from "date-fns";

const WIRE_TIMESTAMP = "yyyy-MM-dd HH:mm:ss";

function parseWireTimestamp(value: string): Date | null {
  const parsed = parse(value, WIRE_TIMESTAMP, new Date());
  return isValid(parsed) ? parsed : null;
}

export function getFileSize(size: number): string {
  if (size < 1024) return size + "B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(2) + "KB";
  if (size < 1024 * 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + "MB";
  return (size / 1024 / 1024 / 1024).toFixed(2) + "GB";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  return (bytes / 1024).toFixed(1) + " KB";
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + "M";
  if (count >= 1000) return (count / 1000).toFixed(1) + "K";
  return String(count);
}

export function formatExpire(nanos: number): string {
  if (nanos <= 0 || nanos >= Number.MAX_SAFE_INTEGER) return "never";
  const expiresAt = new Date(nanos / 1_000_000);
  if (expiresAt.getTime() <= Date.now()) return "expired";
  return `${formatDistanceToNowStrict(expiresAt)} left`;
}

export function formatMessageTime(value: string): string {
  const parsed = parseWireTimestamp(value);
  return parsed ? format(parsed, "HH:mm") : value;
}

export function formatMessageDay(value: string): string {
  const parsed = parseWireTimestamp(value);
  if (!parsed) return value;
  if (isToday(parsed)) return "Today";
  if (isYesterday(parsed)) return "Yesterday";
  return format(parsed, "PPP");
}

export function messageDayKey(value: string): string {
  const parsed = parseWireTimestamp(value);
  return parsed ? format(parsed, "yyyy-MM-dd") : "";
}

export function formatSessionTime(epochMs: number): string {
  if (!epochMs) return "";
  const date = new Date(epochMs);
  if (!isValid(date)) return "";
  if (isToday(date)) return format(date, "HH:mm");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MM/dd");
}
