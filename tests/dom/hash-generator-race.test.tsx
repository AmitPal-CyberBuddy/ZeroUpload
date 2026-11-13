import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../src/hooks/useToast';

/*
 * File hashing moved to `streamHash` (slices, progress, cancellation) so a large
 * file no longer has to fit in memory twice. The isolation property this test
 * exists for is unchanged: a digest for an input the user has left must not
 * overwrite the current one, whichever module produces it.
 */
const mocks = vi.hoisted(() => ({ hashText: vi.fn(), streamHash: vi.fn() }));
vi.mock('../../src/lib/hash/hash', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/hash/hash')>();
  return { ...actual, hashText: mocks.hashText };
});
vi.mock('../../src/lib/hash/stream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/hash/stream')>();
  return { ...actual, streamHash: mocks.streamHash };
});
import HashGeneratorTool from '../../src/tools/dev/HashGeneratorTool';

const button = (container: HTMLElement, text: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!;
describe('hash generator input isolation', () => {
  it('never lets a pending text digest overwrite file mode or an old algorithm overwrite a new one', async () => {
    let finishText!: (value: string) => void; let finishOld!: (value: string) => void; let finishNew!: (value: string) => void;
    mocks.hashText.mockReset().mockImplementation(() => new Promise(resolve => { finishText = resolve; }));
    mocks.streamHash.mockReset().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    await act(async () => root.render(<MemoryRouter><ToastProvider><HashGeneratorTool /></ToastProvider></MemoryRouter>));
    await act(async () => button(container, 'File').click());
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File(['file'], 'test.txt', { type: 'text/plain' })], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => button(container, 'SHA-512').click());
    await act(async () => { finishNew('new-file-digest'); });
    await act(async () => { finishText('stale-text-digest'); finishOld('stale-file-digest'); });
    expect(container.textContent).toContain('new-file-digest');
    expect(container.textContent).not.toContain('stale-text-digest');
    expect(container.textContent).not.toContain('stale-file-digest');
    expect(mocks.hashText).toHaveBeenCalledTimes(1);
    expect(mocks.streamHash).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount()); container.remove();
  });
});
