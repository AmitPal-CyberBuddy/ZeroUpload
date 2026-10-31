import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ZeroMark, ZeroWordmark } from '../components/brand/ZeroMark';
import { FileDrop } from '../components/file/FileDrop';
import { Icon } from '../components/ui/Icon';
import { CATEGORIES } from '../registry/categories';
import { TOOLS, TOOLS_BY_CATEGORY } from '../registry/tools';
import { setHandoff } from '../lib/files/handoff';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatBytes, middleTruncate } from '../lib/files/format';

const FEATURED = ['image-compressor', 'image-converter', 'merge-pdf', 'file-inspector'];

const FORMAT_LINE = ['JPEG', 'PNG', 'WebP', 'AVIF', 'PDF', 'ZIP', 'JSON'];

export function HomePage() {
  useDocumentTitle();
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
        navigate('/tools/file-inspector');
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
            <span className="eyebrow hero__eyebrow">
              <i className="dot" aria-hidden="true" />
              Local-first file toolkit
            </span>

            <h1 className="hero-title">
              <ZeroWordmark />
              <span className="visually-hidden">ZeroUpload</span>
            </h1>

            <p className="hero__tagline">Convert. Compress. Transform. Locally.</p>

            <p className="hero__lede">
              A browser-native workspace for the files you would rather not hand to a stranger. Every
              operation runs on your device, in your tab, on your terms.
            </p>

            <div className="hero__trust">
              <span>
                <Icon name="lock" size={14} /> No upload
              </span>
              <span>
                <Icon name="cpu" size={14} /> No cloud processing
              </span>
              <span>
                <Icon name="shield" size={14} /> No account
              </span>
            </div>
          </div>

          {/* ------------------------------------------------------ Intake zone */}
          <div className="hero__intake">
            <div className="intake">
              <div className="intake__head">
                <span className="mono">LOCAL WORKSPACE</span>
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
                  hint="Images, PDFs, archives or text. The file stays in this tab — you can watch the network panel stay quiet."
                  icon="arrow-down"
                />
              )}

              <div className="intake__formats">
                <span className="mono">SUPPORTED</span>
                <div className="intake__format-list">
                  {FORMAT_LINE.map((format) => (
                    <span key={format} className="format-chip mono">
                      {format}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="intake__foot">
              <span>
                <Icon name="shield" size={13} />
                Files never leave your device
              </span>
              <Link to="/architecture" className="link-inline">
                How it works <Icon name="arrow-right" size={13} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- Ticker */}
      <section className="page">
        <div className="signal-bar">
          <div className="signal-bar__item">
            <span className="numeric">0</span>
            <span>bytes uploaded</span>
          </div>
          <div className="signal-bar__item">
            <span className="numeric">{TOOLS.length}</span>
            <span>local tools</span>
          </div>
          <div className="signal-bar__item">
            <span className="numeric">0</span>
            <span>API servers</span>
          </div>
          <div className="signal-bar__item">
            <span className="numeric">∞</span>
            <span>files per session</span>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- Categories */}
      <section className="page section" aria-labelledby="categories-title">
        <div className="section-head">
          <div>
            <span className="eyebrow">Catalogue</span>
            <h2 id="categories-title">Seven categories, one local boundary.</h2>
          </div>
          <Link to="/tools" className="btn btn--secondary btn--sm">
            Browse all tools <Icon name="arrow-right" size={14} />
          </Link>
        </div>

        <div className="category-grid" data-stagger>
          {CATEGORIES.map((category, index) => {
            const tools = TOOLS_BY_CATEGORY[category.id] ?? [];
            return (
              <Link
                key={category.id}
                to={`/tools?c=${category.id}`}
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
            <span className="eyebrow">Start here</span>
            <h2 id="featured-title">The everyday four.</h2>
          </div>
        </div>

        <div className="feature-grid">
          {FEATURED.map((slug, index) => {
            const tool = TOOLS.find((item) => item.slug === slug);
            if (!tool) return null;
            return (
              <Link key={slug} to={`/tools/${slug}`} className="feature-card" style={{ ['--i' as string]: index }}>
                <span className="feature-card__icon">
                  <Icon name={tool.icon} size={18} />
                </span>
                <h3>{tool.name}</h3>
                <p>{tool.blurb}</p>
                <span className="feature-card__tags">
                  {tool.tags?.map((tag) => (
                    <span key={tag} className="badge">
                      {tag}
                    </span>
                  ))}
                </span>
                <span className="feature-card__cta">
                  Open tool <Icon name="arrow-up-right" size={13} />
                </span>
              </Link>
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
              ZeroUpload is a static site. There is no upload endpoint to call, because there is no
              backend. Files are read with the File API, transformed with canvas, WebAssembly and
              WebCrypto, and saved with a Blob URL.
            </p>
            <Link to="/architecture" className="btn btn--secondary">
              Read the architecture <Icon name="arrow-right" size={14} />
            </Link>
          </div>

          <ol className="explain__steps">
            {[
              {
                icon: 'file' as const,
                title: 'Bring a file in',
                body: 'Dragged, dropped or picked. It is referenced in memory — never sent anywhere.',
              },
              {
                icon: 'cpu' as const,
                title: 'Process on-device',
                body: 'Workers and WASM decode, resize and re-encode inside your browser tab.',
              },
              {
                icon: 'download' as const,
                title: 'Save the result',
                body: 'The output is a Blob you download yourself. Close the tab and it is gone.',
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
            <h2>Ready when your files are.</h2>
            <p>No sign-up, no queue, no upload progress bar. Because there is no upload.</p>
          </div>
          <Link to="/tools" className="btn btn--primary btn--lg">
            Open the toolkit <Icon name="arrow-right" size={15} />
          </Link>
        </div>
      </section>
    </main>
  );
}
