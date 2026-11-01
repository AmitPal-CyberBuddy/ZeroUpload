import { formatBytes, formatPercent, savingsPercent } from '../../lib/files/format';

/**
 * Before → after size comparison. Positive savings read as success, negative as
 * a warning (some conversions legitimately grow a file, and we say so).
 */
export function CompareSizes({
  original,
  output,
  originalLabel = 'Original',
  outputLabel = 'Result',
}: {
  original: number;
  output: number;
  originalLabel?: string;
  outputLabel?: string;
}) {
  const saved = savingsPercent(original, output);
  const grew = saved < 0;

  return (
    <div className="compare">
      <div className="compare__side">
        <span className="compare__label">{originalLabel}</span>
        <span className="compare__value">{formatBytes(original)}</span>
      </div>
      <div className="compare__arrow" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h15M13 6l6 6-6 6" />
        </svg>
      </div>
      <div className="compare__side" style={{ textAlign: 'right', justifyItems: 'end' }}>
        <span className="compare__label">{outputLabel}</span>
        <span className="compare__value">{formatBytes(output)}</span>
      </div>
      <div className="compare__delta">
        <span className="delta-value" data-negative={grew || undefined}>
          {grew ? `+${formatPercent(-saved / 100)}` : formatPercent(saved / 100)}
        </span>
        <span>{grew ? 'larger than the original' : 'smaller'}</span>
        <span aria-hidden="true" style={{ opacity: 0.4 }}>
          ·
        </span>
        <span className="mono" style={{ fontSize: 12 }}>
          {grew ? '+' : '−'}
          {formatBytes(Math.abs(original - output))}
        </span>
      </div>
    </div>
  );
}
