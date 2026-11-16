import { useEffect, useState } from 'react';

/**
 * A copy of `value` that trails it by `delay` ms of quiet.
 *
 * Two tools transform whatever is in a textarea on every keystroke, and one of
 * them (Base64) measured 548 ms for a 10 MB paste. React's `useDeferredValue`
 * would keep the *input* responsive, but it schedules the transform at whatever
 * priority the render loop has free and offers no guarantee about how often it
 * runs. A debounce gives a property that can be stated and tested: N keystrokes
 * inside the window produce one transform, and it is the transform of the value
 * the user stopped typing on.
 *
 * The first value is applied immediately rather than after a delay, so a page
 * that opens with a default string does not flash empty for 150 ms.
 */
export function useDebouncedValue<T>(value: T, delay = 150): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (Object.is(value, settled)) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
    // `settled` is deliberately not a dependency: including it would re-arm the
    // timer when the debounced value lands and delay it a second time.
  }, [value, delay]);

  return settled;
}
