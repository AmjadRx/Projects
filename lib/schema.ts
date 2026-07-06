import { z } from 'zod';

export const MediaRefSchema = z.object({
  kind: z.enum(['image', 'video', 'embed']),
  src: z.string(),
  alt: z.string().optional(),
  poster: z.string().optional(),
  caption: z.string().optional(),
});

const LinkSchema = z.object({
  label: z.string(),
  url: z.string(),
  icon: z.string().optional(),
});

const KnownBlockSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('heading'), text: z.string() }),
  z.object({ id: z.string(), type: z.literal('text'), md: z.string() }),
  z.object({ id: z.string(), type: z.literal('image'), media: MediaRefSchema }),
  z.object({ id: z.string(), type: z.literal('gallery'), items: z.array(MediaRefSchema) }),
  z.object({ id: z.string(), type: z.literal('video'), media: MediaRefSchema }),
  z.object({
    id: z.string(),
    type: z.literal('specTable'),
    rows: z.array(z.object({ label: z.string(), value: z.string() })),
  }),
  z.object({
    id: z.string(),
    type: z.literal('bullets'),
    heading: z.string().optional(),
    items: z.array(z.string()),
  }),
  z.object({
    id: z.string(),
    type: z.literal('quote'),
    text: z.string(),
    attribution: z.string().optional(),
  }),
  z.object({ id: z.string(), type: z.literal('linkRow'), links: z.array(LinkSchema) }),
  z.object({
    id: z.string(),
    type: z.literal('roadmap'),
    stages: z.array(
      z.object({
        n: z.number(),
        title: z.string(),
        desc: z.string(),
        status: z.enum(['done', 'in-progress', 'next', 'future']),
      }),
    ),
  }),
  z.object({
    id: z.string(),
    type: z.literal('log'),
    entries: z.array(
      z.object({
        date: z.string(),
        title: z.string(),
        md: z.string(),
        media: z.array(MediaRefSchema).optional(),
      }),
    ),
  }),
]);

// twoCol references Block recursively; unknown types pass through for forward compat.
export const BlockSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    KnownBlockSchema,
    z.object({
      id: z.string(),
      type: z.literal('twoCol'),
      left: z.array(BlockSchema),
      right: z.array(BlockSchema),
    }),
    z.object({ id: z.string(), type: z.string() }).passthrough(),
  ]),
);

export const ProjectSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  subtitle: z.string(),
  role: z.string(),
  timeframe: z.string(),
  status: z.enum(['in-progress', 'active', 'completed', 'shipped']),
  statusLabel: z.string().optional(),
  featured: z.boolean(),
  order: z.number(),
  domain: z.string(),
  tags: z.array(z.string()),
  cover: MediaRefSchema,
  links: z.array(LinkSchema),
  pitch: z.string(),
  highlights: z.array(z.string()),
  progress: z
    .object({
      steps: z.array(
        z.object({ label: z.string(), state: z.enum(['done', 'current', 'todo']) }),
      ),
    })
    .optional(),
  blocks: z.array(BlockSchema),
});

export const SiteSchema = z.object({
  schemaVersion: z.number(),
  settings: z.object({
    themeDefault: z.enum(['dark', 'light']),
    heroMode: z.enum(['scene3d', 'media']),
    heroMedia: MediaRefSchema.optional(),
    showAvailabilityBadge: z.boolean(),
  }),
  personal: z.object({
    name: z.string(),
    tagline: z.string(),
    subTagline: z.string(),
    location: z.string(),
    email: z.string(),
    phone: z.string(),
    availability: z.string(),
    gpa: z.string(),
    graduation: z.string(),
    school: z.string(),
    degree: z.string(),
    photo: MediaRefSchema.optional(),
  }),
  socialLinks: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      url: z.string(),
      icon: z.string(),
      showInNav: z.boolean(),
      showInFooter: z.boolean(),
      showInContact: z.boolean(),
    }),
  ),
  nav: z.array(z.object({ label: z.string(), href: z.string() })),
  stats: z.array(z.object({ label: z.string(), value: z.string(), suffix: z.string().optional() })),
  thesis: z.object({
    kicker: z.string(),
    headline: z.string(),
    body: z.string(),
    pillars: z.array(z.object({ k: z.string(), title: z.string(), desc: z.string() })),
  }),
  about: z.object({
    heading: z.string(),
    paragraphs: z.array(z.string()),
    facts: z.array(z.object({ label: z.string(), value: z.string() })),
    headshot: MediaRefSchema.optional(),
  }),
  skills: z.object({
    groups: z.array(
      z.object({
        title: z.string(),
        tier: z.enum(['deep', 'strong', 'familiar']),
        items: z.array(z.string()),
      }),
    ),
  }),
  experience: z.array(
    z.object({
      company: z.string(),
      role: z.string(),
      location: z.string(),
      dates: z.string(),
      bullets: z.array(z.string()),
      logo: MediaRefSchema.optional(),
    }),
  ),
  honors: z.array(z.object({ title: z.string(), year: z.string(), note: z.string() })),
  education: z.array(
    z.object({ school: z.string(), degree: z.string(), details: z.string(), dates: z.string() }),
  ),
  contact: z.object({ heading: z.string(), body: z.string() }),
});
