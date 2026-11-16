import { Link } from 'react-router-dom';
import { Icon } from '../components/ui/Icon';
import { ToolCard } from '../components/tool/ToolCard';
import { usePageMeta } from '../hooks/usePageMeta';
import { CATEGORIES, type Category } from '../registry/categories';
import { getTool, TOOLS_BY_CATEGORY } from '../registry/tools';
import { CATEGORY_META, PAGE_META } from '../seo/pages';
import { gridColumnsClass } from '../lib/grid';
import { jobHref, jobsForCategory } from '../registry/jobs';
import { hubForTool } from '../registry/groups';

/**
 * A category landing page.
 *
 * It exists for the person who searches "crop an image without uploading it" and
 * does not yet know which of six image tools they want: a heading that says what
 * the group is for, the tools themselves, and a plain "I need… → tool" list.
 */
export function CategoryPage({ category }: { category: Category }) {
  const path = `/tools/${category.id}/`;
  usePageMeta(CATEGORY_META[category.id] ?? PAGE_META['/tools/'], path);
  const tools = TOOLS_BY_CATEGORY[category.id] ?? [];
  const others = CATEGORIES.filter((item) => item.id !== category.id);
  /*
   * The jobs these tools belong to. This page is organised by file type, which is
   * only half the catalogue now — so it names the other half instead of pretending
   * it is the only way in.
   */
  const jobs = jobsForCategory(tools.map((tool) => tool.slug));

  return (
    <main id="main" className="page">
      <header className="catalog-head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/">ZeroUpload</Link>
          <span aria-hidden="true">/</span>
          <Link to="/tools/">Tools</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{category.name}</span>
        </nav>

        <h1>{category.heading}</h1>
        <p>{category.intro}</p>
      </header>

      <section aria-labelledby="cat-tools">
        <div className="catalog-group__head">
          <Icon name={category.icon} size={14} style={{ color: 'var(--accent)' }} />
          <h2 id="cat-tools">{`${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}`}</h2>
          <hr />
          <Link to="/tools/" className="link-inline">
            All jobs <Icon name="arrow-right" size={11} />
          </Link>
        </div>
        <div className={`tool-grid ${gridColumnsClass(tools.length)}`}>
          {tools.map((tool) => {
            /*
             * The job rides on the card as the first tag. On a file-type page it
             * is the *other* grouping that is missing, so this is the one place
             * where naming the job is the more useful label — and for a tool in a
             * hub it links to the page that explains the whole job.
             */
            const hub = hubForTool(tool.slug);
            const tags = [jobs.find((job) => job.tools.includes(tool.slug))?.name, ...(tool.tags ?? [])].filter(
              (tag): tag is string => Boolean(tag),
            );
            return (
              <ToolCard
                key={tool.slug}
                to={`/tools/${tool.slug}/`}
                name={tool.name}
                blurb={tool.blurb}
                icon={tool.icon}
                tags={tags}
                showLocal={Boolean(hub)}
              />
            );
          })}
        </div>
      </section>

      <section className="tool-notes" aria-labelledby="cat-guide">
        <h2 id="cat-guide">Which one do I need?</h2>
        <dl className="guide-list">
          {category.guide.map((entry) => {
            const tool = getTool(entry.slug);
            if (!tool) return null;
            return (
              <div key={`${entry.need}-${entry.slug}`} className="guide-list__row">
                <dt>{entry.need}</dt>
                <dd>
                  <Link to={`/tools/${tool.slug}/`}>{tool.name}</Link>
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="tool-notes__foot">
          Every tool in this group runs on your device. There is no upload step, no account and no queue —
          choose a file and process it locally when you are ready.
        </p>
      </section>

      <section className="tool-notes" aria-labelledby="jobs-here">
        <h2 id="jobs-here">The jobs these tools do</h2>
        <p>
          This page is organised by file type. The same tools also sit under the job they perform, alongside
          equivalents for other formats:
        </p>
        <div className="jobs-cross">
          {jobs.map((job) => (
            <Link key={job.id} to={jobHref(job)} className="jobs-cross__link">
              <Icon name={job.icon} size={15} />
              <span>
                <strong>{job.name}</strong>
                <span>{job.verb}</span>
              </span>
              <Icon name="arrow-right" size={12} />
            </Link>
          ))}
        </div>
      </section>

      <nav className="related" aria-labelledby="other-groups">
        <div className="catalog-group__head">
          {/* `grid` means "a set of tools" everywhere else; groups get `layers`. */}
          <Icon name="layers" size={14} style={{ color: 'var(--accent)' }} />
          <h2 id="other-groups">Other groups</h2>
          <hr />
          <Link to="/tools/" className="link-inline">
            All tools <Icon name="arrow-right" size={12} />
          </Link>
        </div>
        <div className={`tool-grid ${gridColumnsClass(others.length)}`}>
          {others.map((other) => (
            <ToolCard
              key={other.id}
              to={`/tools/${other.id}/`}
              name={other.name}
              blurb={other.description}
              icon={other.icon}
            />
          ))}
        </div>
      </nav>
    </main>
  );
}
