export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Map a URL to an icon id used by <LinkIcon>. */
export function detectIcon(url: string): string {
  if (url.startsWith('mailto:')) return 'mail';
  if (url.startsWith('tel:')) return 'phone';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('github.com')) return 'github';
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host === 'x.com' || host.includes('twitter.com')) return 'x';
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('devpost.com')) return 'devpost';
    if (
      host.includes('calendly.com') ||
      host === 'cal.com' ||
      host.endsWith('.cal.com') ||
      host.includes('calendar.google.com') ||
      host.includes('calendar.app.google')
    ) {
      return 'calendar';
    }
    if (host.includes('meet.google.com') || host.includes('zoom.us') || host.includes('teams.microsoft.com')) {
      return 'video';
    }
    if (url.match(/\.pdf($|\?)/) || host.includes('docs.google')) return 'file';
  } catch {
    if (url.match(/\.pdf($|\?)/)) return 'file';
  }
  return 'globe';
}

/** Parse a YouTube/Vimeo URL into an embeddable iframe src, or null. */
export function embedSrc(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (host.includes('youtube.com')) {
      const id = u.searchParams.get('v') || u.pathname.split('/').pop();
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (host.includes('vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

export const EASE = [0.22, 1, 0.36, 1] as const;
