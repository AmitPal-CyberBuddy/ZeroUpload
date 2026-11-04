import { useEffect, useState } from 'react';

/**
 * Creates and revokes object URLs automatically. Every preview in the app goes
 * through this hook so a long session cannot leak blob references.
 */
export function useObjectUrl(source: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!source) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(source);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [source]);

  return url;
}
