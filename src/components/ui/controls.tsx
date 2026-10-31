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

/* ---------- Notice ---------- */
export function Notice({
  tone = 'default',
  icon,
  children,
  title,
}: {
  tone?: 'default' | 'accent' | 'danger' | 'warn';
  icon?: IconName;
  children: ReactNode;
  title?: string;
}) {
  const name: IconName = icon ?? (tone === 'danger' ? 'alert' : tone === 'warn' ? 'alert' : tone === 'accent' ? 'shield' : 'info');
  return (
    <div className={`notice notice--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
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
