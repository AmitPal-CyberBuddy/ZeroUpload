import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ZeroMark, ZeroWordmark } from '../components/brand/ZeroMark';
import { FileDrop } from '../components/file/FileDrop';
import { Icon, type IconName } from '../components/ui/Icon';
import { ToolCard } from '../components/tool/ToolCard';
import { CATEGORIES } from '../registry/categories';
import { TOOLS, TOOLS_BY_CATEGORY } from '../registry/tools';
import { setHandoff } from '../lib/files/handoff';
import { usePageMeta } from '../hooks/usePageMeta';
import { PAGE_META } from '../seo/pages';
import { formatBytes, middleTruncate } from '../lib/files/format';

const FEATURED = ['image-compressor', 'image-converter', 'merge-pdf', 'file-inspector'];

const FORMAT_LINE = ['JPEG', 'PNG', 'WebP', 'AVIF', 'PDF', 'ZIP', 'JSON'];

export function HomePage() {
  usePageMeta(PAGE_META['/'], '/');
  const navigate = useNavigate();
  const [incoming, setIncoming] = useState<File | null>(null);
  const handoffTimer = useRef<number | null>(null);

  // A pending navigation must not fire after the user has moved on.
  useEffect(
    () => () => {
      if (handoffTimer.current !== null) window.clearTimeout(handoffTimer.current);
    },
    [],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setIncoming(file);
      if (handoffTimer.current !== null) window.clearTimeout(handoffTimer.current);
      handoffTimer.current = window.setTimeout(() => {
        setHandoff([file]);
        navigate('/tools/file-inspector/');
      }, 420);
    },
    [navigate],
  );

  return (
    <main id="main">
      {/* ---------------------------------------------------------------- Hero */}
      <section className="hero">
        <div className="page hero__inner">
          <div className="hero__ambient" aria-hidden="true">
            <ZeroMark size={620} className="hero__zero" />
          </div>

          <div className="hero__copy">
            {/* The wordmark is a lockup now, not the headline: the headline's job
                is to say what this is, and the brand is already in the header. */}
            <span className="hero__lockup">
              <ZeroMark size={20} />
              <ZeroWordmark size={1.4} />
            </span>

            <h1 className="hero-title">
              Every file tool you need.
              <br />
              Nothing leaves your browser.
            </h1>

            <p className="hero__caps">
              Convert <span aria-hidden="true">·</span> Compress <span aria-hidden="true">·</span> Protect{' '}
              <span aria-hidden="true">·</span> Unlock <span aria-hidden="true">·</span> Inspect
            </p>

            <p className="hero__lede">
              Drop a file into the workspace and the work happens on your own device. No account, no
              install, and no upload step — because there is nowhere for a file to go.
            </p>
          </div>

          {/* ------------------------------------------------------ Intake zone */}
          <div className="hero__intake">
            <div className="intake">
              <div className="intake__head">
                <span className="label">Local workspace</span>
                <span className="badge badge--accent">
                  <i className="dot" aria-hidden="true" />
                  Ready
                </span>
              </div>

              {incoming ? (
                <div className="intake__processing" role="status">
                  <ZeroMark size={54} active />
                  <div>
                    <strong>Reading locally</strong>
                    <span className="mono">
                      {middleTruncate(incoming.name, 30)} · {formatBytes(incoming.size)}
                    </span>
                  </div>
                  <div className="progress progress--indeterminate" style={{ width: '100%' }}>
                    <div className="progress__bar" />
                  </div>
                  <span className="hint">Nothing is uploaded. Opening the file inspector…</span>
                </div>
              ) : (
                <FileDrop
                  onFiles={handleFiles}
                  title="Drop a file into your local workspace"
                  hint="Images, PDFs, archives or text."
                  icon="arrow-down"
                />
              )}

              <div className="intake__formats">
                <span className="label">Supported</span>
                <div className="intake__format-list">
                  {FORMAT_LINE.map((format) => (
                    <span key={format} className="format-chip mono">
                      {format}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* One privacy claim above the fold is enough. The H1 and the lede
                already make it; repeating it here made three. */}
            <div className="intake__foot">
              <Link to="/how-it-works/" className="link-inline">
                How it works <Icon name="arrow-right" size={13} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- Categories */}
      <section className="page section" aria-labelledby="categories-title">
        <div className="section-head">
          <div>
            <span className="eyebrow">Catalogue</span>
            <h2 id="categories-title">Grouped by the job you have.</h2>
          </div>
          <Link to="/tools/" className="btn btn--secondary btn--sm">
            Browse all tools <Icon name="arrow-right" size={14} />
          </Link>
        </div>

        <div className="category-grid" data-stagger>
          {CATEGORIES.map((category, index) => {
            const tools = TOOLS_BY_CATEGORY[category.id] ?? [];
            return (
              <Link
                key={category.id}
                to={`/tools/${category.id}/`}
                className="category-card"
                style={{ ['--i' as string]: index }}
              >
                <div className="category-card__top">
                  <span className="category-card__icon">
                    <Icon name={category.icon} size={17} />
                  </span>
                  <span className="mono category-card__count">{tools.length}</span>
                </div>
                <h3>{category.name}</h3>
                <p>{category.description}</p>
                <span className="category-card__verb">
                  {category.verb}
                  <Icon name="arrow-right" size={13} />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ----------------------------------------------------------- Featured */}
      <section className="page section" aria-labelledby="featured-title">
        <div className="section-head">
          <div>
            <h2 id="featured-title">Start here</h2>
            <p className="section-head__note">The four tools most people open first.</p>
          </div>
        </div>

        <div className="tool-grid">
          {FEATURED.map((slug) => {
            const tool = TOOLS.find((item) => item.slug === slug);
            if (!tool) return null;
            return (
              <ToolCard
                key={slug}
                to={`/tools/${slug}/`}
                name={tool.name}
                blurb={tool.blurb}
                icon={tool.icon as IconName}
              />
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------ Explain */}
      <section className="page section" aria-labelledby="how-title">
        <div className="explain">
          <div className="explain__copy">
            <span className="eyebrow">The local boundary</span>
            <h2 id="how-title">Your file enters. Nothing leaves.</h2>
            <p>
              ZeroUpload runs inside your browser. There is no server to send a file to, and no account
              that could keep a copy — so the work happens where the file already is, and the result is
              yours to download.
            </p>
            <Link to="/how-it-works/" className="btn btn--secondary">
              How it works <Icon name="arrow-right" size={14} />
            </Link>
          </div>

          <ol className="explain__steps">
            {[
              {
                icon: 'file' as const,
                title: 'Bring a file in',
                body: 'Drag it, drop it, or pick it from your device. Nothing is transmitted.',
              },
              {
                icon: 'cpu' as const,
                title: 'Work on it',
                body: 'Convert, compress, protect or inspect it. The file on your disk is never modified.',
              },
              {
                icon: 'download' as const,
                title: 'Save the result',
                body: 'Download the file you made. Close the tab and nothing is left behind.',
              },
            ].map((step, index) => (
              <li key={step.title} className="explain__step" style={{ ['--i' as string]: index }}>
                <span className="explain__step-index mono">0{index + 1}</span>
                <span className="explain__step-icon">
                  <Icon name={step.icon} size={16} />
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* --------------------------------------------------------------- CTA */}
      <section className="page section">
        <div className="cta-band">
          <div className="cta-band__glow" aria-hidden="true" />
          <ZeroMark size={44} />
          <div>
            <h2>Pick a tool. Your file stays on your device.</h2>
            <p>No sign-up, no queue. The work happens in the tab you already have open.</p>
          </div>
          <Link to="/tools/" className="btn btn--primary btn--lg">
            Open the toolkit <Icon name="arrow-right" size={15} />
          </Link>
        </div>
      </section>
    </main>
  );
}
