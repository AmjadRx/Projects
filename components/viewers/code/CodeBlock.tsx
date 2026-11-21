import { ArrowUpRight, ExternalLink, Github } from 'lucide-react';
import { Fragment, type CSSProperties } from 'react';
import Icon from '@/components/sheet/Icon';
import { isSiteRepository } from '@/lib/github-repo';
import { highlightCode, type CodeToken } from '@/lib/highlight';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import styles from './CodeBlock.module.css';
import CopyButton from './CopyButton';

/** The repository link: only an https address, and never the site's own repository. */
function repositoryLink(raw: string | undefined): { href: string; github: boolean } | null {
  if (!raw || raw.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || isSiteRepository(url.href)) return null;
  return { href: url.href, github: url.hostname === 'github.com' || url.hostname === 'www.github.com' };
}

function tokenStyle(token: CodeToken): CSSProperties | undefined {
  if (!token.color && !token.italic && !token.bold && !token.underline && !token.strike) return undefined;
  const decoration = [token.underline ? 'underline' : '', token.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  return {
    color: token.color,
    fontStyle: token.italic ? 'italic' : undefined,
    fontWeight: token.bold ? 700 : undefined,
    textDecoration: decoration || undefined,
  };
}

/**
 * A code snippet (bundle CodeBlock; ARCHITECTURE.md 13A): B612 Mono 13 px on night in the media
 * frame, highlighted while the page is prerendered, so no highlighter reaches the browser; the
 * only script is the copy button. The highlighting uses the night's inks only (keywords in the
 * night's line color, text in on-night, comments in on-night-dim; never the thermal ramp). The bar
 * holds Copy and the repository link; the caption line names the kind and the language. Long
 * lines scroll sideways and a long snippet scrolls inside the well, which takes keyboard focus so
 * the arrow keys can scroll it. A language the highlighter lacks is shown as plain text.
 */
export default async function CodeBlock({ language, code, repoUrl }: { language: string; code: string; repoUrl?: string }) {
  const result = await highlightCode(code, language);
  const repository = repositoryLink(repoUrl);

  return (
    <figure className="ar-mv" data-code-block="">
      <div className={cn('ar-mv__well', styles.well)}>
        <pre className={styles.pre} tabIndex={0} translate="no" data-language={result.lang}>
          <code>
            {result.lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 ? '\n' : null}
                <span>
                  {line.map((token, j) => {
                    const style = tokenStyle(token);
                    return style ? (
                      <span key={j} style={style}>
                        {token.text}
                      </span>
                    ) : (
                      <Fragment key={j}>{token.text}</Fragment>
                    );
                  })}
                </span>
              </Fragment>
            ))}
          </code>
        </pre>
      </div>
      <div className="ar-mv__bar">
        <CopyButton />
        {repository && (
          <a href={repository.href} rel="noopener noreferrer" className="ar-mv__link">
            <Icon icon={repository.github ? Github : ExternalLink} size={16} />
            <span>{UI.viewers.code.repository}</span>
            <Icon icon={ArrowUpRight} size={16} />
          </a>
        )}
      </div>
      <figcaption className="ar-mv__cap">
        <span className="ar-mv__kind">{UI.viewers.kind.code}</span>
        {result.languageName !== '' && <span className="ar-mv__text">{result.languageName}</span>}
      </figcaption>
    </figure>
  );
}
