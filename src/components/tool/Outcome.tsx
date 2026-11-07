import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';

/**
 * "What you'll get, before you run it."
 *
 * Every tool used to be write-only: you set the options, pressed the button, and
 * only then found out that quality 40 made a 900 kB file or that your page range
 * produced one document instead of four. That is the same shape as uploading to a
 * server and waiting for a link — the local-first architecture removes the wait,
 * but not the guesswork, if the output is invisible until it exists.
 *
 * This panel states the outcome as soon as the inputs are known: what the
 * dimensions become, which format, how many files, and — for images, where it can
 * be measured rather than guessed — the actual size of the encoded result.
 *
 * Conventions that matter:
 *
 *  - A measured value is printed plainly (`412 KB`); an extrapolated one is
 *    prefixed with `≈`. The distinction is the whole point of the panel.
 *  - Rows keep their order between states, so nothing jumps while a value is
 *    being measured. The measuring row shows a spinner in the value slot instead
 *    of an em-dash.
 *  - `aria-live="polite"` is on the value column only. Announcing the whole panel
 *    on each keystroke of a width field would be a screen-reader stutter.
 */

export interface OutcomeRow {
  label: string;
  value: ReactNode;
  /** `good` when the outcome improves on the input, `warn` when it does not. */
  tone?: 'good' | 'warn';
  /** True when `value` is an estimate rather than a measured number. */
  approximate?: boolean;
  hint?: string;
}

export function Outcome({
  rows,
  title = 'What you will get',
  measuring = false,
  note,
  action,
}: {
  rows: OutcomeRow[];
  title?: string;
  measuring?: boolean;
  note?: ReactNode;
  action?: ReactNode;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="outcome" aria-label={title}>
      <div className="outcome__head">
        <Icon name="sparkle" size={12} />
        <span>{title}</span>
        {measuring ? (
          <span className="outcome__measuring">
            <Spinner label="Measuring output" />
          </span>
        ) : null}
      </div>

      <dl className="outcome__rows" aria-live="polite" aria-atomic="false">
        {rows.map((row) => (
          <div className="outcome__row" key={row.label}>
            <dt>{row.label}</dt>
            <dd className={row.tone ? `outcome__value outcome__value--${row.tone}` : 'outcome__value'}>
              {row.approximate ? <span className="outcome__approx">≈</span> : null}
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {note ? <p className="outcome__note">{note}</p> : null}
      {action ? <div className="outcome__action">{action}</div> : null}
    </section>
  );
}
