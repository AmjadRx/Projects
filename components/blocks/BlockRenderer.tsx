import ReactMarkdown from 'react-markdown';
import type { Block, BlockState, LogEntry, MediaRef, ProjectLink } from '@/lib/types';
import MediaView from '@/components/MediaView';
import LinkButton from '@/components/LinkButton';
import Reveal from '@/components/Reveal';
import Gallery from './Gallery';
import { cn } from '@/lib/utils';

function Markdown({ md }: { md: string }) {
  return (
    <div className="prose-md">
      <ReactMarkdown>{md}</ReactMarkdown>
    </div>
  );
}

function RoadmapBlock({ stages }: { stages: { n: number; title: string; desc: string; status: BlockState }[] }) {
  const style: Record<BlockState, { dot: string; label: string }> = {
    done: { dot: 'bg-accent/50', label: 'Done' },
    'in-progress': { dot: 'bg-accent', label: 'In progress' },
    next: { dot: 'bg-accent-2', label: 'Next' },
    future: { dot: 'bg-ink-mute/40', label: 'Future' },
  };
  return (
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stages.map((stage) => (
        <li
          key={stage.n}
          className={cn('card p-4', stage.status === 'in-progress' && 'border-accent/50')}
          style={
            stage.status === 'in-progress'
              ? { background: 'rgb(var(--accent) / 0.05)' }
              : undefined
          }
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-ink-mute">
              {String(stage.n).padStart(2, '0')}
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-mute">
              <span className={cn('h-1.5 w-1.5 rounded-full', style[stage.status].dot)} aria-hidden />
              {style[stage.status].label}
            </span>
          </div>
          <h4 className="mt-2.5 text-sm font-semibold leading-snug text-ink">{stage.title}</h4>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">{stage.desc}</p>
        </li>
      ))}
    </ol>
  );
}

function LogBlock({ entries }: { entries: LogEntry[] }) {
  return (
    <div className="flex flex-col gap-6">
      {entries.map((entry) => (
        <article
          key={entry.date + entry.title}
          id={entry.date}
          className="scroll-mt-24 border-l-2 pl-5"
          style={{ borderColor: 'rgb(var(--accent) / 0.4)' }}
        >
          <a href={`#${entry.date}`} className="kicker text-accent hover:underline">
            {entry.date}
          </a>
          <h4 className="mt-1.5 text-base font-semibold text-ink">{entry.title}</h4>
          <div className="mt-2 text-sm">
            <Markdown md={entry.md} />
          </div>
          {entry.media && entry.media.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
              {entry.media.map((m, i) => (
                <div
                  key={i}
                  className="relative aspect-[4/3] overflow-hidden rounded-sm"
                  style={{ border: '1px solid var(--line)' }}
                >
                  <MediaView media={m} placeholderLabel={m.alt} sizes="33vw" />
                </div>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function renderBlock(block: Block, slug: string): React.ReactNode {
  switch (block.type) {
    case 'heading':
      return <h2 className="display-3 pt-6">{(block as { text: string }).text}</h2>;
    case 'text':
      return <Markdown md={(block as { md: string }).md} />;
    case 'image': {
      const media = (block as { media: MediaRef }).media;
      return (
        <figure>
          <div
            className="relative aspect-[16/10] w-full overflow-hidden rounded-md"
            style={{ border: '1px solid var(--line)' }}
          >
            <MediaView media={media} placeholderLabel={media.alt || slug} sizes="760px" />
          </div>
          {media.caption && (
            <figcaption className="mt-2.5 text-center text-sm text-ink-mute">
              {media.caption}
            </figcaption>
          )}
        </figure>
      );
    }
    case 'gallery':
      return <Gallery items={(block as { items: MediaRef[] }).items} />;
    case 'video': {
      const media = (block as { media: MediaRef }).media;
      return (
        <div
          className="relative w-full overflow-hidden rounded-md"
          style={{ border: '1px solid var(--line)' }}
        >
          <MediaView media={media} placeholderLabel="Video" />
        </div>
      );
    }
    case 'specTable': {
      const rows = (block as { rows: { label: string; value: string }[] }).rows;
      return (
        <dl className="card overflow-hidden">
          {rows.map((row, i) => (
            <div
              key={row.label}
              className="grid grid-cols-1 gap-1 px-5 py-3.5 sm:grid-cols-[200px_1fr] sm:gap-6"
              style={i > 0 ? { borderTop: '1px solid var(--line)' } : undefined}
            >
              <dt className="kicker pt-0.5">{row.label}</dt>
              <dd className="text-sm leading-relaxed text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      );
    }
    case 'bullets': {
      const b = block as { heading?: string; items: string[] };
      return (
        <div>
          {b.heading && <h3 className="mb-4 text-lg font-semibold text-ink">{b.heading}</h3>}
          <ul className="flex flex-col gap-2.5">
            {b.items.map((item, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink-dim">
                <span className="mt-[11px] h-px w-4 shrink-0 bg-accent/60" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'twoCol': {
      const b = block as { left: Block[]; right: Block[] };
      return (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-6">{b.left.map((child) => (
            <div key={child.id}>{renderBlock(child, slug)}</div>
          ))}</div>
          <div className="flex flex-col gap-6">{b.right.map((child) => (
            <div key={child.id}>{renderBlock(child, slug)}</div>
          ))}</div>
        </div>
      );
    }
    case 'quote': {
      const b = block as { text: string; attribution?: string };
      return (
        <blockquote className="border-l-2 py-1 pl-6" style={{ borderColor: 'rgb(var(--accent))' }}>
          <p className="display-3 !font-medium text-ink">{b.text}</p>
          {b.attribution && <cite className="kicker mt-3 block not-italic">{b.attribution}</cite>}
        </blockquote>
      );
    }
    case 'linkRow': {
      const links = (block as { links: ProjectLink[] }).links;
      return (
        <div className="flex flex-wrap gap-2.5">
          {links.map((link) => (
            <LinkButton key={link.url} {...link} />
          ))}
        </div>
      );
    }
    case 'roadmap':
      return <RoadmapBlock stages={(block as { stages: { n: number; title: string; desc: string; status: BlockState }[] }).stages} />;
    case 'log':
      return <LogBlock entries={(block as { entries: LogEntry[] }).entries} />;
    default:
      // Unknown block types render nothing (forward compatibility).
      return null;
  }
}

export default function BlockRenderer({ blocks, slug }: { blocks: Block[]; slug: string }) {
  return (
    <div className="flex flex-col gap-10">
      {blocks.map((block) => {
        const rendered = renderBlock(block, slug);
        if (!rendered) return null;
        return <Reveal key={block.id}>{rendered}</Reveal>;
      })}
    </div>
  );
}
