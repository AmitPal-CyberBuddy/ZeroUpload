import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../ui/Icon';
import { preloadTool, toolSlugFromPath } from '../../registry/toolComponents';

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
  const slug = toolSlugFromPath(to);

  /*
   * Warming the chunk on intent, not on click.
   *
   * Every tool is a lazy route, so a click used to mean: request the chunk, wait,
   * and watch "Opening workspace…". A pointer that has come to rest on a card is
   * the strongest available signal of the next click, and it usually arrives a few
   * hundred milliseconds early. `preloadTool` reads the slug out of the link, so
   * the card keeps its single `to` prop and nothing here can drift from the route.
   */
  const warm = () => {
    if (slug) preloadTool(slug);
  };

  return (
    <Link
      to={to}
      className="tool-card"
      onPointerEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
    >
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
