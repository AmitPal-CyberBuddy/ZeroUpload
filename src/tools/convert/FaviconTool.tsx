import { useEffect, useMemo, useRef, useState } from 'react';

import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { Field, Notice } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { Progress } from '../../components/ui/Progress';
import { toToolError, type ToolError } from '../../lib/files/errors';
import { formatBytes } from '../../lib/files/format';
import { Outcome } from '../../components/tool/Outcome';
import { copyText, triggerDownload } from '../../lib/files/download';
import { validateImage, type ImageInput } from '../../lib/image/validate';
import {
  APPLE_TOUCH_SIZE,
  BASE_SIZE,
  DEFAULT_THEME_COLOR,
  ICO_SIZES,
  MANIFEST_SIZES,
  appleTouchFileName,
  buildHeadSnippet,
  buildWebManifest,
  icoFileName,
  iconSizes,
  manifestFileName,
  pngFileName,
  standaloneIconSizes,
} from '../../lib/image/favicon';
import { useToast } from '../../hooks/useToast';
import { toolDefinition } from '../../registry/useToolDefinition';

const tool = toolDefinition('favicon');

interface Artifact {
  name: string;
  /** Held bytes, or `null` once released — metadata stays so the list does not lie. */
  blob: Blob | null;
  bytes: number;
  /** What this file is for, shown in the list. */
  note: string;
}

export default function FaviconTool() {
  const [input, setInput] = useState<ImageInput | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [busy, setBusy] = useState(false);
  const [packaging, setPackaging] = useState(false);
  const [ratio, setRatio] = useState(0);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const [siteName, setSiteName] = useState('My site');
  const [themeColor, setThemeColor] = useState(DEFAULT_THEME_COLOR);
  const abortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  const sizes = useMemo(() => iconSizes(), []);
  const standalone = useMemo(() => standaloneIconSizes(), []);

  const manifest = useMemo(() => buildWebManifest({ name: siteName, themeColor }), [siteName, themeColor]);
  const snippet = useMemo(() => buildHeadSnippet({ themeColor }), [themeColor]);

  // Drop every blob when the source changes: a stale icon set next to a new
  // source image is the kind of quiet mismatch that ships broken favicons.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setInput(null);
    setArtifacts([]);
    setError(null);
    setBusy(false);
    setPackaging(false);
    setRatio(0);
    setStep(null);
  };

  const load = async (file: File) => {
    setError(null);
    setArtifacts([]);
    setBusy(true);
    setStep('Reading the source image…');
    try {
      const validated = await validateImage(file);
      setInput(validated);
    } catch (err) {
      setInput(null);
      setError(toToolError(err));
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  const generate = async () => {
    if (!input) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setArtifacts([]);
    setRatio(0);

    try {
      const { processImage } = await import('../../lib/image/processor');
      const square = Math.min(input.width, input.height);
      const crop =
        input.width === input.height
          ? undefined
          : {
              x: Math.floor((input.width - square) / 2),
              y: Math.floor((input.height - square) / 2),
              width: square,
              height: square,
            };

      // One decode at the largest edge; every smaller icon is a downscale of it,
      // so a 20 MP photo is not decoded seven times.
      setStep(`Rendering ${BASE_SIZE}px master…`);
      const master = await processImage(
        { file: input.file, format: 'image/png', quality: 1, crop, maxWidth: BASE_SIZE, maxHeight: BASE_SIZE },
        undefined,
        { signal: controller.signal },
      );
      setRatio(1 / (sizes.length + 1));

      const pngs = new Map<number, Blob>([[BASE_SIZE, master.blob]]);
      let done = 1;
      for (const size of sizes) {
        if (size === BASE_SIZE) continue;
        setStep(`Rendering ${size}px…`);
        const next = await processImage(
          // `upscale` so a small source still yields the exact edge length: an
          // .ico entry whose payload says 200×200 cannot be filed as 256×256.
          { file: master.blob, format: 'image/png', quality: 1, maxWidth: size, maxHeight: size, upscale: true },
          undefined,
          { signal: controller.signal },
        );
        pngs.set(size, next.blob);
        done += 1;
        setRatio(done / (sizes.length + 1));
      }

      setStep('Assembling the icon files…');
      const { buildIco } = await import('../../lib/image/ico');
      const icoBytes = buildIco(
        await Promise.all(
          ICO_SIZES.map(async (size) => ({
            size,
            png: new Uint8Array(await pngs.get(size)!.arrayBuffer()),
          })),
        ),
      );

      const built: Artifact[] = [
        (() => {
          const blob = new Blob([icoBytes], { type: 'image/x-icon' });
          return {
            name: icoFileName(),
            blob,
            bytes: blob.size,
            note: `${ICO_SIZES.join('/')}px inside one file — tabs, bookmarks, Windows`,
          };
        })(),
        ...standalone.map((size): Artifact => {
          const note =
            size === APPLE_TOUCH_SIZE
              ? `iOS home screen (${size}px)`
              : (MANIFEST_SIZES as readonly number[]).includes(size)
                ? `Web manifest icon (${size}px)`
                : `Browser tab (${size}px)`;
          const blob = pngs.get(size)!;
          return {
            name: size === APPLE_TOUCH_SIZE ? appleTouchFileName() : pngFileName(size),
            blob,
            bytes: blob.size,
            note,
          };
        }),
      ];

      setArtifacts(built);
      setRatio(1);
      toast(`Generated ${built.length} files locally`, 'success');
    } catch (err) {
      const toolError = toToolError(err);
      if (toolError.code === 'cancelled') {
        setStep(null);
        toast('Generation cancelled', 'default');
      } else {
        setError(toolError);
      }
      setArtifacts([]);
    } finally {
      abortRef.current = null;
      setBusy(false);
      setStep(null);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setStep('Stopping after the current step…');
  };

  const held = artifacts.filter((artifact): artifact is Artifact & { blob: Blob } => artifact.blob !== null);

  const releaseAll = () => {
    // Drop the bytes, keep the list: the sizes are metadata, not a promise that
    // the file is still downloadable.
    setArtifacts((list) => list.map((artifact) => ({ ...artifact, blob: null })));
    setRatio(0);
    toast('Generated files cleared — generate again to download', 'default');
  };

  const downloadAll = async () => {
    if (held.length === 0) return;
    setPackaging(true);
    setRatio(0);
    setError(null);
    try {
      const { createZip } = await import('../../lib/zip/zip');
      const archive = await createZip(
        [
          ...held.map((artifact) => ({ name: artifact.name, blob: artifact.blob })),
          {
            name: manifestFileName(),
            blob: new Blob([manifest], { type: 'application/manifest+json' }),
          },
        ],
        { onProgress: (next: number) => setRatio(next) },
      );
      triggerDownload(archive, 'favicon-package.zip');
      toast('Icon package downloaded', 'success');
    } catch (err) {
      setError(toToolError(err));
    } finally {
      setPackaging(false);
      setRatio(0);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await copyText(text);
      toast(`${label} copied`, 'success');
    } catch {
      toast('The clipboard is not available in this browser', 'error');
    }
  };

  const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);

  return (
    <ToolLayout
      tool={tool}
      aside={
        input ? (
          <Settings
            title="Icon set"
            footer={
              <div className="stack" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={generate}
                  disabled={busy || packaging}
                >
                  {busy ? <Spinner label="Generating" /> : <Icon name="sparkle" size={14} />}
                  {busy ? 'Generating…' : artifacts.length > 0 ? 'Regenerate icons' : 'Generate icons'}
                </button>
                {busy ? (
                  <button type="button" className="btn btn--ghost btn--block" onClick={cancel}>
                    Cancel
                  </button>
                ) : null}
              </div>
            }
          >
            <Outcome
              rows={[
                { label: 'Source', value: `${input.width} × ${input.height}px` },
                { label: 'Renders', value: `${sizes.length} sizes + .ico` },
                { label: 'Also writes', value: 'site.webmanifest · HTML snippet' },
              ]}
              note="Every icon is drawn on this device. Download the set as a ZIP and drop it into your project's public folder."
            />

            <Field label="Site name" hint="Shown as the app name when the site is installed." htmlFor="favicon-site-name">
              <input
                id="favicon-site-name"
                className="input"
                value={siteName}
                maxLength={64}
                onChange={(event) => setSiteName(event.target.value)}
              />
            </Field>

            <Field label="Theme colour" hint="Sets the browser bar colour on mobile." htmlFor="favicon-theme">
              <div className="row" style={{ gap: 6 }}>
                <input
                  id="favicon-theme"
                  className="input input--mono"
                  value={themeColor}
                  maxLength={9}
                  onChange={(event) => setThemeColor(event.target.value)}
                />
                <input
                  type="color"
                  aria-label="Pick a theme colour"
                  value={/^#[0-9a-f]{6}$/i.test(themeColor) ? themeColor : DEFAULT_THEME_COLOR}
                  onChange={(event) => setThemeColor(event.target.value)}
                />
              </div>
            </Field>

            <Notice tone="default" icon="info">
              The image is centre-cropped to a square, then used as the master for every icon size. Choose
              a source of at least {BASE_SIZE}px for the sharpest result.
            </Notice>
          </Settings>
        ) : null
      }
    >
      <div className="tool-body">
        {!input ? (
          <>
            <FileDrop
              accept="image/*"
              onFiles={(files) => void load(files[0])}
              title="Drop an image to make icons from"
              hint="A square PNG or a photograph works. 512px or larger gives the sharpest result; SVG is not supported."
              icon="image"
              disabled={busy}
            />
            {error ? (
              <Notice tone="danger" title="Could not open this file">
                {error.message}
                {error.hint ? <div className="hint">{error.hint}</div> : null}
              </Notice>
            ) : null}
            {step ? <p className="field__hint">{step}</p> : null}
            <div className="workspace-notes">
              <div>
                <Icon name="cpu" size={15} />
                <strong>Everything is generated here</strong>
                <p>
                  The icon set is built in your browser and downloaded straight from it. Nothing is uploaded,
                  and no image is kept after you close the page.
                </p>
              </div>
              <div>
                <Icon name="shield" size={15} />
                <strong>Why SVG is refused</strong>
                <p>
                  An SVG can contain scripts, and rendering one the same way everywhere is not reliable. Use
                  a PNG instead, and the icon set will be predictable.
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="row row--between row--wrap">
              <span className="section-title">Source</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={reset} disabled={busy || packaging}>
                <Icon name="x" size={13} /> Change image
              </button>
            </div>

            <div className="row row--wrap" style={{ gap: 'var(--s-2)', alignItems: 'center' }}>
              <span className="badge">
                {input.file.name.length > 40 ? `${input.file.name.slice(0, 37)}…` : input.file.name}
              </span>
              <span className="badge">{formatBytes(input.file.size)}</span>
              <span className="badge">
                {input.width} × {input.height}px
              </span>
              <span className="badge">{input.detectedType.replace('image/', '').toUpperCase()}</span>
            </div>

            {Math.min(input.width, input.height) < BASE_SIZE ? (
              <Notice tone="warn" title="Source is smaller than the master">
                The shortest edge is {Math.min(input.width, input.height)}px, so the {BASE_SIZE}px master and
                the larger icons are upscaled. They will work; they just will not gain detail.
              </Notice>
            ) : null}

            {input.mismatch ? (
              <Notice tone="warn" title="Extension mismatch">
                This file is labelled {input.file.type || 'unknown'}, but its contents are{' '}
                {input.detectedType}. The contents are what count.
              </Notice>
            ) : null}

            {error ? (
              <Notice tone="danger" title="Icon generation failed">
                {error.message}
                {error.hint ? <div className="hint">{error.hint}</div> : null}
              </Notice>
            ) : null}

            {busy || step ? (
              <div className="stack" style={{ gap: 6 }}>
                <Progress value={ratio} label="Icon generation progress" />
                <span className="field__hint">{step ?? 'Working…'}</span>
              </div>
            ) : null}

            {!busy && artifacts.length === 0 && !error ? (
              <div className="preview-placeholder" style={{ minHeight: 160 }}>
                <Icon name="grid" size={20} />
                <p>
                  One .ico holding {ICO_SIZES.join(', ')}px, plus {standalone.length} PNGs
                  ({standalone.join(', ')}px) and a web manifest, ready to add to your site.
                </p>
              </div>
            ) : null}

            {artifacts.length > 0 ? (
              <>
                <div className="row row--between row--wrap">
                  <span className="section-title">Generated files</span>
                  <span className="field__hint">
                    {artifacts.length} files · {formatBytes(totalBytes)}
                    {held.length === 0 ? ' · cleared' : ''}
                  </span>
                </div>

                <div className="result">
                  <div className="result__head">
                    <span className="result__title">
                      <i className="dot" aria-hidden="true" />
                      Icon set
                    </span>
                    <span className="badge">PNG payloads</span>
                  </div>

                  <div className="manifest">
                    <div className="manifest__head">
                      <span>File</span>
                      <span style={{ textAlign: 'right' }}>Size</span>
                      <span style={{ textAlign: 'right' }}>Save</span>
                    </div>
                    {artifacts.map((artifact) => (
                      <div className="manifest__row" key={artifact.name}>
                        <span className="manifest__name">
                          <Icon name={artifact.name.endsWith('.ico') ? 'zip' : 'image'} size={14} />
                          <span style={{ minWidth: 0 }}>
                            <span className="mono">{artifact.name}</span>
                            <span className="field__hint" style={{ display: 'block' }}>
                              {artifact.note}
                            </span>
                          </span>
                        </span>
                        <span className="manifest__size">{formatBytes(artifact.bytes)}</span>
                        <span className="manifest__actions">
                          <button
                            type="button"
                            className="btn btn--icon"
                            style={{ width: 28, height: 28 }}
                            aria-label={`Download ${artifact.name}`}
                            disabled={!artifact.blob}
                            onClick={() => artifact.blob && triggerDownload(artifact.blob, artifact.name)}
                          >
                            <Icon name="download" size={13} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="row row--wrap" style={{ gap: 'var(--s-2)' }}>
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => void downloadAll()}
                      disabled={packaging || held.length === 0}
                    >
                      {packaging ? <Spinner label="Packaging" /> : <Icon name="zip" size={13} />}
                      {packaging ? 'Packaging…' : 'Download all as ZIP'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={releaseAll}
                      disabled={held.length === 0}
                    >
                      <Icon name="x" size={13} /> Clear generated files
                    </button>
                  </div>

                  {packaging ? <Progress value={ratio} label="Packaging progress" /> : null}

                  <p className="field__hint">
                    {held.length === 0
                      ? 'The generated files have been cleared. The snippet and manifest are still here — generate again to download them.'
                      : `The ZIP also contains ${manifestFileName()}. Keep the files next to each other: every path in the snippet is relative, so the set works under a subdirectory.`}
                  </p>
                </div>

                <div className="snippet">
                  <div className="snippet__head">
                    <span>Paste into &lt;head&gt;</span>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copy(snippet, 'Snippet')}>
                      <Icon name="copy" size={13} /> Copy
                    </button>
                  </div>
                  <pre role="region" aria-label="HTML snippet, scroll horizontally if needed" tabIndex={0}>{snippet}</pre>
                </div>

                <div className="snippet">
                  <div className="snippet__head">
                    <span>{manifestFileName()}</span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => void copy(manifest, 'Manifest')}
                    >
                      <Icon name="copy" size={13} /> Copy
                    </button>
                  </div>
                  <pre role="region" aria-label="Web manifest, scroll horizontally if needed" tabIndex={0}>{manifest}</pre>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
