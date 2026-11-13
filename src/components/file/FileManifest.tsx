import { Icon } from '../ui/Icon';
import { formatBytes } from '../../lib/files/format';

export interface ManifestItem {
  id: string;
  file: File;
}

/**
 * Extra facts about an item that the manifest itself cannot know — a PDF's page
 * count, for instance, which costs a parse and is therefore supplied by the tool
 * once it has one.
 */
export type ManifestDetail = (item: ManifestItem) => string | undefined;

/** Ordered, reorderable file list used by multi-file tools. */
export function FileManifest({
  items,
  onMove,
  onRemove,
  emptyLabel = 'No files yet',
  detail,
}: {
  items: ManifestItem[];
  onMove?: (index: number, direction: -1 | 1) => void;
  onRemove?: (id: string) => void;
  emptyLabel?: string;
  detail?: ManifestDetail;
}) {
  if (items.length === 0) {
    return (
      <div className="preview-placeholder" style={{ minHeight: 140 }}>
        <Icon name="files" size={20} />
        <p>{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="manifest">
      <div className="manifest__head">
        <span>File</span>
        <span style={{ textAlign: 'right' }}>Size</span>
        <span style={{ textAlign: 'right' }}>Order</span>
      </div>
      {items.map((item, index) => (
        <div className="manifest__row" key={item.id}>
          <span className="manifest__name">
            <span className="mono manifest__index">
              {String(index + 1).padStart(2, '0')}
            </span>
            <Icon name={item.file.type === 'application/pdf' || item.file.name.endsWith('.pdf') ? 'pdf' : 'file'} size={14} />
            <span title={item.file.name}>{item.file.name}</span>
          </span>
          <span className="manifest__size">
            {formatBytes(item.file.size)}
            {detail?.(item) ? <em className="manifest__detail">{detail(item)}</em> : null}
          </span>
          <span className="manifest__actions">
            {onMove ? (
              <>
                <button
                  type="button"
                  className="btn btn--icon"
                  onClick={() => onMove(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${item.file.name} up`}
                >
                  <Icon name="chevron" size={13} style={{ transform: 'rotate(-90deg)' }} />
                </button>
                <button
                  type="button"
                  className="btn btn--icon"
                  onClick={() => onMove(index, 1)}
                  disabled={index === items.length - 1}
                  aria-label={`Move ${item.file.name} down`}
                >
                  <Icon name="chevron" size={13} style={{ transform: 'rotate(90deg)' }} />
                </button>
              </>
            ) : null}
            {onRemove ? (
              <button
                type="button"
                className="btn btn--icon"
                onClick={() => onRemove(item.id)}
                aria-label={`Remove ${item.file.name}`}
              >
                <Icon name="x" size={13} />
              </button>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
