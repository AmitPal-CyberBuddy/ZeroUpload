import { Link } from 'react-router-dom';
import { Icon } from '../components/ui/Icon';
import { ToolCard } from '../components/tool/ToolCard';
import { usePageMeta } from '../hooks/usePageMeta';
import { HUB_META } from '../seo/pages';
import { FORMATS, FAMILIES } from '../lib/capabilities/formats';
import { CAPABILITIES, CAPABILITY_TABLE } from '../lib/capabilities/table';
import { getTool } from '../registry/tools';
import type { CapabilityHub } from '../registry/groups';

/**
 * A capability page: one job, every format it covers, and the tools that do it.
 *
 * This is the answer to "Unlock PDF and Unlock Office are the same job". They are
 * still two tools — they decrypt different container formats with entirely
 * different code — but they are one *capability*, and this page is where that is
 * visible. The tools keep their own URLs so search traffic and existing links
 * still land on a page about exactly what the visitor searched for.
 *
 * The format matrix is generated from `lib/capabilities/table.ts`, so a format
 * listed here is one some tool actually accepts. It cannot drift from the code
 * without the registry test failing.
 */
export function CapabilityPage({ hub }: { hub: CapabilityHub }) {
  usePageMeta(
    HUB_META[hub.id] ?? { title: `${hub.name} · ZeroUpload`, description: hub.blurb },
    `/tools/${hub.id}/`,
  );

  const capability = CAPABILITIES[hub.capability];
  const tools = hub.tools
    .map((slug) => getTool(slug))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));

  // Which families this capability reaches, and through which tool, so the table
  // shows the *reason* a format is in scope rather than a bare list.
  const coverage = Object.entries(CAPABILITY_TABLE).flatMap(([family, edges]) =>
    edges
      .filter((edge) => edge.capability === hub.capability && hub.tools.includes(edge.tool))
      .map((edge) => ({
        family: FAMILIES[family as keyof typeof FAMILIES],
        toolSlug: edge.tool,
        toolName: getTool(edge.tool)?.name ?? edge.tool,
        accepts: edge.accepts,
        produces: edge.produces,
        available: edge.available !== false,
        note: edge.note,
      })),
  );

  return (
    <main id="main" className="page">
      <header className="catalog-head">
        <span className="eyebrow">
          <Link to="/tools/">Tools</Link> / Capability
        </span>
        <h1>{hub.heading}</h1>
        <p>{hub.blurb}</p>
      </header>

      <section className="capability-formats" aria-labelledby="formats-covered">
        <h2 id="formats-covered" className="workspace-report__h2">
          Formats covered
        </h2>
        <div className="capability-formats__row">
          {hub.formats.map((format) => (
            <span key={format} className="badge">
              {FORMATS[format]?.label ?? format.toUpperCase()}
            </span>
          ))}
        </div>
      </section>

      <section aria-labelledby="which-file">
        <h2 id="which-file" className="workspace-report__h2">
          Which file do you have?
        </h2>
        <div className="capability-table">
          {coverage.map((row) => (
            <div className="capability-table__row" key={`${row.family.id}-${row.toolSlug}`}>
              <span className="capability-table__family">{row.family.label}</span>
              <span className="capability-table__tool">
                {row.available ? (
                  <Link to={`/tools/${row.toolSlug}/`}>
                    {row.toolName} <Icon name="arrow-right" size={11} />
                  </Link>
                ) : (
                  <span className="hint">
                    {row.toolName} — not offered{row.note ? `: ${row.note}` : ''}
                  </span>
                )}
              </span>
              {row.accepts?.length ? (
                <span className="capability-table__io">
                  <span className="capability-table__in">
                    reads {row.accepts.map((format) => FORMATS[format]?.label ?? format.toUpperCase()).join(' · ')}
                  </span>
                  {row.produces?.length ? (
                    <span className="capability-table__out">
                      writes {row.produces.map((format) => FORMATS[format]?.label ?? format.toUpperCase()).join(' · ')}
                    </span>
                  ) : null}
                </span>
              ) : row.produces?.length ? (
                <span className="capability-table__out">
                  writes {row.produces.map((format) => FORMATS[format]?.label ?? format.toUpperCase()).join(' · ')}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {hub.caveat ? <p className="capability-caveat">{hub.caveat}</p> : null}

      <section aria-labelledby="the-tools">
        <h2 id="the-tools" className="workspace-report__h2">
          The tools
        </h2>
        <div className="tool-grid">
          {tools.map((tool) => (
            <ToolCard
              key={tool.slug}
              to={`/tools/${tool.slug}/`}
              name={tool.name}
              blurb={tool.blurb}
              icon={tool.icon}
              tags={tool.tags}
              showLocal
            />
          ))}
        </div>
      </section>

      <section className="page-footnote">
        <h2>Not sure which one?</h2>
        <p>
          Drop the file on the <Link to="/tools/workspace/">workspace</Link> instead. It reads the file’s
          first bytes, works out what it is, and offers only the {capability.name.toLowerCase()} actions that
          apply.
        </p>
      </section>
    </main>
  );
}
