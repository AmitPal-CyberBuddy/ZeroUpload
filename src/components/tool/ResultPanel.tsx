import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { CompareSizes } from './CompareSizes';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { triggerDownload } from '../../lib/files/download';

export function ResultPanel({
  title,
  badge,
  preview,
  originalBytes,
  outputBlob,
  filename,
  onRerun,
  onReset,
  showPreview = true,
  downloadLabel,
  note,
}: {
  title: string;
  badge?: ReactNode;
  preview?: Blob;
  originalBytes?: number;
  outputBlob: Blob;
  filename: string;
  onRerun?: () => void;
  onReset?: () => void;
  showPreview?: boolean;
  downloadLabel?: string;
  note?: ReactNode;
}) {
  const url = useObjectUrl(showPreview && preview ? preview : null);

  return (
    <div className="result">
      <div className="result__head" role="status" aria-live="polite">
        <span className="result__title">
          <i className="dot" aria-hidden="true" />
          {title}
        </span>
        {badge}
      </div>

      {originalBytes !== undefined ? (
        <CompareSizes original={originalBytes} output={outputBlob.size} />
      ) : (
        <div className="compare" style={{ gridTemplateColumns: '1fr' }}>
          <div className="compare__side">
            <span className="compare__label">Output size</span>
            <span className="compare__value">{(outputBlob.size / 1024).toFixed(1)} KB</span>
          </div>
        </div>
      )}

      {note}

      {url ? (
        <div className="result__preview">
          <img src={url} alt="Result preview" />
        </div>
      ) : null}

      <div className="result__actions">
        <button type="button" className="btn btn--primary" onClick={() => triggerDownload(outputBlob, filename)}>
          <Icon name="download" size={15} />
          {downloadLabel ?? 'Download'}
        </button>
        {onRerun ? (
          <button type="button" className="btn btn--secondary" onClick={onRerun}>
            <Icon name="refresh" size={14} /> Re-run
          </button>
        ) : null}
        {onReset ? (
          <button type="button" className="btn btn--ghost" onClick={onReset}>
            Process another
          </button>
        ) : null}
      </div>
    </div>
  );
}
