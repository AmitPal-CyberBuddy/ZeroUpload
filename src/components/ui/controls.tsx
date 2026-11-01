import { useEffect, useId, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { copyText } from '../../lib/files/download';

/* ---------- Field ---------- */
export function Field({
  label,
  hint,
  trailing,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  const labelContent = (
    <>
      <span>{label}</span>
      {trailing}
    </>
  );

  return (
    <div className="field">
      {/* Only associate a real <label> when it points at a single form control;
          otherwise clicking the text would activate an unrelated button. */}
      {htmlFor ? (
        <label className="field__label" htmlFor={htmlFor}>
          {labelContent}
        </label>
      ) : (
        <div className="field__label">{labelContent}</div>
      )}
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

/* ---------- Segmented ---------- */
export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__option"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Range ---------- */
export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="field">
      <div className="field__label">
        <label htmlFor={id}>{label}</label>
        <span className="setting-value">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

/* ---------- Toggle ---------- */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch__track" aria-hidden="true" />
      <span>
        {label}
        {hint ? <span className="field__hint" style={{ display: 'block' }}>{hint}</span> : null}
      </span>
    </label>
  );
}

/* ---------- RadioGroup ---------- */

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * Native radios in a fieldset, so the group is announced as one question with
 * a legend and arrow keys move between options — the behaviour a custom
 * button group has to re-implement badly.
 */
export function RadioGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
  name,
}: {
  legend: string;
  options: RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
  name: string;
}) {
  return (
    <fieldset className="radio-group">
      <legend className="field__label">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="radio">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span className="radio__mark" aria-hidden="true" />
          <span>
            {option.label}
            {option.hint ? (
              <span className="field__hint" style={{ display: 'block' }}>{option.hint}</span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/* ---------- Notice ---------- */
/**
 * An inline message with one of four severities.
 *
 * The tone is the severity, so the surface never has to be guessed from the copy:
 *
 *   default / accent — information. How something works, what a setting does,
 *                      what the output will contain. Never blocks an action.
 *   warn             — a decision. The user should read it *before* pressing the
 *                      primary button: a compatibility cost, an irreversible
 *                      consequence, a step that was skipped.
 *   danger           — a failure. Something did not happen.
 *
 * `announce` puts the message in the live region. It defaults to `danger` only,
 * because an alert that is already on screen at load has nothing new to say; a
 * static consequence warning rendered in red would interrupt for no reason.
 */
export function Notice({
  tone = 'default',
  icon,
  children,
  title,
  announce,
}: {
  tone?: 'default' | 'accent' | 'danger' | 'warn';
  icon?: IconName;
  children: ReactNode;
  title?: string;
  /** Override when a `danger` notice is static, or an error is not red. */
  announce?: boolean;
}) {
  const name: IconName = icon ?? (tone === 'danger' ? 'alert' : tone === 'warn' ? 'alert' : tone === 'accent' ? 'shield' : 'info');
  const live = announce ?? tone === 'danger';
  return (
    <div className={`notice notice--${tone}`} role={live ? 'alert' : undefined}>
      <Icon name={name} size={16} />
      <div>
        {title ? <strong style={{ display: 'block', marginBottom: 2 }}>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

/* ---------- Copy button ---------- */
export function CopyButton({
  value,
  label = 'Copy',
  className = 'btn btn--secondary btn--sm',
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await copyText(value);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} />
      {copied ? 'Copied' : label}
    </button>
  );
}
