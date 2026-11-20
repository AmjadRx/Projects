/**
 * A project page's gallery as the page names it (components/viewers/image/Gallery.tsx), for the
 * tests that open its lightbox (keyboard.spec.ts, palette.spec.ts):
 * - the gallery is a region named by the heading it sits under, as Project.dc.html names each
 *   gallery, or "Gallery" when no heading stands before it;
 * - each item is a button named by its kind, in the bundle Gallery's words ("Open photo 1 of 3",
 *   "Open video 2 of 3", "Open 3D model", and "Open photo" when it is the only item), after the
 *   picture's alt text when it has one;
 * - the lightbox is a dialog named "Gallery" (UI.viewers.gallery.label).
 */
import { UI } from '../../../lib/strings';
import { projects } from './site';

/**
 * The name of the first gallery on a project page: the heading it sits under, as
 * components/blocks/BlockRenderer.tsx gives it, or "Gallery" with no heading before it.
 */
export function galleryName(path: string): string {
  const project = projects.find((p) => `/projects/${p.slug}` === path);
  let heading = '';
  for (const block of (project?.blocks ?? []) as { type?: unknown; text?: unknown; items?: unknown }[]) {
    if (block.type === 'heading' && typeof block.text === 'string' && block.text.trim() !== '') heading = block.text;
    const shown = (item: { src?: unknown } | null) => typeof item?.src === 'string' && item.src.trim() !== '';
    if (block.type === 'gallery' && Array.isArray(block.items) && block.items.some(shown)) return heading || UI.viewers.gallery.label;
  }
  return UI.viewers.gallery.label;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The first item's button, whatever its kind and however many items the gallery holds: the words
 * of UI.viewers.gallery.open for item 1, alone ("Open photo") or of any count ("Open photo 1 of
 * 3"), at the end of the name.
 */
export const FIRST_ITEM = new RegExp(
  `(?:${(['image', 'video', 'model'] as const)
    .flatMap((kind) => [
      escapeRegExp(UI.viewers.gallery.open(kind, 1, 1)),
      escapeRegExp(UI.viewers.gallery.open(kind, 1, 2)).replace(/2$/, '\\d+'),
    ])
    .join('|')})$`,
);
