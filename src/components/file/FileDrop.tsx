import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import { formatBytes } from '../../lib/files/format';
import { takeHandoff } from '../../lib/files/handoff';
import { mimeFromExtension } from '../../lib/files/mime';

interface FileDropProps {
  onFiles: (files: File[]) => void;
  onError?: (message: string) => void;
  accept?: string;
  multiple?: boolean;
  maxSize?: number;
  maxFiles?: number;
  title?: string;
  hint?: ReactNode;
  icon?: IconName;
  /** Compact variant sits inside a sidebar or after a file already exists. */
  compact?: boolean;
  disabled?: boolean;
  /** id of a description element for aria-describedby */
  describedBy?: string;
  /** Accept an explicitly routed, in-memory file from another workspace. */
  handoffTarget?: string;
}

function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const patterns = accept.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (patterns.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || mimeFromExtension(file.name)).toLowerCase();

  return patterns.some((pattern) => {
    if (pattern.startsWith('.')) return name.endsWith(pattern);
    if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  });
}

/**
 * The intake zone: drag and drop, paste, or pick a file.
 *
 * It used to be a `div role="button"` with a hidden input inside it, which meant
 * re-implementing what a file input already does — click-to-open, Enter/Space,
 * the "Choose file" announcement — and getting the announcement slightly wrong
 * (the real input was hidden from the accessibility tree, so the control was
 * described as a button with no file semantics).
 *
 * Now the wrapper only handles drag events and the visible content is a
 * `<label>` for a real `<input type="file">`. Clicking anywhere in the zone opens
 * the picker because that is what a label does; the input stays in the tab order,
 * so keyboard users reach an actual file control; and the focus ring is drawn on
 * the zone with `:has(:focus-visible)` so the whole target shows where focus is.
 */
export function FileDrop({
  onFiles,
  onError,
  accept,
  multiple = false,
  maxSize,
  maxFiles,
  title = 'Drop a file here',
  hint,
  icon = 'plus',
  compact = false,
  disabled = false,
  describedBy,
  handoffTarget,
}: FileDropProps) {
  const inputId = useId();
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);

  const intake = useCallback(
    (list: FileList | File[] | null) => {
      if (!list) return;
      const files = Array.from(list);
      if (files.length === 0) return;

      setIntakeError(null);
      const reportError = (message: string) => {
        if (onError) onError(message);
        else setIntakeError(message);
      };
      const valid: File[] = [];
      for (const file of files) {
        if (!matchesAccept(file, accept)) {
          reportError(`${file.name} is not a supported file type here.`);
          continue;
        }
        if (maxSize && file.size > maxSize) {
          reportError(`${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(maxSize)}.`);
          continue;
        }
        if (file.size === 0) {
          reportError(`${file.name} is empty.`);
          continue;
        }
        valid.push(file);
        if (!multiple) break;
        if (maxFiles && valid.length >= maxFiles) break;
      }
      if (valid.length > 0) onFiles(valid);
    },
    [accept, maxFiles, maxSize, multiple, onError, onFiles],
  );

  useEffect(() => {
    if (!handoffTarget || disabled) return;
    // Start after all parent effects have mounted. In StrictMode React replays
    // mount effects; synchronous intake can be cancelled by a parent's cleanup
    // after the one-shot handoff has already been consumed.
    const timer = window.setTimeout(() => {
      const files = takeHandoff(handoffTarget);
      if (files.length) intake(files);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [handoffTarget, disabled, intake]);

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled) return;
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = disabled || !dragging ? 'none' : 'copy';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;
    intake(event.dataTransfer?.files ?? null);
  };

  // Keyboard-accessible: Ctrl/Cmd+V pastes files when the page or this file input has focus.
  useEffect(() => {
    if (disabled) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files;
      if (files && files.length > 0 && (document.activeElement === document.body || document.activeElement === document.getElementById(inputId))) {
        event.preventDefault();
        intake(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [disabled, intake, inputId]);

  return (
    <div
      className="filedrop"
      data-dragging={dragging || undefined}
      data-compact={compact || undefined}
      data-disabled={disabled || undefined}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <input
        id={inputId}
        type="file"
        className="filedrop__input visually-hidden"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => {
          intake(event.target.files);
          event.target.value = '';
        }}
      />

      <label className="filedrop__label" htmlFor={inputId}>
        <span className="filedrop__glyph" aria-hidden="true">
          <svg viewBox="0 0 48 48" className="filedrop__ring">
            <circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray="4 6" opacity="0.4" />
            <circle cx="24" cy="24" r="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="52 30" strokeLinecap="round" />
          </svg>
          <Icon name={icon} size={compact ? 16 : 18} className="filedrop__icon" />
        </span>

        <span className="filedrop__text">
          <strong>{dragging ? 'Release to load locally' : title}</strong>
          {hint ? <span className="filedrop__hint">{hint}</span> : null}
        </span>

        {!compact ? (
          <span className="filedrop__cta">
            <Icon name="file" size={14} />
            Choose file
          </span>
        ) : null}
      </label>
      {intakeError ? <p className="filedrop__error" role="alert">{intakeError}</p> : null}
    </div>
  );
}
