import { useObjectUrl } from '../../hooks/useObjectUrl';
import { Icon } from '../ui/Icon';
import { humanFileType } from '../../lib/files/mime';
import { formatBytes, middleTruncate } from '../../lib/files/format';

export function FileCard({
  file,
  onRemove,
  onReplace,
  subtitle,
  showThumb = true,
}: {
  file: File;
  onRemove?: () => void;
  onReplace?: () => void;
  subtitle?: string;
  showThumb?: boolean;
}) {
  const isImage = file.type.startsWith('image/');
  const url = useObjectUrl(showThumb && isImage ? file : null);

  return (
    <div className="filecard">
      <div className={`filecard__thumb ${url ? '' : 'filecard__thumb--glyph'}`}>
        {url ? <img src={url} alt="" /> : <Icon name={file.type === 'application/pdf' ? 'pdf' : 'file'} size={20} />}
      </div>
      <div className="filecard__meta">
        <span className="filecard__name" title={file.name}>
          {middleTruncate(file.name, 48)}
        </span>
        <span className="filecard__sub">
          <span>{formatBytes(file.size)}</span>
          <span className="sep">/</span>
          <span>{file.type || humanFileType(file.type) || 'unknown type'}</span>
          {subtitle ? (
            <>
              <span className="sep">/</span>
              <span>{subtitle}</span>
            </>
          ) : null}
        </span>
      </div>
      <div className="filecard__actions">
        {onReplace ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onReplace}>
            Replace
          </button>
        ) : null}
        {onRemove ? (
          <button type="button" className="btn btn--icon" onClick={onRemove} aria-label={`Remove ${file.name}`}>
            <Icon name="x" size={15} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
