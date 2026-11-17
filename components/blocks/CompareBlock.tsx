import Compare from '@/components/viewers/compare/Compare';
import { resolveMedia } from '@/lib/media-server';
import type { MediaRef } from '@/lib/types';

/** Before and after need both photos; with either one missing, the block shows nothing. */
export default function CompareBlock({ before, after }: { before: MediaRef; after: MediaRef }) {
  const b = resolveMedia(before);
  const a = resolveMedia(after);
  if (!b || !a) return null;
  return <Compare before={b} after={a} />;
}
