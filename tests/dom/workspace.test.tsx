import { act } from 'react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspacePage } from '../../src/pages/WorkspacePage';
import { CapabilityPage } from '../../src/pages/CapabilityPage';
import { HUB_MAP } from '../../src/registry/groups';
import { setHandoff } from '../../src/lib/files/handoff';
import { render } from './render';

/**
 * The workspace is the page that made the grouping real, so it is worth checking
 * behaviour rather than markup: which actions appear for a given file, and that
 * choosing one hands the file over instead of asking for it again.
 */

const withPng = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], 'photo.png', {
    type: 'image/png',
  });

const withPdf = () =>
  new File([new Uint8Array([...'%PDF-1.7 body'].map((c) => c.charCodeAt(0)))], 'report.pdf', {
    type: 'application/pdf',
  });

/* The harness supplies the router and the toast provider; this is only the route. */
const page = () => (
  <Routes>
    <Route path="/tools/workspace/" element={<WorkspacePage />} />
    <Route path="/tools/:slug/" element={<div data-testid="arrived" />} />
  </Routes>
);

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('workspace', () => {
  it('starts with a drop zone and no assumed file', async () => {
    const view = await render(page(), { route: '/tools/workspace/' });
    expect(view.errors).toEqual([]);
    expect(view.html).toContain('Drop a file');
    await view.unmount();
  });

  it('offers the image actions for an image and hides the PDF ones', async () => {
    const view = await render(page(), { route: '/tools/workspace/' });

    const input = view.container.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [withPng()], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const text = view.container.textContent ?? '';
    expect(text).toContain('photo.png');
    expect(text).toContain('Compress this image');
    expect(text).toContain('Resize to exact pixels');
    // The decisive assertion: a PDF-only tool must not be offered for an image.
    expect(text).not.toContain('Merge with other PDFs');
    expect(view.errors).toEqual([]);
    await view.unmount();
  });

  it('offers the PDF actions, including both password directions, for a PDF', async () => {
    const view = await render(page(), { route: '/tools/workspace/' });

    const input = view.container.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [withPdf()], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const text = view.container.textContent ?? '';
    expect(text).toContain('Merge with other PDFs');
    expect(text).toContain('Add a password');
    expect(text).toContain('Remove a known password');
    expect(view.errors).toEqual([]);
    await view.unmount();
  });

  it('takes a file from the handoff slot, so the homepage does not ask twice', async () => {
    setHandoff([withPdf()], 'workspace');
    const view = await render(page(), { route: '/tools/workspace/' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(view.container.textContent ?? '').toContain('report.pdf');
    expect(view.errors).toEqual([]);
    await view.unmount();
  });

  it('says so, rather than guessing, when it cannot identify a file', async () => {
    const view = await render(page(), { route: '/tools/workspace/' });
    const input = view.container.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array([0, 1, 2, 3])], 'blob')],
      configurable: true,
    });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const text = view.container.textContent ?? '';
    expect(text).toContain('Find out what this is');
    expect(view.errors).toEqual([]);
    await view.unmount();
  });
});

describe('capability page', () => {
  it('names both tools that remove a password', async () => {
    const hub = HUB_MAP.unlock;
    const view = await render(<CapabilityPage hub={hub} />, { route: '/tools/unlock/' });

    const text = view.container.textContent ?? '';
    expect(text).toContain('Unlock PDF');
    expect(text).toContain('Unlock Office');
    expect(text).toContain('Formats covered');
    // The caveat is the trust claim and must survive edits to the page.
    expect(text.toLowerCase()).toContain('not a cracker');
    expect(view.errors).toEqual([]);
    await view.unmount();
  });

  it('lists the formats the capability crosses', async () => {
    const view = await render(<CapabilityPage hub={HUB_MAP.convert} />, { route: '/tools/convert/' });
    const text = view.container.textContent ?? '';
    for (const format of ['JPG', 'PNG', 'WEBP', 'AVIF']) expect(text).toContain(format);
    expect(view.errors).toEqual([]);
    await view.unmount();
  });
});
