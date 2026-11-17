import { ExternalLink } from 'lucide-react';
import { Fragment, type CSSProperties } from 'react';
import LinkIcon from '@/components/LinkIcon';
import { isSiteRepository } from '@/lib/github-repo';
import { highlightCode, type CodeToken } from '@/lib/highlight';
import { UI } from '@/lib/strings';
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
 * A code snippet (ARCHITECTURE.md 13A, DESIGN_DIRECTION.md 11): highlighted while the page is
 * prerendered, so no highlighter reaches the browser; the only script is the copy button. Long
 * lines scroll sideways inside the well, which takes keyboard focus so arrow keys can scroll it.
 * The caption names the language; a language the highlighter lacks is shown as plain text.
 */
export default async function CodeBlock({ language, code, repoUrl }: { language: string; code: string; repoUrl?: string }) {
  const result = await highlightCode(code, language);
  const repository = repositoryLink(repoUrl);

  return (
    <figure className="viewer-frame" data-code-block="">
      <div className={styles.well}>
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
      <div className="viewer-toolbar">
        <div className="viewer-toolbar__controls">
          <CopyButton />
        </div>
        {repository && (
          <a
            href={repository.href}
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-sm px-2 text-sm text-accent underline underline-offset-[3px]"
          >
            {repository.github ? <LinkIcon icon="github" size={16} /> : <ExternalLink size={16} aria-hidden />}
            <span>{UI.viewers.code.repository}</span>
          </a>
        )}
      </div>
      {result.languageName !== '' && (
        <figcaption className="viewer-caption">
          <span className="viewer-caption__text">{result.languageName}</span>
        </figcaption>
      )}
    </figure>
  );
}
