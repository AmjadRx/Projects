'use client';

import { Play } from 'lucide-react';
import type { ReactNode } from 'react';
import Icon from '@/components/sheet/Icon';

/**
 * The button over a poster that loads a viewer's engine when the viewer waits for a tap
 * (phones, tablets, or a slow connection): the bundle's text button on a night plate in the middle
 * of the well ("Open 3D model"). It is a real button: Enter and Space work.
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
    <span className="ar-mv__play">
      <button type="button" className="ar-mv__btn ar-mv__btn--text" onClick={onActivate}>
        {icon ?? <Icon icon={Play} size={18} />}
        <span>{label}</span>
      </button>
    </span>
  );
}
