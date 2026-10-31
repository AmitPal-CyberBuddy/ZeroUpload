/**
 * The batch queue UI.
 *
 * Presentation only: every piece of state here comes from `useImageBatch`, which
 * wraps the framework-free `BatchQueue`. The panel never decides that something
 * finished — it renders what the queue says, which is why it can be honest about
 * "cancelling" mid-item and about files that were never started.
 */
import { useState } from 'react';
import { Icon } from '../ui/Icon';
import { Notice } from '../ui/controls';
import { Progress } from '../ui/Progress';
import { FileDrop } from '../file/FileDrop';
import { formatBytes } from '../../lib/files/format';
import type { BatchItem } from '../../lib/batch/types';
import type { ImageBatch } from '../../hooks/useImageBatch';

function stateDetail(item: BatchItem): string {
  if (item.state === 'processing') return `${Math.round((item.progress ?? 0) * 100)}%`;
  if (item.state === 'failed') return 'Stopped — see the reason below';
  if (item.state === 'cancelled') return 'Stopped before finishing';
  if (item.state === 'pending') return 'Not started';
  if (item.state === 'released') return 'Removed from memory';
  return 'Complete';
}

function StatusSummary({ batch }: { batch: ImageBatch }) {
  const { summary } = batch;
  const parts: string[] = [];
  if (summary.completed) parts.push(`${summary.completed} completed`);
  if (summary.failed) parts.push(`${summary.failed} failed`);
  if (summary.cancelled) parts.push(`${summary.cancelled} cancelled`);
  if (summary.pending) parts.push(`${summary.pending} not started`);
  if (summary.released) parts.push(`${summary.released} cleared`);

  return (
    <p className="batch__status" role="status" aria-live="polite">
      {summary.settled} / {summary.total} files · {Math.round(summary.progress * 100)}%
      {parts.length ? ` · ${parts.join(' · ')}` : ''}
    </p>
  );
}

function ItemRow({ item, batch }: { item: BatchItem; batch: ImageBatch }) {
  const running = batch.status === 'running' || batch.status === 'cancelling';
  return (
    <li className="batch__item" data-state={item.state}>
      <span className="batch__dot" aria-hidden="true" />
      <div className="batch__item-main">
        <span className="batch__item-name" title={item.name}>
          {item.name}
        </span>
        <span className="batch__item-meta">
          {formatBytes(item.size)}
          {item.result ? ` → ${formatBytes(item.result.bytes)}` : ''}
          {item.state === 'released' ? ' · removed from memory' : ''}
        </span>

        {item.state === 'processing' ? (
          <Progress value={item.progress ?? 0} label={`Progress for ${item.name}`} />
        ) : null}

        {item.error ? (
          <span className="batch__item-error">
            {item.error.message}
            {item.error.hint ? <span className="batch__item-hint"> {item.error.hint}</span> : null}
          </span>
        ) : null}
      </div>

      <span className="batch__item-state">{stateDetail(item)}</span>

      <span className="batch__item-actions">
        {item.state === 'completed' ? (
          <>
            <button
              type="button"
              className="btn btn--icon"
              onClick={() => batch.downloadOne(item.id)}
              aria-label={`Download ${item.result?.name ?? item.name}`}
              title="Download"
            >
              <Icon name="download" size={13} />
            </button>
            <button
              type="button"
              className="btn btn--icon"
              onClick={() => batch.release(item.id)}
              aria-label={`Remove ${item.name} from memory`}
              title="Remove from memory"
            >
              <Icon name="x" size={13} />
            </button>
          </>
        ) : null}

        {item.state === 'failed' || item.state === 'cancelled' ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => batch.retryItem(item.id)}
            disabled={running}
          >
            <Icon name="refresh" size={12} /> Try again
          </button>
        ) : null}

        {item.state === 'pending' && !running ? (
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => batch.remove(item.id)}
            aria-label={`Remove ${item.name}`}
            title="Remove"
          >
            <Icon name="x" size={13} />
          </button>
        ) : null}
      </span>
    </li>
  );
}

export function BatchPanel({ batch }: { batch: ImageBatch }) {
  const { summary, status, items } = batch;
  const [dropError, setDropError] = useState<string | null>(null);
  const current = items.find((item) => item.state === 'processing');
  const running = status === 'running';
  const cancelling = status === 'cancelling';
  const retryable = summary.failed + summary.cancelled;
  const atOutputBudget = summary.retainedBytes >= batch.outputLimit;

  const statusLabel =
    status === 'running'
      ? 'Processing'
      : status === 'cancelling'
        ? 'Cancelling'
        : status === 'paused'
          ? 'Paused'
          : status === 'finished'
            ? 'Finished'
            : 'Ready';

  return (
    <section className="batch" aria-label="Batch queue">
      <div className="batch__head">
        <div className="batch__heading">
          <span className="section-title">Batch</span>
          <StatusSummary batch={batch} />
        </div>
        <span className="badge" data-status={status}>
          {statusLabel}
        </span>
      </div>

      <Progress value={summary.progress} label="Overall batch progress" />

      {current ? (
        <div className="batch__current">
          <span className="batch__current-name" title={current.name}>
            {current.name}
          </span>
          <Progress value={current.progress ?? 0} label={`Current file progress: ${current.name}`} />
        </div>
      ) : null}

      {cancelling ? (
        <Notice tone="warn" title="Cancel requested">
          Finishing the current image, then stopping. Files already completed are kept.
        </Notice>
      ) : null}

      {status === 'paused' ? (
        <Notice tone="warn" title="Output budget reached">
          {formatBytes(summary.retainedBytes)} of results are held in memory. Download or release some, then
          continue — {summary.pending} {summary.pending === 1 ? 'file is' : 'files are'} still waiting.
        </Notice>
      ) : null}

      {batch.error ? (
        <Notice tone="danger" title="Could not complete that action">
          {batch.error.message}
          {batch.error.hint ? <div className="hint">{batch.error.hint}</div> : null}
        </Notice>
      ) : null}

      <ul className="batch__list">
        {items.map((item) => (
          <ItemRow key={item.id} item={item} batch={batch} />
        ))}
      </ul>

      <div className="batch__actions">
        {running || cancelling ? (
          <button type="button" className="btn btn--secondary btn--sm" onClick={batch.cancel} disabled={cancelling}>
            <Icon name="x" size={13} />
            {cancelling ? 'Stopping…' : 'Cancel'}
          </button>
        ) : null}

        {status === 'paused' ? (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void batch.resume()}
            disabled={atOutputBudget}
          >
            <Icon name="arrow-right" size={13} /> Continue
          </button>
        ) : null}

        {retryable > 0 ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => batch.retryFailed()}
            disabled={running || cancelling}
          >
            <Icon name="refresh" size={13} /> Try {retryable} again
          </button>
        ) : null}

        {summary.completed > 0 ? (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void batch.downloadAll()}
            disabled={batch.packaging}
          >
            <Icon name="zip" size={13} />
            {batch.packaging
              ? `Packaging… ${Math.round(batch.packagingRatio * 100)}%`
              : `Download ${summary.completed} as ZIP`}
          </button>
        ) : null}

        {batch.packaging ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={batch.cancelPackaging}>
            <Icon name="x" size={13} /> Cancel packaging
          </button>
        ) : null}

        {summary.completed > 0 ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => batch.releaseAll()}>
            Remove {summary.completed} from memory
          </button>
        ) : null}

        {!running && !cancelling && summary.settled > 0 ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => batch.clear()}>
            Clear batch
          </button>
        ) : null}
      </div>

      {dropError ? <Notice tone="warn">{dropError}</Notice> : null}

      <p className="batch__note">
        Files stay on your device and are processed one at a time. Results are held only until you download
        or remove them — {formatBytes(summary.retainedBytes)} held now. Downloading everything as one ZIP adds
        no extra copies.
      </p>

      {!running && !cancelling && status !== 'paused' ? (
        <FileDrop
          accept="image/*"
          multiple
          compact
          onFiles={(files) => {
            setDropError(null);
            batch.addFiles(files);
          }}
          onError={(message) => setDropError(message)}
          title="Add more images"
          hint="New files are added to the end of the queue."
          icon="plus"
        />
      ) : null}
    </section>
  );
}
