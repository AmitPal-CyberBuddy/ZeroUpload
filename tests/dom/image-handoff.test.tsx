import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { FileDrop } from '../../src/components/file/FileDrop';
import { useImagePipeline } from '../../src/hooks/useImagePipeline';
import { setHandoff } from '../../src/lib/files/handoff';

vi.mock('../../src/lib/image/validate', () => ({
  validateImage: async (file: File) => ({ file, width: 10, height: 10, detectedType: file.type, mismatch: false }),
}));

function ImageWorkspace() {
  const pipeline = useImagePipeline();
  return pipeline.input ? <p>{pipeline.input.file.name}</p> :
    <FileDrop handoffTarget="image-compressor" accept="image/*" disabled={pipeline.busy} onFiles={files => void pipeline.load(files[0])} />;
}

describe('image handoff', () => {
  it('survives StrictMode parent effect replay and loads exactly the chosen file', async () => {
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    setHandoff([file], 'image-compressor');
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<StrictMode><ImageWorkspace /></StrictMode>);
      await new Promise(resolve => window.setTimeout(resolve, 20));
    });
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 20)); });
    expect(container.textContent).toContain('photo.png');
    await act(async () => { root.unmount(); });
  });
});
