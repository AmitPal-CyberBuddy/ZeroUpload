import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ToolsPage } from '../../src/pages/ToolsPage';
import { useScrollRestoration } from '../../src/hooks/useScrollRestoration';
import { CopyButton } from '../../src/components/ui/controls';

function Harness() {
  const navigate = useNavigate();
  useScrollRestoration();
  return <><button onClick={() => navigate('/tools/?q=pdf&other=kept')}>External search</button><ToolsPage /></>;
}

describe('shared navigation and feedback', () => {
  it('updates the catalogue on external search without scrolling on query changes', async () => {
    const scroll = vi.spyOn(window, 'scrollTo');
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<MemoryRouter initialEntries={['/tools/?q=image']}><Harness /></MemoryRouter>); });
    scroll.mockClear();
    await act(async () => { container.querySelector('button')!.click(); });
    expect(container.querySelector<HTMLInputElement>('[aria-label="Filter tools"]')?.value).toBe('pdf');
    expect(scroll).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Merge PDF');
    await act(async () => { root.unmount(); });
    scroll.mockRestore();
  });

  it('communicates a clipboard failure instead of failing silently', async () => {
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    const original = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    // copyText may fall back to execCommand; make that fail too.
    const previous = document.execCommand;
    document.execCommand = vi.fn(() => false);
    await act(async () => { root.render(<CopyButton value="example" />); });
    await act(async () => { container.querySelector('button')!.click(); });
    expect(container.textContent).toContain('Copy failed');
    await act(async () => { root.unmount(); });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: original });
    document.execCommand = previous;
  });
});
