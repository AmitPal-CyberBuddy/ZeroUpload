import { Icon, type IconName } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';

/**
 * The single primary action for a tool, plus its escape hatch.
 *
 * Two things were wrong before this existed: several tools rendered the same
 * primary button twice (once under the preview, once in the settings footer), and
 * long-running PDF/ZIP/Office jobs could not be stopped. Both are properties of
 * the action itself, so both live here rather than being re-typed per tool.
 *
 * `cancellable` is separate from `busy` on purpose — a Cancel button that appears
 * and disappears inside a few frames is worse than no button.
 */
export function RunAction({
  label,
  busyLabel,
  icon,
  busy,
  disabled,
  onRun,
  onCancel,
  cancellable,
  block = true,
  hint,
}: {
  label: string;
  busyLabel: string;
  icon: IconName;
  busy: boolean;
  disabled?: boolean;
  onRun: () => void;
  onCancel?: () => void;
  cancellable?: boolean;
  block?: boolean;
  hint?: string;
}) {
  return (
    <div className={`run-action${block ? ' run-action--block' : ''}`}>
      <button
        type="button"
        className={`btn btn--primary${block ? ' btn--block' : ''}`}
        onClick={onRun}
        disabled={busy || disabled}
        aria-busy={busy || undefined}
      >
        {busy ? <Spinner /> : <Icon name={icon} size={14} />}
        {busy ? busyLabel : label}
      </button>
      {busy && onCancel && cancellable ? (
        <button type="button" className="btn btn--ghost btn--sm run-action__cancel" onClick={onCancel}>
          <Icon name="x" size={13} /> Cancel
        </button>
      ) : null}
      {hint && !busy ? <span className="run-action__hint">{hint}</span> : null}
    </div>
  );
}
