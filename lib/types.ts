/** Types for content schema version 3, inferred from lib/schema.ts (docs/V3_PLAN.md D-10). */
import type { z } from 'zod';
import type { CalloutSchema, LinkSchema, MediaRefSchema, ProjectSchema, SiteSchema } from './schema';

export type { Block, KnownBlock, TwoColBlock, UnknownBlock } from './schema';

export type MediaRef = z.output<typeof MediaRefSchema>;
export type Link = z.output<typeof LinkSchema>;
export type Callout = z.output<typeof CalloutSchema>;
export type Site = z.output<typeof SiteSchema>;
export type Project = z.output<typeof ProjectSchema>;

export type Stat = Site['stats'][number];
export type SkillGroup = Site['skills']['groups'][number];
export type SocialLink = Site['socialLinks'][number];
export type NavItem = Site['nav'][number];

/** The site file and every project, hidden ones included, ordered by `order`. */
export interface Content {
  site: Site;
  projects: Project[];
}
