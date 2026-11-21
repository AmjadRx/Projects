import type { ReactNode } from 'react';
import HeroModelLazy from '@/components/viewers/model/HeroModelLazy';
import type { ResolvedMedia } from '@/lib/media';
import { resolveMedia } from '@/lib/media-server';
import { UI } from '@/lib/strings';
import type { Site } from '@/lib/types';

/**
 * The hero's model, resolved on the server: `settings.heroModel` when it names a model file the
 * site can serve, or null when it has no file. The client gets this small object, never the
 * content record.
 */
export function heroModelMedia(model: Site['settings']['heroModel']): ResolvedMedia | null {
  const media = resolveMedia(model);
  return media && media.kind === 'model' ? media : null;
}

/**
 * The hero visual in mode "model" (ARCHITECTURE.md 6; DESIGN_DIRECTION.md 6.1 "The realistic
 * hero"): the owner's own 3D model in front of the sky, captioned as the drawing is, since its
 * Thermal view and lens are illustrations. With no model file it renders `fallback` (the hero's
 * drawing) and nothing of its own.
 *
 * The viewer (components/viewers/model/HeroModelViewer.tsx) comes through HeroModelLazy.tsx, a
 * client file holding its dynamic import: a dynamic import here, in a server component, would put
 * the viewer in the home page's first load in every hero mode.
 */
export default function HeroModel({ model, fallback }: { model: Site['settings']['heroModel']; fallback: ReactNode }) {
  const media = heroModelMedia(model);
  if (!media) return <>{fallback}</>;
  // The drawing (the fallback) brings its own figure.hm-hero__art; the model gets the same slot here.
  return (
    <div className="hm-hero__art">
      <HeroModelLazy media={media} caption={UI.heroCaption} />
    </div>
  );
}
