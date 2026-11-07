import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Restores where you were when you come back.
 *
 * A router that scrolls to the top on every pathname change is right for a new
 * page and wrong for the one you just left. Scroll the catalogue, open a tool,
 * press Back — you were at the top of a list you had scrolled 2 000px into, and
 * now you have to find your place again. Browsers solve this natively; a
 * single-page app has to do it itself, because the document never actually
 * reloads.
 *
 * Positions are stored per *history entry* (`location.key`), not per pathname, so
 * two visits to `/tools/` from different places restore different offsets, and
 * going Back twice walks back through the list rather than jumping to one shared
 * value. `sessionStorage` is the right store: it is scoped to the tab, survives a
 * reload, and dies with the session.
 */

const KEY = 'zeroupload.scroll';

type Positions = Record<string, number>;

function read(): Positions {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    // A corrupt or foreign value must never break navigation.
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Positions).filter(([, value]) => typeof value === 'number'),
    );
  } catch {
    return {};
  }
}

function write(positions: Positions) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(positions));
  } catch {
    /* storage can be blocked; losing the offset is not worth an exception */
  }
}

/** Keeps the map from growing for the lifetime of a long session. */
function trim(positions: Positions, keep: string): Positions {
  const keys = Object.keys(positions);
  if (keys.length <= 30) return positions;
  const entries = keys.filter((key) => key !== keep).slice(keys.length - 30);
  return Object.fromEntries(entries.map((key) => [key, positions[key]]));
}

export function useScrollRestoration() {
  const location = useLocation();
  const navigation = useNavigationType();
  const previous = useRef<{ key: string } | null>(null);

  useEffect(() => {
    // Save the offset we are leaving *before* anything scrolls the new page.
    const leaving = previous.current;
    if (leaving) {
      const positions = read();
      positions[leaving.key] = window.scrollY;
      write(trim(positions, leaving.key));
    }
    previous.current = { key: location.key };

    if (navigation === 'POP') {
      const saved = read()[location.key];
      // `instant` matters: the page's own smooth-scroll would animate the jump and
      // the user would watch the page slide instead of picking up where they were.
      window.scrollTo({ top: saved ?? 0, behavior: 'instant' as ScrollBehavior });
      return;
    }

    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.key, navigation]);
}
