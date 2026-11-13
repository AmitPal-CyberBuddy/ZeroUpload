import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import { ToolCard } from './ToolCard';
import { ZeroMark } from '../brand/ZeroMark';
import { relatedToolEntries, relatedTools, type ToolDefinition } from '../../registry/tools';
import { CATEGORY_MAP } from '../../registry/categories';
import { TOOL_CONTENT } from '../../seo/toolContent';
import { usePageMeta } from '../../hooks/usePageMeta';
import { useRecordToolVisit } from '../../hooks/useRecordToolVisit';
import { TOOL_META } from '../../seo/pages';
import { toolPath } from '../../seo/site';
import { hubForTool } from '../../registry/groups';
import { toolFormatRows } from '../../lib/capabilities/table';

const STATUS_LABEL: Record<ToolDefinition['status'], string> = {
  stable: 'Ready',
  beta: 'Beta',
  soon: 'Planned',
};

export function ToolLayout({
  tool,
  children,
  aside,
}: {
  tool: ToolDefinition;
  children: ReactNode;
  aside?: ReactNode;
}) {
  usePageMeta(
    TOOL_META[tool.slug] ?? { title: `${tool.name} · ZeroUpload`, description: tool.blurb },
    toolPath(tool.slug),
  );
  // Available tools only: a visit to a "planned" page is not a tool you used.
  useRecordToolVisit(tool.slug, tool.status !== 'soon');
  const relatedEntries = relatedToolEntries(tool, 3);
  const related = relatedTools(tool, 3);
  const category = CATEGORY_MAP[tool.category];
  const content = TOOL_CONTENT[tool.slug];
  const hub = hubForTool(tool.slug);

  /*
   * The formats this tool reads and writes, derived from the capability table
   * rather than restated in prose, so the header cannot claim a format the tool
   * does not accept. `toolFormatRows` owns the de-duplication; see its comment
   * for why the raw edges are not enough.
   */
  const formatsHere = toolFormatRows(tool.slug);

  return (
    <main id="main" className="page page--tool">
      <header className="tool-head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/">ZeroUpload</Link>
          <span aria-hidden="true">/</span>
          <Link to="/tools/">Tools</Link>
          <span aria-hidden="true">/</span>
          <Link to={`/tools/${category.id}/`}>{category.name}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{tool.shortName ?? tool.name}</span>
        </nav>

        <div className="tool-head__top">
          <span className="tool-head__icon" aria-hidden="true">
            <Icon name={tool.icon as IconName} size={19} />
          </span>
          <h1>{tool.name}</h1>
          <span className={`badge ${tool.status === 'stable' ? 'badge--accent' : ''}`}>
            <i className="dot" aria-hidden="true" />
            {STATUS_LABEL[tool.status]}
          </span>
        </div>

        <p>{tool.description}</p>

        <div className="row row--wrap" style={{ gap: 'var(--s-2)' }}>
          <span className="badge">
            <ZeroMark size={11} /> Processed locally
          </span>
          {tool.tags?.map((tag) => (
            <span key={tag} className="badge">
              {tag}
            </span>
          ))}
          {hub ? (
            <Link to={`/tools/${hub.id}/`} className="badge badge--accent">
              <Icon name="layers" size={11} /> {hub.name}
            </Link>
          ) : null}
        </div>

        {formatsHere.length > 0 ? (
          <dl className="tool-formats">
            {formatsHere.map((entry) => (
              <div key={entry.capability} className="tool-formats__row">
                <dt>{entry.capability}</dt>
                <dd>
                  {entry.from?.length ? (
                    <span className="tool-formats__in">
                      {entry.from.map((format) => (
                        <span key={format} className="badge">
                          {format}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {entry.to?.length ? (
                    <>
                      {entry.from?.length ? <Icon name="arrow-right" size={12} /> : null}
                      <span className="tool-formats__out">
                        {entry.to.map((format) => (
                          <span key={format} className="badge badge--accent">
                            {format}
                          </span>
                        ))}
                      </span>
                    </>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </header>

      <div className={aside ? 'workspace' : undefined}>
        <div className="workspace__main">{children}</div>
        {aside ? <aside className="workspace__side">{aside}</aside> : null}
      </div>

      {content ? (
        <section className="tool-notes" aria-labelledby="what-this-tool-does">
          {/*
           * The notes run to three headings and a few hundred words. The anchors
           * exist so a link can point at the limits or the questions directly —
           * from a reply, a bug report, or a search result's jump links — rather
           * than at the top of a tool page that opens on a file picker.
           */}
          <nav className="tool-notes__nav" aria-label="On this page">
            <a href="#what-this-tool-does">What it does</a>
            <a href="#what-it-will-not-do">What it will not do</a>
            <a href="#common-questions">Common questions</a>
          </nav>

          <h2 id="what-this-tool-does">What this tool does</h2>
          <p>{content.summary}</p>
          <ul>
            {content.does.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <h2 id="what-it-will-not-do">What it will not do</h2>
          <ul>
            {content.limits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <h2 id="common-questions">Common questions</h2>
          <div className="tool-notes__faq">
            {content.faq.map((entry) => (
              <div key={entry.q} className="tool-notes__qa">
                <h3>{entry.q}</h3>
                <p>{entry.a}</p>
              </div>
            ))}
          </div>

          <p className="tool-notes__foot">
            Nothing here is sent to a server. If you want to see how that works,{' '}
            <Link to="/how-it-works/">how ZeroUpload processes files</Link> explains the whole path.
          </p>
        </section>
      ) : null}

      <section className="related" aria-labelledby="related-title">
        <div className="catalog-group__head">
          <Icon name="grid" size={14} style={{ color: 'var(--accent)' }} />
          <h2 id="related-title">Related tools</h2>
          <hr />
          <Link to="/tools/" className="link-inline">
            All tools <Icon name="arrow-right" size={12} />
          </Link>
        </div>
        {/*
          * The reason sits above the card rather than inside it. Inside was tried
          * and read as part of the blurb, which made a generic blurb look like a
          * specific justification. Above, it belongs to this page's recommendation.
          */}
        <ol className="related-grid">
          {related.map((item, index) => {
            const entry = relatedEntries[index];
            return (
              <li key={item.slug} className="related-item">
                <p className="related-item__why">{entry?.why ?? item.blurb}</p>
                <ToolCard
                  to={`/tools/${item.slug}/`}
                  name={item.name}
                  blurb={item.blurb}
                  icon={item.icon}
                />
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}

/** Standard settings sidebar shell. */
export function Settings({
  title = 'Settings',
  children,
  footer,
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="settings">
      <div className="settings__head">
        <Icon name="sliders" size={13} />
        {title}
      </div>
      <div className="settings__body">{children}</div>
      {footer ? (
        <>
          <div className="settings__foot">{footer}</div>
          {/*
           * Below 980px the sidebar is stacked after the preview, so the primary
           * action can end up two screens away from the file card it acts on.
           * This second copy is the same node rendered into a docked bar; CSS
           * shows exactly one of the two at any width and the hidden one is
           * `display: none`, so it never reaches the accessibility tree twice.
           */}
          <div className="settings__foot settings__foot--docked">{footer}</div>
        </>
      ) : null}
    </div>
  );
}
