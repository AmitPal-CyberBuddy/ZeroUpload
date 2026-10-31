/**
 * Determinate progress bar. Worker progress arrives as 0–1 ratios; this is the
 * only place that turns them into markup, so every tool reports the same way.
 */
export function Progress({ value, label }: { value: number; label: string }) {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const percent = Math.round(clamped * 100);
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress__bar" style={{ ['--value' as string]: `${percent}%` }} />
    </div>
  );
}
