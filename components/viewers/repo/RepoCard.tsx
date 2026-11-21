import { ArrowUpRight, ExternalLink, Github } from 'lucide-react';
import Icon from '@/components/sheet/Icon';
import { loadRepoCard, type RepoCardData } from '@/lib/github-repo';
import { UI } from '@/lib/strings';

/** The repository's own name, after its owner ("AmjadRx/MoonLight" gives "MoonLight"). */
function repoName(fullName: string): string {
  const slash = fullName.indexOf('/');
  return slash >= 0 ? fullName.slice(slash + 1) : fullName;
}

/**
 * The card (bundle RepoCard, app/sheet.css 26): one link around a glass card with the GitHub
 * glyph, the project's title (or the repository's name), its address in the data type, its
 * description, its language and last update (read at build time), and "Open on GitHub". No stars,
 * forks, or other counts. Hover turns the rule to the line color and moves the arrow; focus draws
 * the ring around the card.
 */
function Card({ card, title }: { card: RepoCardData; title?: string }) {
  const address = card.href.replace(/^https?:\/\//i, '');
  return (
    <a href={card.href} rel="noopener noreferrer" className="ar-repo">
      <span className="ar-repo__icon">
        <Icon icon={Github} size={22} />
      </span>
      <span className="ar-repo__body">
        <span className="ar-repo__title">{title ?? repoName(card.fullName)}</span>
        <span className="ar-repo__name">{address}</span>
        {card.description && <span className="ar-repo__desc">{card.description}</span>}
        {(card.language || card.pushed) && (
          <span className="ar-repo__meta">
            {card.language && (
              <span>
                <span className="ar-repo__key">{UI.viewers.repo.language}</span> {card.language}
              </span>
            )}
            {card.pushed && (
              <span>
                <span className="ar-repo__key">{UI.viewers.repo.updated}</span>{' '}
                <time dateTime={card.pushed.iso}>{card.pushed.date}</time>
              </span>
            )}
          </span>
        )}
      </span>
      <span className="ar-repo__go">
        {UI.viewers.repo.open}
        <Icon icon={ArrowUpRight} size={16} />
      </span>
    </a>
  );
}

/**
 * A public GitHub repository (ARCHITECTURE.md 13A, DESIGN_DIRECTION.md 11): its name, description,
 * language, and last update, read at build time and checked like content. Whenever that cannot be
 * done safely (lib/github-repo.ts says when), the block is the same card with the address alone
 * (a GitHub address), or a plain link (any other address). No script runs here.
 */
export default async function RepoCard({ url, title }: { url: string; title?: string }) {
  const result = await loadRepoCard(url);
  if (result.kind === 'none') return null;
  if (result.kind === 'link') {
    if (result.github) {
      const fullName = result.text.replace(/^github\.com\//i, '');
      return <Card card={{ href: result.href, fullName }} title={title} />;
    }
    return (
      <a href={result.href} rel="noopener noreferrer" className="ar-mv__link">
        <Icon icon={ExternalLink} size={16} />
        <span>{result.text}</span>
      </a>
    );
  }
  return <Card card={result.card} title={title} />;
}
