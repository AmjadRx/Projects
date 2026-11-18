import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import Icon from './Icon';

/**
 * A media well with nothing to show (bundle Placeholder, bundle.css 10), on the sheet with the
 * drawing grid; never a stock picture, a gradient, or the browser's broken-image icon.
 * - empty: no file yet. The crosshair and one line ("Photo to come"). Render it for an empty
 *   `cover.src`.
 * - loading: the grid alone at the media's final size, so nothing shifts; after 600 ms a 2 px line
 *   runs along its foot (not drawn under reduced motion).
 * - error: the file did not load. The image-off mark, the line, the content's alt text when it
 *   has one, and Try again when `onRetry` is given (never inside a link, such as a card).
 * `size="sm"` (wells under 200 px wide) keeps the mark and moves the words to screen readers.
 *
 * It fills its parent, which sets the size (an .ar-well). The words come from the caller
 * (lib/strings.ts on the server), so client components can use it too.
 */
export default function Placeholder({
  state = 'empty',
  text,
  size = 'md',
  alt = '',
  onRetry,
  retryLabel,
}: {
  state?: 'empty' | 'loading' | 'error';
  /** The line: "Photo to come", "Loading photo", or "Photo did not load". */
  text: string;
  size?: 'md' | 'sm';
  /** The media's alt text, shown in the error state. */
  alt?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const small = size === 'sm';
  const label = state === 'error' && alt ? `${text}: ${alt}` : text;
  // With Try again the well is a group of real text and a button; otherwise it is one image.
  const live = state === 'error' && !!onRetry && !!retryLabel && !small;
  return (
    <div
      className={cn('ar-ph', 'ar-grid', small && 'ar-ph--sm', state !== 'empty' && `ar-ph--${state}`)}
      role={live ? 'group' : 'img'}
      aria-label={live ? undefined : label}
      aria-busy={state === 'loading' ? true : undefined}
    >
      {state === 'empty' ? (
        <svg
          className="ar-ph__cross"
          width={small ? 32 : 56}
          height={small ? 32 : 56}
          viewBox="0 0 56 56"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          aria-hidden="true"
          focusable="false"
        >
          <line x1="0" y1="28" x2="20" y2="28" />
          <line x1="36" y1="28" x2="56" y2="28" />
          <line x1="28" y1="0" x2="28" y2="20" />
          <line x1="28" y1="36" x2="28" y2="56" />
          <circle cx="28" cy="28" r="5" />
        </svg>
      ) : null}
      {state === 'error' ? (
        <span className="ar-ph__icon" aria-hidden="true">
          <Icon icon={ImageOff} size={small ? 20 : 28} />
        </span>
      ) : null}
      {state !== 'loading' ? (
        <p className="ar-ph__text" aria-hidden={live ? undefined : true}>
          {text}
        </p>
      ) : null}
      {state === 'error' && alt && !small ? (
        <p className="ar-ph__alt" aria-hidden={live ? undefined : true}>
          {alt}
        </p>
      ) : null}
      {live ? (
        <button type="button" className="ar-ph__retry" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
      {state === 'loading' ? <span className="ar-ph__bar" aria-hidden="true" /> : null}
    </div>
  );
}
