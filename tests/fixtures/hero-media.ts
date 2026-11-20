import type { ResolvedMedia } from '@/lib/media';

/**
 * A hero model as the server resolves it (components/home/hero/HeroModel.tsx heroModelMedia): a
 * GLB with a 4:3 poster. Made up for the tests; no file stands behind it.
 */
export const HERO_MEDIA: ResolvedMedia = {
  kind: 'model',
  file: { src: '/media/site/hero.glb', name: 'hero.glb', ext: 'glb', typeLabel: '3D model', downloadHref: '' },
  alt: 'A test aircraft with two wing rotors',
  poster: { src: '/media/site/hero-poster.webp', width: 1600, height: 1200 },
  width: 1600,
  height: 1200,
  store: 'repo',
};
