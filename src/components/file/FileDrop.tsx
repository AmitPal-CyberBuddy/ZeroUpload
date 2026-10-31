import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import { formatBytes } from '../../lib/files/format';

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
}

function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const patterns = accept.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (patterns.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();

  return patterns.some((pattern) => {
    if (pattern.startsWith('.')) return name.endsWith(pattern);
    if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  });
}

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
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const intake = useCallback(
    (list: FileList | File[] | null) => {
      if (!list) return;
      const files = Array.from(list);
      if (files.length === 0) return;

      const valid: File[] = [];
      for (const file of files) {
        if (!matchesAccept(file, accept)) {
          onError?.(`${file.name} is not a supported file type here.`);
          continue;
        }
        if (maxSize && file.size > maxSize) {
          onError?.(`${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(maxSize)}.`);
          continue;
        }
        if (file.size === 0) {
          onError?.(`${file.name} is empty.`);
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
    if (event.dataTransfer) event.dataTransfer.dropEffect = dragging ? 'copy' : 'none';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;
    intake(event.dataTransfer?.files ?? null);
  };

  // Keyboard-accessible: Ctrl/Cmd+V pastes files when the zone is the only target.
  useEffect(() => {
    if (disabled) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files;
      if (files && files.length > 0 && document.activeElement === document.body) {
        event.preventDefault();
        intake(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [disabled, intake]);

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
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-describedby={describedBy}
    >
      <input
        ref={inputRef}
        type="file"
        className="visually-hidden"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          intake(event.target.files);
          event.target.value = '';
        }}
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="filedrop__glyph" aria-hidden="true">
        <svg viewBox="0 0 48 48" className="filedrop__ring">
          <circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray="4 6" opacity="0.4" />
          <circle cx="24" cy="24" r="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="52 30" strokeLinecap="round" />
        </svg>
        <Icon name={icon} size={compact ? 16 : 18} className="filedrop__icon" />
      </div>

      <div className="filedrop__text">
        <strong>{dragging ? 'Release to load locally' : title}</strong>
        {hint ? <span className="filedrop__hint">{hint}</span> : null}
      </div>

      {!compact ? (
        <span className="filedrop__cta">
          <Icon name="file" size={14} />
          Choose file
        </span>
      ) : null}
    </div>
  );
}
