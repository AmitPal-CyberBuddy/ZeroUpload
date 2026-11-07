import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../src/hooks/useToast';

/**
 * A minimal harness: mount a tree with the same providers the app uses, wait for
 * lazy modules and effects, and collect anything React complained about.
 *
 * React reports nearly every real mistake — invalid nesting, key problems,
 * updates outside `act`, a component that throws during render — through
 * `console.error`, so capturing that channel is a far better signal than
 * asserting on markup. The tests assert "no errors were logged", which is the
 * cheapest possible definition of "this mounts cleanly".
 */

export interface Rendered {
  container: HTMLElement;
  html: string;
  errors: string[];
  unmount: () => Promise<void>;
}

/** Let pending lazy imports and effects settle. */
async function flush(rounds = 3) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

export async function render(node: ReactNode, { route = '/' }: { route?: string } = {}): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const errors: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;

  // React logs through console.error; a real thrown error also reaches it.
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    const text = args.map(String).join(' ');
    // act() environment warnings are noise from the harness itself.
    if (text.includes('not wrapped in act')) return;
    errors.push(`warn: ${text}`);
  };

  let root: Root | undefined;
  try {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <MemoryRouter initialEntries={[route]}>
          <ToastProvider>{node}</ToastProvider>
        </MemoryRouter>,
      );
    });
    await flush();
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }

  const activeRoot = root;
  return {
    container,
    html: container.innerHTML,
    errors,
    unmount: async () => {
      await act(async () => {
        activeRoot?.unmount();
      });
      container.remove();
    },
  };
}

/** Render a single routed component at a path. */
export function at(path: string, element: ReactNode): ReactNode {
  return (
    <Routes>
      <Route path={path} element={element} />
    </Routes>
  );
}
