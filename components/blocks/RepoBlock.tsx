import RepoCard from '@/components/viewers/repo/RepoCard';
import { hasText } from '@/lib/format';

export default function RepoBlock({ url }: { url: string }) {
  if (!hasText(url)) return null;
  return <RepoCard url={url.trim()} />;
}
