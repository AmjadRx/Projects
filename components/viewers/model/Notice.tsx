'use client';

import { useEffect } from 'react';

/** A short line on a plate over the poster: why the engine is not running. */
export default function Notice({ text, onShown }: { text: string; onShown?: () => void }) {
  useEffect(() => {
    onShown?.();
  }, [onShown]);
  return (
    <p role="status" className="ar-mv__note">
      {text}
    </p>
  );
}
