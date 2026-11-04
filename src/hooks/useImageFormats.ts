import { useEffect, useState } from 'react';
import { supportedEncoders } from '../lib/image/capabilities';
import type { ImageFormat } from '../lib/image/types';

let cached: ImageFormat[] | null = null;
let inflight: Promise<ImageFormat[]> | null = null;

/** Encoders this browser can actually produce (AVIF is the usual casualty). */
export function useImageFormats(): { formats: ImageFormat[]; ready: boolean } {
  const [formats, setFormats] = useState<ImageFormat[]>(cached ?? []);
  const [ready, setReady] = useState(!!cached);

  useEffect(() => {
    let active = true;
    if (cached) return;
    inflight ??= supportedEncoders();
    inflight.then((list) => {
      cached = list;
      if (!active) return;
      setFormats(list);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  return { formats, ready };
}
