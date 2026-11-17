/**
 * What counts as an empty block. A field left empty leaves no trace (ARCHITECTURE.md 15, item
 * 2), so the renderer skips a block with nothing to show before it prints the block's wrapper,
 * and an empty heading block does not shift the levels of the headings after it.
 */
import { hasText } from './format';
import { pointsIntoRepository } from './lint';
import { isSafeMediaSrc, parseEmbed } from './media';
import { isKnownBlock } from './schema';
import type { KnownBlock, MediaRef } from './types';

/** A reference with a file the site may show: a site path or https, and for an embed a YouTube or Vimeo video. */
export function hasShowableFile(media: MediaRef | undefined | null): boolean {
  if (!media || !hasText(media.src) || !isSafeMediaSrc(media.src)) return false;
  return media.kind !== 'embed' || parseEmbed(media.src.trim()) !== null;
}

/** False when a block has nothing to show. `siteRepository` is GITHUB_REPO, which is never linked. */
export function blockHasContent(block: KnownBlock, siteRepository?: string): boolean {
  switch (block.type) {
    case 'heading':
      return hasText(block.text);
    case 'text':
    case 'callout':
      return hasText(block.md);
    case 'quote':
      return hasText(block.text);
    case 'image':
    case 'video':
    case 'model3d':
    case 'document':
    case 'audio':
    case 'panzoom':
      return hasShowableFile(block.media);
    case 'gallery':
      return block.items.some(hasShowableFile);
    case 'compare':
      return hasShowableFile(block.before) && hasShowableFile(block.after);
    case 'file':
      return hasText(block.src) && isSafeMediaSrc(block.src);
    case 'specTable':
      return block.rows.some((row) => hasText(row.label) || hasText(row.value));
    case 'bullets':
      return block.items.some(hasText);
    case 'linkRow':
      return block.links.some((link) => hasText(link.label));
    case 'roadmap':
      return block.stages.length > 0;
    case 'log':
      return block.entries.length > 0;
    case 'code':
      return hasText(block.code);
    case 'repo':
      return hasText(block.url) && !pointsIntoRepository(block.url, siteRepository);
    case 'twoCol':
      return [...block.left, ...block.right].some((child) => isKnownBlock(child) && blockHasContent(child, siteRepository));
    default:
      return false;
  }
}
