import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useRouteFocus } from '../../src/hooks/useRouteFocus';

function Harness() {
  useRouteFocus();
  return <><Link to="/next">Next</Link><Routes>
    <Route path="/" element={<main id="main"><h1>Home</h1></main>} />
    <Route path="/next" element={<main id="main"><h1>Next page</h1></main>} />
  </Routes></>;
}

describe('route focus behavior', () => {
  it('does not move focus on a StrictMode mount, but announces a real route change', async () => {
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<StrictMode><MemoryRouter><Harness /></MemoryRouter></StrictMode>); });
    expect(document.activeElement).not.toBe(container.querySelector('h1'));
    await act(async () => { container.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(container.querySelector('h1'));
    expect(container.querySelector('h1')?.textContent).toBe('Next page');
    await act(async () => { root.unmount(); });
  });
});

it('focuses a lazy destination after its loading fallback disappears', async () => {
  let resolve!: (value: { default: () => React.JSX.Element }) => void;
  const { lazy, Suspense } = await import('react');
  const LazyPage = lazy(() => new Promise<{ default: () => React.JSX.Element }>(r => { resolve = r; }));
  function LazyHarness() {
    useRouteFocus();
    return <><Link to="/lazy">Open lazy page</Link><Routes>
      <Route path="/" element={<main id="main"><h1>Home</h1></main>} />
      <Route path="/lazy" element={<Suspense fallback={<div role="status">Loading</div>}><LazyPage /></Suspense>} />
    </Routes></>;
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><LazyHarness /></MemoryRouter>));
  await act(async () => container.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  await act(async () => { resolve({ default: () => <main id="main"><h1>Lazy page</h1></main> }); await Promise.resolve(); });
  expect(document.activeElement).toBe(container.querySelector('h1'));
  await act(async () => root.unmount());
});

it('does not steal focus if the user chooses another control while loading', async () => {
  let resolve!: (value: { default: () => React.JSX.Element }) => void;
  const { lazy, Suspense } = await import('react');
  const LazyPage = lazy(() => new Promise<{ default: () => React.JSX.Element }>(r => { resolve = r; }));
  function LazyHarness() {
    useRouteFocus();
    return <><Link to="/lazy">Open lazy page</Link><button>Stay here</button><Routes>
      <Route path="/" element={<main id="main"><h1>Home</h1></main>} />
      <Route path="/lazy" element={<Suspense fallback={<div role="status">Loading</div>}><LazyPage /></Suspense>} />
    </Routes></>;
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><LazyHarness /></MemoryRouter>));
  await act(async () => container.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await act(async () => container.querySelector('button')!.focus());
  await act(async () => { resolve({ default: () => <main id="main"><h1>Lazy page</h1></main> }); await Promise.resolve(); });
  expect(document.activeElement).toBe(container.querySelector('button'));
  await act(async () => root.unmount());
});
