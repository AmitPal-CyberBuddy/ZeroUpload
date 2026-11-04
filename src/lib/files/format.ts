/** Human-readable helpers used across every tool. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 4823401 → "4.82 MB". Uses binary-adjacent (1024) units, the convention users expect. */
export function formatBytes(bytes: number, maxDecimals = 2): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : maxDecimals;
  const rounded = value
    .toFixed(decimals)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
  return `${rounded} ${UNITS[unit]}`;
}

export function formatPercent(ratio: number, decimals = 1): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(decimals).replace(/\.0$/, '')}%`;
}

/** Positive number means the output got smaller. */
export function savingsPercent(original: number, output: number): number {
  if (!original) return 0;
  return ((original - output) / original) * 100;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatCount(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}

/** Trims a long filename in the middle while preserving the extension. */
export function middleTruncate(name: string, max = 34): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : '';
  const stem = ext ? name.slice(0, dot) : name;
  const keep = Math.max(4, max - ext.length - 1);
  const head = Math.ceil(keep * 0.62);
  const tail = keep - head;
  return `${stem.slice(0, head)}…${stem.slice(stem.length - Math.max(tail, 1))}${ext}`;
}

/** Strips the extension from a filename: "photo final.jpg" → "photo final". */
export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** "image/jpeg" + "jpeg" → "photo-zeroupload.jpeg" */
export function outputName(originalName: string, ext: string, suffix?: string): string {
  const base = stripExtension(originalName).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'file';
  const tail = suffix ? `-${suffix}` : '';
  return `${base}${tail}.${ext}`;
}
