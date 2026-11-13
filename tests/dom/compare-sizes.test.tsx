import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { CompareSizes } from '../../src/components/tool/CompareSizes';

describe('size comparison', () => {
  it('describes equal, smaller and larger outputs accurately', async () => {
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<CompareSizes original={1000} output={1000} />));
    expect(container.textContent).toContain('Same size');
    expect(container.textContent).not.toContain('smaller');
    await act(async () => root.render(<CompareSizes original={1000} output={500} />));
    expect(container.textContent).toContain('smaller');
    await act(async () => root.render(<CompareSizes original={1000} output={1200} />));
    expect(container.textContent).toContain('larger than the original');
    await act(async () => root.unmount());
  });
});
