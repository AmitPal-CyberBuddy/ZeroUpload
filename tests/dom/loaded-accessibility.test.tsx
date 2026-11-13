import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../src/hooks/useToast';
import Base64Tool from '../../src/tools/dev/Base64Tool';
import { setHandoff } from '../../src/lib/files/handoff';
import { FileManifest } from '../../src/components/file/FileManifest';

describe('loaded tool accessibility', () => {
  it('labels the encoded file preview', async () => {
    const file = new File(['hello'], 'sample.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('hello').buffer });
    setHandoff([file], 'base64');
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<StrictMode><MemoryRouter><ToastProvider><Base64Tool /></ToastProvider></MemoryRouter></StrictMode>));
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 20)); });
    const output = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Base64 file output, first 2,000 characters"]');
    expect(output?.readOnly).toBe(true);
    expect(output?.value).toBe('aGVsbG8=');
    await act(async () => root.unmount());
  });

  it('keeps file-order controls explicitly named and operable', async () => {
    const file = new File(['hello'], 'sample.txt', { type: 'text/plain' });
    const move = vi.fn(); const remove = vi.fn();
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<FileManifest items={[{ id: 'one', file }]} onMove={move} onRemove={remove} />));
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Move sample.txt up"]')?.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove sample.txt"]')!.click());
    expect(remove).toHaveBeenCalledWith('one');
    await act(async () => root.unmount());
  });
});
