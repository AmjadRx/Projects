import { ExternalLink } from 'lucide-react';
import LinkIcon from '@/components/LinkIcon';
import { loadRepoCard, type RepoCardData } from '@/lib/github-repo';
import { UI } from '@/lib/strings';

const linkClass = 'text-link inline-flex min-h-[44px] items-center [overflow-wrap:anywhere]';

function Card({ card }: { card: RepoCardData }) {
  return (
    <div role="group" aria-label={UI.viewers.repo.repository} className="viewer-frame">
      <div className="flex flex-col gap-2 p-4 md:p-5">
        <p className="flex items-center gap-2.5 text-lg font-medium">
          <span className="shrink-0 text-ink">
            <LinkIcon icon="github" size={20} />
          </span>
          <a href={card.href} rel="noopener noreferrer" className={linkClass}>
            {card.fullName}
          </a>
        </p>
        {card.description && <p className="max-w-[72ch] text-ink-dim">{card.description}</p>}
        {(card.language || card.pushed) && (
          <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
            {card.language && (
              <div className="flex items-baseline gap-2">
                <dt className="text-ink-mute">{UI.viewers.repo.language}</dt>
                <dd className="data text-ink">{card.language}</dd>
              </div>
            )}
            {card.pushed && (
              <div className="flex items-baseline gap-2">
                <dt className="text-ink-mute">{UI.viewers.repo.updated}</dt>
                <dd className="data text-ink">
                  <time dateTime={card.pushed.iso}>{card.pushed.date}</time>
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>
      <div className="viewer-toolbar">
        <a
          href={card.href}
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-sm px-2 text-sm text-accent underline underline-offset-[3px]"
        >
          <ExternalLink size={16} aria-hidden />
          <span>{UI.viewers.repo.open}</span>
        </a>
      </div>
    </div>
  );
}

/**
 * A public GitHub repository (ARCHITECTURE.md 13A, DESIGN_DIRECTION.md 11): its name, description,
 * language, and last update, read at build time and checked like content. Whenever that cannot be
 * done safely (lib/github-repo.ts says when), the block is the plain link. No script runs here.
 */
export default async function RepoCard({ url }: { url: string }) {
  const result = await loadRepoCard(url);
  if (result.kind === 'none') return null;
  if (result.kind === 'link') {
    return (
      <p className="flex items-center gap-2">
        <span className="shrink-0 text-ink-dim">
          {result.github ? <LinkIcon icon="github" size={18} /> : <ExternalLink size={18} aria-hidden />}
        </span>
        <a href={result.href} rel="noopener noreferrer" className={linkClass}>
          {result.text}
        </a>
      </p>
    );
  }
  return <Card card={result.card} />;
}
