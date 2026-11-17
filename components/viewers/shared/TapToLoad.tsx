'use client';

import { Play } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The button over a poster that loads a viewer's engine when the viewer waits for a tap
 * (phones, tablets, or a slow connection). It is a real button: Enter and Space work.
 */
export default function TapToLoad({
  label,
  onActivate,
  icon,
}: {
  label: string;
  onActivate: () => void;
  icon?: ReactNode;
}) {
  return (
    <div className="viewer-tap">
      <button type="button" className="viewer-tap__button" onClick={onActivate}>
        {icon ?? <Play size={18} aria-hidden />}
        <span>{label}</span>
      </button>
    </div>
  );
}
