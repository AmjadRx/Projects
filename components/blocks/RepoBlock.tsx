import RepoCard from '@/components/viewers/repo/RepoCard';
import { hasText } from '@/lib/format';

/**
 * A repository card. `title` is the project the repository belongs to (the block context's label),
 * which the bundle's card prints first; without it the card leads with the repository's name.
 */
export default function RepoBlock({ url, title }: { url: string; title?: string }) {
  if (!hasText(url)) return null;
  return <RepoCard url={url.trim()} title={hasText(title) ? title : undefined} />;
}
