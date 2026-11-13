import { act, StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../src/hooks/useToast';
import FileInspectorTool from '../../src/tools/inspect/FileInspectorTool';
import CreateZipTool from '../../src/tools/archive/CreateZipTool';
import JsonFormatterTool from '../../src/tools/dev/JsonFormatterTool';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { FileDrop } from '../../src/components/file/FileDrop';
import { discardHandoffExcept, setHandoff, takeHandoff } from '../../src/lib/files/handoff';
import { suggestTools, type Inspection } from '../../src/tools/inspect/FileInspectorTool';

describe('inspector next steps', () => {
  it('routes a file only to its intended drop zone and consumes it once', async () => {
    const file = new File(['hello'], 'example.txt', { type: 'text/plain' });
    setHandoff([file], 'create-zip');
    expect(takeHandoff('extract-zip')).toEqual([]);
    const onFiles = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<FileDrop handoffTarget="create-zip" onFiles={onFiles} />); });
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 20)); });
    expect(onFiles).toHaveBeenCalledOnce();
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(takeHandoff('create-zip')).toEqual([]);
    await act(async () => { root.unmount(); });
  });

  it('explains rejected files when the tool supplies no error handler', async () => {
    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' });
    setHandoff([file], 'image-compressor');
    const onFiles = vi.fn();
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<FileDrop handoffTarget="image-compressor" accept="image/*" onFiles={onFiles} />); });
    expect(onFiles).not.toHaveBeenCalled();
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 20)); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not a supported file type');
    await act(async () => { root.unmount(); });
  });

  it('discards a handoff when the user navigates elsewhere', () => {
    const file = new File(['hello'], 'notes.txt');
    setHandoff([file], 'create-zip');
    discardHandoffExcept('/tools/');
    expect(takeHandoff('create-zip')).toEqual([]);
  });

  it('recommends only file-capable actions for text and avoids unsupported images', () => {
    const inspection = (name: string, type: string): Inspection => ({
      file: new File(['content'], name, { type }), signature: null,
      declaredType: type, mismatch: false, textPreview: 'content',
    });
    expect(suggestTools(inspection('notes.txt', 'text/plain')).map(s => s.slug)).toEqual(['base64', 'create-zip']);
    expect(suggestTools(inspection('data.json', 'application/json')).map(s => s.slug)).toEqual(['json-formatter', 'base64', 'create-zip']);
    expect(suggestTools(inspection('image.svg', 'image/svg+xml')).map(s => s.slug)).toEqual(['base64', 'create-zip']);
    expect(suggestTools(inspection('photo.png', 'image/png')).map(s => s.slug)).toEqual(['image-compressor', 'image-converter', 'resize']);
    expect(suggestTools(inspection('paper.pdf', 'application/pdf')).map(s => s.slug)).toEqual(['pdf-editor', 'merge-pdf', 'split-pdf', 'rotate-pdf']);
  });

  it('carries an inspected file through the suggested ZIP action', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'slice', { value: () => ({ arrayBuffer: async () => new TextEncoder().encode('hello').buffer, text: async () => 'hello' }) });
    Object.defineProperty(file, 'text', { value: async () => 'hello' });
    setHandoff([file], 'file-inspector');
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<StrictMode><MemoryRouter initialEntries={['/tools/file-inspector/']}><ToastProvider><Routes>
        <Route path="/tools/file-inspector/" element={<FileInspectorTool />} />
        <Route path="/tools/create-zip/" element={<CreateZipTool />} />
      </Routes></ToastProvider></MemoryRouter></StrictMode>);
    });
    const link = [...container.querySelectorAll('a')].find(a => a.textContent?.includes('Bundle it into a ZIP'));
    expect(link).toBeDefined();
    await act(async () => { link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
    // FileDrop deliberately defers handoff until after parent mount effects.
    for (let i = 0; i < 20 && !container.querySelector('.manifest__row'); i++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    }
    expect(container.querySelector('.manifest__row')?.textContent).toContain('notes.txt');
    await act(async () => { root.unmount(); });
  });

  it('loads JSON into the editor under StrictMode', async () => {
    const file = new File(['{"ok":true}'], 'data.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => '{"ok":true}' });
    setHandoff([file], 'json-formatter');
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<StrictMode><MemoryRouter><ToastProvider><JsonFormatterTool /></ToastProvider></MemoryRouter></StrictMode>);
    });
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="JSON input"]')?.value).toBe('{"ok":true}');
    expect(container.textContent).toContain('Loaded data.json locally');
    await act(async () => { root.unmount(); });
  });

});
