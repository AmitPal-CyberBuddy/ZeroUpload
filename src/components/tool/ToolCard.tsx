import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../ui/Icon';

/**
 * The one card used to open a tool.
 *
 * Before this existed the catalogue, the group pages, "Related tools" and the
 * homepage featured strip each rendered their own variant — three visual
 * languages for the same action, with three different hover behaviours. The
 * footer row is optional metadata (tags, the "Local" badge); everything above it
 * is identical wherever the card appears.
 */
export function ToolCard({
  to,
  name,
  blurb,
  icon,
  tags,
  showLocal = false,
}: {
  to: string;
  name: string;
  blurb: string;
  icon: IconName;
  tags?: string[];
  showLocal?: boolean;
}) {
  const shownTags = tags?.slice(0, 2) ?? [];
  const hasFoot = shownTags.length > 0 || showLocal;

  return (
    <Link to={to} className="tool-card">
      <div className="tool-card__top">
        <span className="tool-card__icon">
          <Icon name={icon} size={16} />
        </span>
        <h3>{name}</h3>
      </div>
      <p>{blurb}</p>
      {hasFoot ? (
        <div className="tool-card__foot">
          <span className="tool-card__tags">
            {shownTags.map((tag) => (
              <span key={tag} className="badge">
                {tag}
              </span>
            ))}
          </span>
          {showLocal ? (
            <span className="badge badge--accent">
              <i className="dot" aria-hidden="true" />
              Local
            </span>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
