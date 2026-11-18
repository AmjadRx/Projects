import type { ReactNode } from 'react';
import { blockHasContent } from '@/lib/blocks';
import { isKnownBlock } from '@/lib/schema';
import { siteRepository } from '@/lib/site';
import type { Block } from '@/lib/types';
import AudioBlock from './AudioBlock';
import BulletsBlock from './BulletsBlock';
import CalloutBlock from './CalloutBlock';
import CodeSnippetBlock from './CodeSnippetBlock';
import CompareBlock from './CompareBlock';
import { deeper, type BlockContext } from './context';
import DocumentBlock from './DocumentBlock';
import FileBlock from './FileBlock';
import GalleryBlock from './GalleryBlock';
import HeadingBlock from './HeadingBlock';
import ImageBlock from './ImageBlock';
import LinkRowBlock from './LinkRowBlock';
import LogBlock from './LogBlock';
import Model3dBlock from './Model3dBlock';
import PanzoomBlock from './PanzoomBlock';
import QuoteBlock from './QuoteBlock';
import RepoBlock from './RepoBlock';
import RoadmapBlock from './RoadmapBlock';
import SpecTableBlock from './SpecTableBlock';
import TextBlock from './TextBlock';
import VideoBlock from './VideoBlock';

/**
 * Renders a list of blocks in order, in the project body's column (the canvas's pj-blocks: 24 px
 * between blocks, a heading block 32 px more above it). A block of an unknown type renders
 * nothing and never throws (ARCHITECTURE.md 4), and a block with nothing to show renders nothing
 * at all, not even its wrapper (lib/blocks.ts). Heading levels come from what precedes each block:
 * a `heading` block sits at `ctx.level`, and a list heading after it one level deeper
 * (docs/V3_PLAN.md D-67). A spec table is named for screen readers by the heading before it, or by
 * `ctx.label` (the project's title) when none precedes it.
 */
export default function BlockRenderer({ blocks, ctx }: { blocks: Block[]; ctx: BlockContext }) {
  let headingSeen = false;
  let lastHeading = '';
  const out: ReactNode[] = [];
  const repository = siteRepository();

  blocks.forEach((block, index) => {
    if (!isKnownBlock(block)) return;
    if (!blockHasContent(block, repository)) return;
    const key = `${block.id}-${index}`;
    const wrap = (node: ReactNode, className?: string) => (
      <div key={key} id={`${ctx.idPrefix}${block.id}`} className={className} data-block={block.type}>
        {node}
      </div>
    );

    switch (block.type) {
      case 'heading':
        headingSeen = true;
        lastHeading = block.text;
        out.push(<HeadingBlock key={key} id={block.id} text={block.text} ctx={ctx} />);
        return;
      case 'text':
        out.push(wrap(<TextBlock md={block.md} ctx={ctx} />));
        return;
      case 'image':
        out.push(wrap(<ImageBlock media={block.media} />));
        return;
      case 'gallery':
        out.push(wrap(<GalleryBlock items={block.items} />));
        return;
      case 'video':
        out.push(wrap(<VideoBlock media={block.media} scrub={block.scrub} />));
        return;
      case 'specTable':
        out.push(wrap(<SpecTableBlock rows={block.rows} caption={lastHeading || ctx.label} />));
        return;
      case 'bullets':
        out.push(
          wrap(
            <BulletsBlock
              heading={block.heading}
              items={block.items}
              headingLevel={headingSeen ? deeper(ctx.level) : ctx.level}
              ctx={ctx}
            />,
          ),
        );
        return;
      case 'twoCol': {
        const columnCtx = { ...ctx, level: headingSeen ? deeper(ctx.level) : ctx.level };
        out.push(
          wrap(
            <div className="pj-two">
              <BlockRenderer blocks={block.left} ctx={columnCtx} />
              <BlockRenderer blocks={block.right} ctx={columnCtx} />
            </div>,
          ),
        );
        return;
      }
      case 'quote':
        out.push(wrap(<QuoteBlock text={block.text} attribution={block.attribution} />));
        return;
      case 'linkRow':
        out.push(wrap(<LinkRowBlock links={block.links} ctx={ctx} />));
        return;
      case 'roadmap':
        out.push(wrap(<RoadmapBlock stages={block.stages} label={ctx.label} />, 'pj-road'));
        return;
      case 'log':
        out.push(wrap(<LogBlock id={block.id} entries={block.entries} ctx={ctx} />, 'pj-log'));
        return;
      case 'file':
        out.push(wrap(<FileBlock label={block.label} src={block.src} note={block.note} />));
        return;
      case 'callout':
        out.push(wrap(<CalloutBlock tone={block.tone} md={block.md} ctx={ctx} />));
        return;
      case 'model3d':
        out.push(
          wrap(<Model3dBlock media={block.media} views={block.views} explode={block.explode} callouts={block.callouts} />),
        );
        return;
      case 'document':
        out.push(wrap(<DocumentBlock media={block.media} title={block.title} />));
        return;
      case 'audio':
        out.push(wrap(<AudioBlock media={block.media} title={block.title} />));
        return;
      case 'code':
        out.push(wrap(<CodeSnippetBlock language={block.language} code={block.code} repoUrl={block.repoUrl} />));
        return;
      case 'compare':
        out.push(wrap(<CompareBlock before={block.before} after={block.after} />));
        return;
      case 'panzoom':
        out.push(wrap(<PanzoomBlock media={block.media} />));
        return;
      case 'repo':
        out.push(wrap(<RepoBlock url={block.url} title={ctx.label} />));
        return;
      default:
        return;
    }
  });

  if (out.length === 0) return null;
  return <div className="pj-blocks">{out}</div>;
}
