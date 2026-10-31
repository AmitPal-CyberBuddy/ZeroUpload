import { Link } from 'react-router-dom';
import { Icon } from '../components/ui/Icon';
import { usePageMeta } from '../hooks/usePageMeta';
import { CATEGORIES, type Category } from '../registry/categories';
import { getTool, TOOLS_BY_CATEGORY } from '../registry/tools';
import { CATEGORY_META, PAGE_META } from '../seo/pages';

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
        </div>
        <div className="tool-grid">
          {tools.map((tool) => (
            <Link key={tool.slug} to={`/tools/${tool.slug}/`} className="tool-card">
              <div className="tool-card__top">
                <span className="tool-card__icon">
                  <Icon name={tool.icon} size={16} />
                </span>
                <h3>{tool.name}</h3>
              </div>
              <p>{tool.blurb}</p>
            </Link>
          ))}
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
          open one and the file picker is the only thing that happens to your file.
        </p>
      </section>

      <nav className="related" aria-labelledby="other-groups">
        <div className="catalog-group__head">
          <Icon name="grid" size={14} style={{ color: 'var(--accent)' }} />
          <h2 id="other-groups">Other groups</h2>
          <hr />
          <Link to="/tools/" className="link-inline">
            All tools <Icon name="arrow-right" size={12} />
          </Link>
        </div>
        <div className="tool-grid">
          {others.map((other) => (
            <Link key={other.id} to={`/tools/${other.id}/`} className="tool-card">
              <div className="tool-card__top">
                <span className="tool-card__icon">
                  <Icon name={other.icon} size={16} />
                </span>
                <h3>{other.name}</h3>
              </div>
              <p>{other.description}</p>
            </Link>
          ))}
        </div>
      </nav>
    </main>
  );
}
