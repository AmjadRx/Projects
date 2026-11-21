'use client';

import dynamic from 'next/dynamic';

/**
 * The hero model's viewer (HeroModelViewer.tsx) behind a dynamic import, for the server component
 * components/home/hero/HeroModel.tsx. Only this small file is in the home page's first load: the
 * viewer's shell and everything it imports load as a chunk of their own, and only when the hero
 * renders a model, so a home page whose hero is the drawing or a photo never downloads them
 * (ARCHITECTURE.md 9).
 *
 * The import has to sit in a client file. Next bundles a server component's client imports into
 * the route's first load, a dynamic import() included, so the same call in HeroModel.tsx split
 * nothing.
 *
 * The viewer still renders on the server, so its poster is in the HTML and the viewer hydrates
 * when its chunk arrives. On a client-side visit to the home page the stage's box holds its place
 * while the chunk loads.
 */
const HeroModelLazy = dynamic(() => import('./HeroModelViewer'), {
  loading: () => (
    <div className="hm-model" aria-hidden="true">
      <div className="hm-model__stage" />
    </div>
  ),
});

export default HeroModelLazy;
