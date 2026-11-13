import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileDrop } from '../components/file/FileDrop';
import { Icon } from '../components/ui/Icon';
import { Notice } from '../components/ui/controls';
import { usePageMeta } from '../hooks/usePageMeta';
import { PAGE_META } from '../seo/pages';
import { setHandoff, takeHandoff } from '../lib/files/handoff';
import { formatBytes } from '../lib/files/format';
import { detectFile, type DetectedFile } from '../lib/capabilities/detect';
import { FAMILIES, FORMATS, type FileFamily } from '../lib/capabilities/formats';
import { availableEdges, CAPABILITIES, convertibleFormats } from '../lib/capabilities/table';
import { getTool } from '../registry/tools';
import { HUB_MAP, hubForTool } from '../registry/groups';

/**
 * One drop zone, then only the actions that apply to the file that was dropped.
 *
 * This is the page that makes the capability grouping literal rather than a
 * matter of copy. Before it, the format and the action were both decisions the
 * visitor had to make by choosing a page: a HEIC photo needed the visitor to know
 * that "Image Converter" was the one, and a locked .docx needed them to find
 * "Unlock Office" rather than "Unlock PDF".
 *
 * Here the file answers both questions. `detectFile` reads its first bytes, the
 * capability table says what can be done with that family, and the actions are
 * links that hand the file straight to the tool so nothing is dropped twice.
 *
 * Nothing is processed on this page and nothing is stored: the file stays in
 * memory, in the same handoff slot the homepage has always used, and is cleared
 * if the visitor navigates anywhere else.
 */
export function WorkspacePage() {
  usePageMeta(PAGE_META['/tools/workspace/'], '/tools/workspace/');
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [detected, setDetected] = useState<DetectedFile | null>(null);
  const [detecting, setDetecting] = useState(false);

  const inspect = useCallback(async (next: File) => {
    setDetecting(true);
    setFile(next);
    setDetected(null);
    try {
      setDetected(await detectFile(next));
    } finally {
      setDetecting(false);
    }
  }, []);

  /*
   * Files dropped on the homepage and elsewhere arrive through the same handoff
   * slot the tools use; it is consumed exactly once, so a later navigation cannot
   * resurrect a file the visitor has moved on from.
   */
  const handoffConsumed = useRef(false);
  useEffect(() => {
    if (handoffConsumed.current) return;
    handoffConsumed.current = true;
    const pending = takeHandoff('workspace');
    if (pending[0]) void inspect(pending[0]);
  }, [inspect]);

  const family: FileFamily = detected?.family ?? 'unknown';
  const actions = useMemo(() => (detected ? availableEdges(family) : []), [detected, family]);
  const outputs = useMemo(() => (detected ? convertibleFormats(family) : []), [detected, family]);

  const handOff = (slug: string) => {
    if (!file) return;
    setHandoff([file], slug);
    navigate(`/tools/${slug}/`);
  };

  return (
    <main id="main" className="page">
      <header className="catalog-head">
        <span className="eyebrow">Workspace</span>
        <h1>Drop a file. It will tell you what it can become.</h1>
        <p>
          No choosing a tool first, and no choosing a format first. The file is read on this device — its
          first bytes, not its extension — and only the actions that actually apply to it are offered. Pick
          one and it opens with the file already loaded.
        </p>
      </header>

      {!file ? (
        <FileDrop
          onFiles={(files) => {
            if (files[0]) void inspect(files[0]);
          }}
          title="Drop any file, or choose one"
          hint="Images, PDFs, archives, Office documents, text — up to the per-tool limits. Nothing is uploaded; there is no upload endpoint at all."
          icon="plus"
        />
      ) : (
        <div className="workspace-report">
          <div className="workspace-report__file">
            <span className="workspace-report__icon" aria-hidden="true">
              <Icon name={detected?.family === 'pdf' ? 'pdf' : detected?.family === 'image' ? 'image' : 'file'} size={18} />
            </span>
            <div>
              <strong>{file.name}</strong>
              <div className="workspace-report__meta">
                <span>{formatBytes(file.size)}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {detecting ? 'Reading the first bytes…' : detected ? FAMILIES[detected.family].label : 'Unrecognised'}
                  {detected?.format ? ` · ${FORMATS[detected.format]?.label ?? detected.format.toUpperCase()}` : ''}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setFile(null);
                setDetected(null);
              }}
            >
              <Icon name="x" size={13} /> Choose another
            </button>
          </div>

          {detected?.mismatch ? (
            <Notice tone="warn" title="The extension and the contents disagree">
              This file is named as one format but its first bytes say{detected.label.toLowerCase()}. The
              actions below follow the bytes, because that is what a program will actually see.
            </Notice>
          ) : null}

          {detected && detected.source !== 'signature' && detected.family !== 'text' && detected.family !== 'unknown' ? (
            <Notice tone="default" title="Identified from the name, not the contents">
              The opening bytes did not match a known format, so this is what the extension claims. Inspect it
              first if the file came from somewhere you do not trust.
            </Notice>
          ) : null}

          {outputs.length > 0 ? (
            <section className="workspace-formats" aria-labelledby="can-become">
              <h2 id="can-become">This can become</h2>
              <div className="workspace-formats__row">
                <span className="workspace-formats__from">
                  {detected?.format ? FORMATS[detected.format]?.label ?? detected.format.toUpperCase() : FAMILIES[family].label}
                </span>
                <Icon name="arrow-right" size={14} />
                {outputs.map((format) => (
                  <span key={format} className="badge badge--accent">
                    {FORMATS[format]?.label ?? format.toUpperCase()}
                  </span>
                ))}
              </div>
              <p className="hint">
                Which of these your browser can actually encode is checked when the tool opens — AVIF in
                particular depends on the browser. The list above is the union of what this platform
                implements, not a promise about your device.
              </p>
            </section>
          ) : null}

          <section aria-labelledby="what-you-can-do">
            <h2 id="what-you-can-do" className="workspace-report__h2">
              {actions.length > 0 ? 'What you can do with it' : 'Nothing applies to this file yet'}
            </h2>

            {actions.length === 0 ? (
              <p>
                No tool here takes this kind of file. The inspector will still tell you what it is, which is
                usually the useful next step.
              </p>
            ) : (
              <ul className="workspace-actions">
                {actions.map((edge) => {
                  const tool = getTool(edge.tool);
                  const capability = CAPABILITIES[edge.capability];
                  const hub = hubForTool(edge.tool);
                  return (
                    <li key={`${edge.capability}-${edge.tool}`} className="workspace-action">
                      <div className="workspace-action__text">
                        <strong>{edge.label ?? capability.verb}</strong>
                        <span>{edge.note ?? capability.blurb}</span>
                        <span className="workspace-action__where">
                          {capability.name}
                          {hub ? (
                            <>
                              {' · '}
                              <Link to={`/tools/${hub.id}/`}>{hub.name} capability</Link>
                            </>
                          ) : null}
                          {tool ? ` · ${tool.name}` : null}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => handOff(edge.tool)}
                      >
                        Open <Icon name="arrow-right" size={12} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      <section className="page-footnote">
        <h2>Browsing instead of holding a file?</h2>
        <p>
          The capability pages list what each job supports across formats:{' '}
          {Object.values(HUB_MAP)
            .filter((hub) => hub.enabled)
            .map((hub, index, list) => (
              <span key={hub.id}>
                <Link to={`/tools/${hub.id}/`}>{hub.name}</Link>
                {index < list.length - 1 ? ', ' : ''}
              </span>
            ))}
          . Every one of them runs in this tab.
        </p>
      </section>
    </main>
  );
}
