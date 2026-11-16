/** Human-readable helpers used across every tool. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 4823401 → "4.82 MB". Uses binary-adjacent (1024) units, the convention users expect. */
export function formatBytes(bytes: number, maxDecimals = 2): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) {
    // 1023.6 bytes rounds to 1024, which is 1 KB — not "1024 B".
    const whole = Math.round(bytes);
    if (whole < 1024) return `${whole} B`;
  }
  let value = bytes < 1024 ? 1024 : bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  /*
   * Rounding is chosen by the *rounded* magnitude, not the raw one: choosing by
   * the raw value turned 1048575.9 into "1024 KB" (a full unit displayed at the
   * scale of the smaller one). Promote once so a rounding carry stays honest.
   */
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : maxDecimals;
  const rounded = Number(value.toFixed(decimals));
  if (rounded >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
    const nextDecimals = value >= 100 ? 0 : value >= 10 ? 1 : maxDecimals;
    return `${trimZeros(value.toFixed(nextDecimals))} ${UNITS[unit]}`;
  }
  return `${trimZeros(value.toFixed(decimals))} ${UNITS[unit]}`;
}

/** "1.50" → "1.5", "2.00" → "2". */
function trimZeros(fixed: string): string {
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
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
  /*
   * Seconds are rounded before the minute boundary is tested, and the carry is
   * propagated. Testing the raw value produced "59m 60s" for 3 599 999 ms and
   * "60.0 s" for 59 999 ms — a duration with a 60th second in it.
   */
  if (ms < 59_950) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export function formatCount(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}

/**
 * Trims a long filename in the middle while preserving the extension.
 *
 * The result never exceeds `max`. When the budget left for the stem is too small
 * to split into a head and a tail, the stem is returned whole rather than sliced
 * from both ends — the old version could emit `a…a.png` for `max = 4`, repeating
 * a character *and* exceeding the limit it was asked to respect.
 */
export function middleTruncate(name: string, max = 34): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : '';
  const stem = ext ? name.slice(0, dot) : name;

  // One character is the ellipsis; the extension is kept whole when it fits.
  const budget = max - ext.length - 1;
  if (budget <= 0) return name.slice(0, max);
  // A head and a tail need at least two characters each to mean anything.
  if (stem.length <= budget || budget < 4) return `${stem.slice(0, budget)}…${ext}`;

  const head = Math.ceil(budget * 0.62);
  const tail = budget - head;
  return `${stem.slice(0, head)}…${stem.slice(stem.length - tail)}${ext}`;
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
