import { useEffect, useState } from 'react';

/**
 * False on the first render, true after mount.
 *
 * This is the primitive that lets a prerendered document hydrate without a
 * mismatch. The server cannot mount a tool workspace — it has no file picker,
 * no worker and no DOM — so it emits a placeholder. If the client's *first*
 * render mounts the real tool, React has a server tree and a client tree that
 * disagree, and it throws the hydration away rather than diffing it.
 *
 * Rendering the same placeholder on the first client pass, then swapping to the
 * real thing in an effect, makes both sides agree byte for byte. The swap happens
 * in the same frame as hydration, and the tool's chunk is already being fetched
 * by then (cards warm it on pointer-over), so the cost is not a visible delay —
 * it is one extra render of a static `<div>`.
 *
 * `setHydrated(true)` in an effect is intentional rather than a layout effect:
 * the placeholder is what the user sees for that frame, which is exactly what
 * the prerendered HTML shows them.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
