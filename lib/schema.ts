/**
 * Content schema version 3 (ARCHITECTURE.md section 4): one schema for the site, the admin,
 * the API, and the content check.
 *
 * This file imports only `zod`, so the scripts in `scripts/` can load it directly with Node's
 * type stripping. Keep it that way: no relative imports, and no TypeScript-only runtime syntax
 * (enums, namespaces, parameter properties).
 *
 * Objects are strict: a key the schema does not know is reported with its field path instead of
 * being dropped silently (docs/V3_PLAN.md D-02). Blocks are the one exception: a block whose
 * type is not known is accepted as it is and ignored by the site (section 4 rules).
 */
import { z } from 'zod';

export const MEDIA_KINDS = ['image', 'video', 'embed', 'model', 'document', 'audio'] as const;

const mediaShape = {
  kind: z.enum(MEDIA_KINDS),
  src: z.string(),
  alt: z.string().optional(),
  poster: z.string().optional(),
  caption: z.string().optional(),
  focal: z.strictObject({ x: z.number(), y: z.number() }).optional(),
  /** A WebVTT file for video. */
  captions: z.string().optional(),
  /** Which storage backend holds the file. */
  store: z.enum(['repo', 'blob']).optional(),
  /**
   * For audio: peak levels from 0 to 1, computed once at upload and drawn as the waveform
   * (ARCHITECTURE.md 13A, docs/V3_PLAN.md D-13 and Q-09). Without it the player shows a plain
   * progress bar; visitors never download the file to draw one.
   */
  waveform: z.array(z.number().min(0).max(1)).max(4096).optional(),
};

/** A reference to one media file. An empty `src` means "no file yet": render the placeholder. */
export const MediaRefSchema = z.strictObject(mediaShape);

/**
 * The hero model. The seed leaves it empty (`{ "src": "", "alt": "" }`) and without a `kind`;
 * a hero model can only be a model, so `kind` defaults to "model" (docs/V3_PLAN.md D-03).
 */
export const HeroModelSchema = z.strictObject({ ...mediaShape, kind: z.enum(MEDIA_KINDS).default('model') });

export const LinkSchema = z.strictObject({
  label: z.string(),
  url: z.string(),
  icon: z.string().optional(),
});

export const CalloutSchema = z.strictObject({ label: z.string(), value: z.string() });

// ---------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------

const blockId = z.string().min(1);

const HeadingBlock = z.strictObject({ id: blockId, type: z.literal('heading'), text: z.string() });
const TextBlock = z.strictObject({ id: blockId, type: z.literal('text'), md: z.string() });
const ImageBlock = z.strictObject({ id: blockId, type: z.literal('image'), media: MediaRefSchema });
const GalleryBlock = z.strictObject({
  id: blockId,
  type: z.literal('gallery'),
  /** Images, videos, and models, mixed. */
  items: z.array(MediaRefSchema),
});
const VideoBlock = z.strictObject({
  id: blockId,
  type: z.literal('video'),
  media: MediaRefSchema,
  /** Ties playback to scroll position (ARCHITECTURE.md 13A, the `scrub` option). */
  scrub: z.boolean().optional(),
});
const SpecTableBlock = z.strictObject({
  id: blockId,
  type: z.literal('specTable'),
  rows: z.array(z.strictObject({ label: z.string(), value: z.string() })),
});
const BulletsBlock = z.strictObject({
  id: blockId,
  type: z.literal('bullets'),
  heading: z.string().optional(),
  items: z.array(z.string()),
});
const QuoteBlock = z.strictObject({
  id: blockId,
  type: z.literal('quote'),
  text: z.string(),
  attribution: z.string().optional(),
});
const LinkRowBlock = z.strictObject({ id: blockId, type: z.literal('linkRow'), links: z.array(LinkSchema) });
const RoadmapBlock = z.strictObject({
  id: blockId,
  type: z.literal('roadmap'),
  stages: z.array(
    z.strictObject({
      n: z.number(),
      title: z.string(),
      desc: z.string(),
      status: z.enum(['done', 'in-progress', 'next', 'future']),
    }),
  ),
});
const LogBlock = z.strictObject({
  id: blockId,
  type: z.literal('log'),
  entries: z.array(
    z.strictObject({
      date: z.string(),
      title: z.string(),
      md: z.string(),
      media: z.array(MediaRefSchema).optional(),
    }),
  ),
});
const FileBlock = z.strictObject({
  id: blockId,
  type: z.literal('file'),
  label: z.string(),
  src: z.string(),
  note: z.string().optional(),
});
const CalloutBlock = z.strictObject({
  id: blockId,
  type: z.literal('callout'),
  tone: z.enum(['note', 'status']),
  md: z.string(),
});
const Model3dBlock = z.strictObject({
  id: blockId,
  type: z.literal('model3d'),
  media: MediaRefSchema,
  views: z.array(z.enum(['realistic', 'blueprint', 'thermal'])).optional(),
  explode: z.boolean().optional(),
  callouts: z.array(CalloutSchema).optional(),
});
const DocumentBlock = z.strictObject({
  id: blockId,
  type: z.literal('document'),
  media: MediaRefSchema,
  title: z.string().optional(),
});
const AudioBlock = z.strictObject({
  id: blockId,
  type: z.literal('audio'),
  media: MediaRefSchema,
  title: z.string().optional(),
});
const CodeBlock = z.strictObject({
  id: blockId,
  type: z.literal('code'),
  language: z.string(),
  code: z.string(),
  repoUrl: z.string().optional(),
});
const CompareBlock = z.strictObject({
  id: blockId,
  type: z.literal('compare'),
  before: MediaRefSchema,
  after: MediaRefSchema,
});
const PanzoomBlock = z.strictObject({ id: blockId, type: z.literal('panzoom'), media: MediaRefSchema });
const RepoBlock = z.strictObject({ id: blockId, type: z.literal('repo'), url: z.string() });

/** A block of a type the site does not know: accepted as it is, rendered as nothing. */
export type UnknownBlock = { id?: string; type: string; [key: string]: unknown };

/** The one recursive block. Its shape is written out because it refers to `Block`. */
export type TwoColBlock = { id: string; type: 'twoCol'; left: Block[]; right: Block[] };

export type KnownBlock =
  | z.output<typeof HeadingBlock>
  | z.output<typeof TextBlock>
  | z.output<typeof ImageBlock>
  | z.output<typeof GalleryBlock>
  | z.output<typeof VideoBlock>
  | z.output<typeof SpecTableBlock>
  | z.output<typeof BulletsBlock>
  | TwoColBlock
  | z.output<typeof QuoteBlock>
  | z.output<typeof LinkRowBlock>
  | z.output<typeof RoadmapBlock>
  | z.output<typeof LogBlock>
  | z.output<typeof FileBlock>
  | z.output<typeof CalloutBlock>
  | z.output<typeof Model3dBlock>
  | z.output<typeof DocumentBlock>
  | z.output<typeof AudioBlock>
  | z.output<typeof CodeBlock>
  | z.output<typeof CompareBlock>
  | z.output<typeof PanzoomBlock>
  | z.output<typeof RepoBlock>;

export type Block = KnownBlock | UnknownBlock;

const TwoColBlockSchema: z.ZodType<TwoColBlock> = z.strictObject({
  id: blockId,
  type: z.literal('twoCol'),
  get left(): z.ZodArray<z.ZodType<Block>> {
    return z.array(BlockSchema);
  },
  get right(): z.ZodArray<z.ZodType<Block>> {
    return z.array(BlockSchema);
  },
});

const KNOWN_BLOCKS: Record<string, z.ZodType> = {
  heading: HeadingBlock,
  text: TextBlock,
  image: ImageBlock,
  gallery: GalleryBlock,
  video: VideoBlock,
  specTable: SpecTableBlock,
  bullets: BulletsBlock,
  twoCol: TwoColBlockSchema,
  quote: QuoteBlock,
  linkRow: LinkRowBlock,
  roadmap: RoadmapBlock,
  log: LogBlock,
  file: FileBlock,
  callout: CalloutBlock,
  model3d: Model3dBlock,
  document: DocumentBlock,
  audio: AudioBlock,
  code: CodeBlock,
  compare: CompareBlock,
  panzoom: PanzoomBlock,
  repo: RepoBlock,
};

export const KNOWN_BLOCK_TYPES: readonly string[] = Object.freeze(Object.keys(KNOWN_BLOCKS));

/**
 * A block. A known type must pass its own schema, so a malformed known block is an error with
 * its field path (docs/V3_PLAN.md D-04). Any other type is accepted as it is.
 */
export const BlockSchema = z.looseObject({ type: z.string().min(1) }).superRefine((block, ctx) => {
  const schema = Object.hasOwn(KNOWN_BLOCKS, block.type) ? KNOWN_BLOCKS[block.type] : undefined;
  if (!schema) return;
  const result = schema.safeParse(block);
  if (result.success) return;
  for (const issue of result.error.issues) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
  }
}) as unknown as z.ZodType<Block>;

/** True when the site knows how to render this block. Renderers skip every other block. */
export function isKnownBlock(block: Block): block is KnownBlock {
  return Object.hasOwn(KNOWN_BLOCKS, block.type);
}

// ---------------------------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------------------------

export const ProjectSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Use lowercase letters, digits, and hyphens.'),
  visible: z.boolean(),
  title: z.string().min(1),
  subtitle: z.string(),
  role: z.string(),
  timeframe: z.string(),
  status: z.enum(['in-progress', 'active', 'completed', 'shipped']),
  statusLabel: z.string().optional(),
  maturity: z.strictObject({ step: z.int().min(1).max(5), label: z.string().min(1) }).optional(),
  featured: z.boolean(),
  order: z.number(),
  domain: z.string(),
  tags: z.array(z.string()),
  /** An image, a video, or a model; an empty `src` renders the placeholder. */
  cover: MediaRefSchema,
  links: z.array(LinkSchema),
  callouts: z.array(CalloutSchema).max(3).optional(),
  pitch: z.string(),
  highlights: z.array(z.string()),
  progress: z
    .strictObject({
      steps: z.array(z.strictObject({ label: z.string(), state: z.enum(['done', 'current', 'todo']) })),
    })
    .optional(),
  blocks: z.array(BlockSchema),
});

// ---------------------------------------------------------------------------------------------
// Site
// ---------------------------------------------------------------------------------------------

export const SiteSchema = z
  .strictObject({
    schemaVersion: z.literal(3),
    settings: z.strictObject({
      themeDefault: z.enum(['dark', 'light']),
      background: z.enum(['sky', 'grid', 'off']).default('sky'),
      heroMode: z.enum(['drawing', 'model', 'media']),
      heroModel: HeroModelSchema.optional(),
      heroMedia: MediaRefSchema.optional(),
      showAvailabilityBadge: z.boolean(),
    }),
    seo: z.strictObject({ title: z.string(), description: z.string(), ogImage: MediaRefSchema.optional() }),
    personal: z.strictObject({
      name: z.string(),
      tagline: z.string(),
      subTagline: z.string(),
      location: z.string(),
      email: z.string(),
      /** May be empty: every element that shows it is then hidden. */
      phone: z.string(),
      availability: z.string(),
      /** May be empty: every GPA element is then hidden. */
      gpa: z.string(),
      /** Printed before the value, always ("Major GPA 3.65"). */
      gpaLabel: z.string(),
      graduation: z.string(),
      school: z.string(),
      degree: z.string(),
      photo: MediaRefSchema.optional(),
    }),
    socialLinks: z.array(
      z.strictObject({
        id: z.string(),
        label: z.string(),
        url: z.string(),
        icon: z.string(),
        showInNav: z.boolean(),
        showInFooter: z.boolean(),
        showInContact: z.boolean(),
      }),
    ),
    nav: z.array(z.strictObject({ label: z.string(), href: z.string() })),
    now: z.array(z.strictObject({ label: z.string(), href: z.string().optional() })),
    stats: z.array(
      z.strictObject({
        value: z.string(),
        prefix: z.string().optional(),
        suffix: z.string().optional(),
        label: z.string(),
        /** A site path, such as "/projects/raven". */
        proof: z.string().optional(),
      }),
    ),
    thesis: z.strictObject({
      kicker: z.string(),
      headline: z.string(),
      body: z.string(),
      pillars: z.array(z.strictObject({ k: z.string(), title: z.string(), desc: z.string() })),
    }),
    about: z.strictObject({
      heading: z.string(),
      paragraphs: z.array(z.string()),
      facts: z.array(z.strictObject({ label: z.string(), value: z.string() })),
      headshot: MediaRefSchema.optional(),
    }),
    skills: z.strictObject({
      groups: z.array(
        z.strictObject({
          title: z.string(),
          tier: z.enum(['deep', 'strong', 'familiar']),
          /** `proof` is a project slug. */
          items: z.array(z.strictObject({ label: z.string(), proof: z.string().optional() })),
        }),
      ),
    }),
    experience: z.array(
      z.strictObject({
        company: z.string(),
        role: z.string(),
        location: z.string(),
        dates: z.string(),
        bullets: z.array(z.string()),
        logo: MediaRefSchema.optional(),
      }),
    ),
    honors: z.array(z.strictObject({ title: z.string(), year: z.string(), note: z.string() })),
    education: z.array(
      z.strictObject({ school: z.string(), degree: z.string(), details: z.string(), dates: z.string() }),
    ),
    contact: z.strictObject({
      heading: z.string(),
      body: z.string(),
      resumeRequest: z
        .strictObject({ enabled: z.boolean(), label: z.string(), subject: z.string(), body: z.string() })
        .optional(),
    }),
  })
  .superRefine((site, ctx) => {
    if (site.personal.gpa.trim() !== '' && site.personal.gpaLabel.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['personal', 'gpaLabel'],
        message: 'gpaLabel is required whenever gpa is set; the GPA is never printed without its label.',
      });
    }
  });
