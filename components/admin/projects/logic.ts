/**
 * Pure helpers for the projects editor (ARCHITECTURE.md 7; docs/V3_PLAN.md D-21): new and
 * duplicated projects, block ids, new blocks, block copies, and the words a block's header shows.
 * No React and no browser APIs, so the tests run them directly.
 *
 * Rules kept here:
 * - New and duplicated projects start hidden and unfeatured, with a unique numbered slug (D-21).
 * - Block ids follow the pattern of the seed ("rv-a", "rv-b": a short prefix, a hyphen, letters)
 *   and are unique in the whole project, two-column children included.
 * - Every edit returns new objects only along its path, so untouched blocks keep their identity
 *   and an unedited file serializes to its stored text (D-18).
 */
import type { Block, TwoColBlock } from '@/lib/schema';
import type { Project } from '@/lib/types';
import { parsePath, setIn } from '../ui/paths';
import { deepCopy, replaceItem } from '../ui/list';

// ---------------------------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------------------------

/** Every block type the site renders (lib/schema.ts), in the order the Add menu lists them. */
export const BLOCK_TYPES = [
  'heading',
  'text',
  'bullets',
  'quote',
  'callout',
  'code',
  'image',
  'gallery',
  'video',
  'model3d',
  'document',
  'audio',
  'compare',
  'panzoom',
  'twoCol',
  'specTable',
  'linkRow',
  'roadmap',
  'log',
  'file',
  'repo',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export type BlockGroup = 'Words' | 'Media' | 'Layout and lists';

/** Interface labels for each block type and the group the Add menu shows it in. */
export const BLOCK_INFO: Readonly<Record<BlockType, { label: string; group: BlockGroup }>> = {
  heading: { label: 'Heading', group: 'Words' },
  text: { label: 'Text', group: 'Words' },
  bullets: { label: 'Bullets', group: 'Words' },
  quote: { label: 'Quote', group: 'Words' },
  callout: { label: 'Callout', group: 'Words' },
  code: { label: 'Code', group: 'Words' },
  image: { label: 'Image', group: 'Media' },
  gallery: { label: 'Gallery', group: 'Media' },
  video: { label: 'Video', group: 'Media' },
  model3d: { label: '3D model', group: 'Media' },
  document: { label: 'Document', group: 'Media' },
  audio: { label: 'Audio', group: 'Media' },
  compare: { label: 'Before and after', group: 'Media' },
  panzoom: { label: 'Pan and zoom', group: 'Media' },
  twoCol: { label: 'Two columns', group: 'Layout and lists' },
  specTable: { label: 'Spec table', group: 'Layout and lists' },
  linkRow: { label: 'Link row', group: 'Layout and lists' },
  roadmap: { label: 'Roadmap', group: 'Layout and lists' },
  log: { label: 'Build log', group: 'Layout and lists' },
  file: { label: 'File download', group: 'Layout and lists' },
  repo: { label: 'Repository card', group: 'Layout and lists' },
};

export const BLOCK_GROUPS: readonly BlockGroup[] = ['Words', 'Media', 'Layout and lists'];

export function isBlockType(type: string): type is BlockType {
  return Object.hasOwn(BLOCK_INFO, type);
}

/** The label of a block's type, or the type itself for a type the site does not know. */
export function blockTypeLabel(type: string): string {
  return isBlockType(type) ? BLOCK_INFO[type].label : type;
}

// ---------------------------------------------------------------------------------------------
// Block ids
// ---------------------------------------------------------------------------------------------

/** The seed's id pattern: a prefix, a hyphen, and lowercase letters ("rv-a", "fs-k"). */
const ID_SHAPE = /^([a-z0-9]+)-([a-z]+)$/;

function childLists(block: Block): Block[][] {
  if (block.type !== 'twoCol') return [];
  const { left, right } = block as TwoColBlock;
  return [left, right].filter((list): list is Block[] => Array.isArray(list));
}

/** Every block id in a list, the children of two-column blocks included. */
export function collectBlockIds(blocks: readonly Block[], into: Set<string> = new Set()): Set<string> {
  for (const block of blocks) {
    if (typeof block.id === 'string' && block.id !== '') into.add(block.id);
    for (const list of childLists(block)) collectBlockIds(list, into);
  }
  return into;
}

/** A prefix from a slug: the first letters of its first two words ("can-bus-tool" gives "cb"). */
export function prefixFromSlug(slug: string): string {
  const words = slug.split('-').filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`;
  return (words[0] ?? '').slice(0, 2) || 'b';
}

/** The prefix this project's block ids use (the most common one), or one made from the slug. */
export function blockIdPrefix(project: Pick<Project, 'slug' | 'blocks'>): string {
  const counts = new Map<string, number>();
  for (const id of collectBlockIds(project.blocks)) {
    const match = ID_SHAPE.exec(id);
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  let best = '';
  let most = 0;
  for (const [prefix, count] of counts) {
    if (count > most) {
      best = prefix;
      most = count;
    }
  }
  return best || prefixFromSlug(project.slug);
}

/** 1 is "a", 26 is "z", 27 is "aa": the letters after the hyphen. */
export function idLetters(n: number): string {
  let out = '';
  let rest = Math.max(1, Math.floor(n));
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

function letterNumber(letters: string): number {
  let n = 0;
  for (const char of letters) n = n * 26 + (char.charCodeAt(0) - 96);
  return n;
}

/**
 * A source of new block ids for one project: each call returns an id in the project's pattern
 * after the highest one in use ("rv-k" after "rv-j") that no block has, and remembers it, so one
 * operation (a duplicated two-column block) gets distinct ids. `prefix` overrides the pattern's
 * prefix (a duplicated project uses one made from its new slug).
 */
export function blockIdSource(project: Pick<Project, 'slug' | 'blocks'>, prefix: string = blockIdPrefix(project)): () => string {
  const taken = collectBlockIds(project.blocks);
  let n = 0;
  for (const id of taken) {
    const match = ID_SHAPE.exec(id);
    if (match && match[1] === prefix) n = Math.max(n, letterNumber(match[2]));
  }
  return () => {
    let id: string;
    do {
      n += 1;
      id = `${prefix}-${idLetters(n)}`;
    } while (taken.has(id));
    taken.add(id);
    return id;
  };
}

// ---------------------------------------------------------------------------------------------
// New blocks and copies
// ---------------------------------------------------------------------------------------------

/** An empty block of `type`, valid under lib/schema.ts. Optional fields are left out. */
export function newBlock(type: BlockType, id: string): Block {
  switch (type) {
    case 'heading':
      return { id, type, text: '' };
    case 'text':
      return { id, type, md: '' };
    case 'image':
      return { id, type, media: { kind: 'image', src: '', alt: '' } };
    case 'gallery':
      return { id, type, items: [] };
    case 'video':
      return { id, type, media: { kind: 'video', src: '', alt: '' } };
    case 'specTable':
      return { id, type, rows: [] };
    case 'bullets':
      return { id, type, items: [] };
    case 'twoCol':
      return { id, type, left: [], right: [] };
    case 'quote':
      return { id, type, text: '' };
    case 'linkRow':
      return { id, type, links: [] };
    case 'roadmap':
      return { id, type, stages: [] };
    case 'log':
      return { id, type, entries: [] };
    case 'file':
      return { id, type, label: '', src: '' };
    case 'callout':
      return { id, type, tone: 'note', md: '' };
    case 'model3d':
      return { id, type, media: { kind: 'model', src: '', alt: '' } };
    case 'document':
      return { id, type, media: { kind: 'document', src: '', alt: '' } };
    case 'audio':
      return { id, type, media: { kind: 'audio', src: '' } };
    case 'code':
      return { id, type, language: 'text', code: '' };
    case 'compare':
      return { id, type, before: { kind: 'image', src: '', alt: '' }, after: { kind: 'image', src: '', alt: '' } };
    case 'panzoom':
      return { id, type, media: { kind: 'image', src: '', alt: '' } };
    case 'repo':
      return { id, type, url: '' };
  }
}

/** Gives a block (copied already) and every block inside it a new id. A block without an id keeps none. */
function renumberIds(block: Block, nextId: () => string): Block {
  const withId = typeof block.id === 'string' ? { ...block, id: nextId() } : block;
  if (withId.type !== 'twoCol') return withId;
  const two = withId as TwoColBlock;
  return {
    ...two,
    left: Array.isArray(two.left) ? two.left.map((child) => renumberIds(child, nextId)) : two.left,
    right: Array.isArray(two.right) ? two.right.map((child) => renumberIds(child, nextId)) : two.right,
  } as Block;
}

/** A deep copy of a block with new ids for it and every block inside it. */
export function copyBlock(block: Block, nextId: () => string): Block {
  return renumberIds(deepCopy(block), nextId);
}

/** Inserts `block` into a list at `index` (clamped). */
export function insertBlock(blocks: readonly Block[], block: Block, index: number): Block[] {
  const at = Math.max(0, Math.min(index, blocks.length));
  const copy = blocks.slice();
  copy.splice(at, 0, block);
  return copy;
}

/** Replaces the block at `index`; the same list when it is the same block, so a no-op makes no undo step. */
export function setBlockAt(blocks: readonly Block[], index: number, block: Block): Block[] {
  return replaceItem(blocks, index, block);
}

/**
 * Writes `block` at a block path in a project ("blocks[3]", "blocks[2].left[0]"). Only the objects
 * along the path are new; every other block, and the rest of the project, keep their identity.
 */
export function setBlockIn(project: Project, blockPath: string, block: Block): Project {
  return setIn(project, blockPath, block);
}

/** The order of a project's keys in the seed and in lib/schema.ts. */
export const PROJECT_KEY_ORDER: readonly string[] = [
  'slug',
  'visible',
  'title',
  'subtitle',
  'role',
  'timeframe',
  'status',
  'statusLabel',
  'maturity',
  'featured',
  'order',
  'domain',
  'tags',
  'cover',
  'links',
  'callouts',
  'pitch',
  'highlights',
  'progress',
  'blocks',
];

/**
 * `setIn` for a project field. A top-level key the project does not have yet (an optional one:
 * statusLabel, maturity, callouts, progress) goes in at its place in the schema's order rather
 * than last, so the stored file reads like the seed. Keys the project has keep their positions.
 */
export function setProjectIn(project: Project, path: string, value: unknown): Project {
  const top = parsePath(path)[0];
  const next = setIn(project, path, value);
  if (next === project || typeof top !== 'string' || Object.hasOwn(project, top)) return next;
  const at = PROJECT_KEY_ORDER.indexOf(top);
  if (at === -1) return next;
  const source = next as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let placed = false;
  for (const key of Object.keys(source)) {
    if (key === top) continue;
    if (!placed && PROJECT_KEY_ORDER.indexOf(key) > at) {
      out[top] = source[top];
      placed = true;
    }
    out[key] = source[key];
  }
  if (!placed) out[top] = source[top];
  return out as unknown as Project;
}

/**
 * A shallow update of an object that returns the same object when no value changes, so a typed
 * value equal to the stored one makes no edit. Keys keep their positions; new keys go last.
 */
export function withFields<T extends object>(target: T, changes: Partial<T>): T {
  let changed = false;
  for (const key of Object.keys(changes) as (keyof T)[]) {
    if (!Object.is(target[key], changes[key]) || !(key in target)) {
      changed = true;
      break;
    }
  }
  return changed ? { ...target, ...changes } : target;
}

// ---------------------------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------------------------

/** The first `new-project-<n>` that no project uses. */
export function newProjectSlug(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n += 1) {
    const slug = `new-project-${n}`;
    if (!used.has(slug)) return slug;
  }
}

/** The first `<slug>-copy-<n>` that no project uses; a copy of a copy counts on from the original. */
export function copySlug(slug: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slug.replace(/-copy(?:-\d+)?$/, '') || 'project';
  for (let n = 1; ; n += 1) {
    const candidate = `${base}-copy-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * A new, minimal project that passes ProjectSchema: hidden, unfeatured, a unique slug, empty text.
 * The title is required by the schema, so it reads "New project" until the owner names it. The
 * optional keys are present without a value: JSON leaves them out, and a value set later lands in
 * the seed's key order.
 */
export function newProject(taken: Iterable<string>, order: number): Project {
  return {
    slug: newProjectSlug(taken),
    visible: false,
    title: 'New project',
    subtitle: '',
    role: '',
    timeframe: '',
    status: 'in-progress',
    statusLabel: undefined,
    maturity: undefined,
    featured: false,
    order,
    domain: '',
    tags: [],
    cover: { kind: 'image', src: '' },
    links: [],
    callouts: undefined,
    pitch: '',
    highlights: [],
    progress: undefined,
    blocks: [],
  };
}

/**
 * A copy of a project: a unique numbered slug, hidden, unfeatured, and new block ids in the copy's
 * own pattern (made from its slug), two-column children included; none repeats an id of the
 * original, even when both slugs give the same prefix. Everything else is copied.
 */
export function duplicateProject(source: Project, taken: Iterable<string>): Project {
  const copy = deepCopy(source);
  const slug = copySlug(source.slug, taken);
  const nextId = blockIdSource({ slug, blocks: Array.isArray(source.blocks) ? source.blocks : [] }, prefixFromSlug(slug));
  return {
    ...copy,
    slug,
    visible: false,
    featured: false,
    blocks: Array.isArray(copy.blocks) ? copy.blocks.map((block) => renumberIds(block, nextId)) : copy.blocks,
  };
}

/** The status values with the words the site prints for them when `statusLabel` is empty (D-15). */
export const STATUS_OPTIONS = [
  { value: 'in-progress', label: 'In progress' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'shipped', label: 'Shipped' },
] as const;

/** The status as the list shows it: the label when set, else the status value in words. */
export function statusWords(project: { status: string; statusLabel?: string }): string {
  const label = project.statusLabel?.trim();
  if (label) return label;
  return STATUS_OPTIONS.find((o) => o.value === project.status)?.label ?? project.status;
}

/** Why hiding or deleting the last visible project is refused (D-06). */
export const LAST_VISIBLE = 'At least one project stays visible: the site needs one project page. Make another project visible first.';

/** True when this entry is the only visible project: hiding or deleting it is refused (D-06). */
export function isLastVisible(projects: readonly { key: string; data: Pick<Project, 'visible'> }[], key: string): boolean {
  const entry = projects.find((e) => e.key === key);
  if (!entry || entry.data.visible !== true) return false;
  return !projects.some((e) => e.key !== key && e.data.visible === true);
}

/** A slug that can be a page address (the rule of lib/admin/contract.ts and the URL hash). */
export const ROUTE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The project to edit for the slug in the URL hash. The editor follows its project, not its slug,
 * so the remembered entry wins when it still has that slug, when its own slug cannot be an address
 * yet, or when no project has the hash's slug (a rename, or undoing one, just changed it);
 * otherwise the project the hash names (Back, or a warning that leads to another project).
 */
export function resolveEntry<E extends { key: string; data: Pick<Project, 'slug'> }>(
  projects: readonly E[],
  routeSlug: string,
  rememberedKey: string | null,
): E | undefined {
  const remembered = rememberedKey === null ? undefined : projects.find((e) => e.key === rememberedKey);
  if (remembered && (remembered.data.slug === routeSlug || !ROUTE_SLUG.test(remembered.data.slug) || !projects.some((e) => e.data.slug === routeSlug))) {
    return remembered;
  }
  return projects.find((e) => e.data.slug === routeSlug);
}

/** True when another project already uses this slug. */
export function slugTaken(projects: readonly { key: string; data: Pick<Project, 'slug'> }[], key: string, slug: string): boolean {
  return projects.some((e) => e.key !== key && e.data.slug === slug);
}

// ---------------------------------------------------------------------------------------------
// Words for block headers
// ---------------------------------------------------------------------------------------------

const SUMMARY_MAX = 80;

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1).trimEnd()}...` : line;
}

function fileName(src: unknown): string {
  if (typeof src !== 'string' || src.trim() === '') return '';
  const clean = src.trim().split(/[?#]/)[0];
  return clean.slice(clean.lastIndexOf('/') + 1);
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function mediaWords(media: unknown): string {
  const ref = (media ?? {}) as Record<string, unknown>;
  return clip(text(ref.caption) || text(ref.alt) || fileName(ref.src) || (text(ref.src) === '' ? 'No file yet' : text(ref.src)));
}

/** A short line for a block's header: its text, its file, or how many items it holds. */
export function blockSummary(block: Block): string {
  const b = block as Record<string, unknown>;
  switch (block.type) {
    case 'heading':
    case 'quote':
      return clip(text(b.text));
    case 'text':
    case 'callout':
      return clip(text(b.md));
    case 'image':
    case 'video':
    case 'model3d':
    case 'panzoom':
      return mediaWords(b.media);
    case 'document':
    case 'audio':
      return clip(text(b.title)) || mediaWords(b.media);
    case 'gallery':
      return count(list(b.items).length, 'item');
    case 'specTable':
      return count(list(b.rows).length, 'row');
    case 'bullets':
      return clip(text(b.heading)) || count(list(b.items).length, 'item');
    case 'twoCol':
      return `${count(list(b.left).length, 'block')} left, ${count(list(b.right).length, 'block')} right`;
    case 'linkRow':
      return count(list(b.links).length, 'link');
    case 'roadmap':
      return count(list(b.stages).length, 'stage');
    case 'log':
      return count(list(b.entries).length, 'entry', 'entries');
    case 'file':
      return clip(text(b.label) || fileName(b.src));
    case 'code':
      return clip([text(b.language), text(b.code).split('\n')[0] ?? ''].filter(Boolean).join(': '));
    case 'compare':
      return clip(`${mediaWords(b.before)} / ${mediaWords(b.after)}`);
    case 'repo':
      return clip(text(b.url));
    default:
      return 'Kept as is';
  }
}

/**
 * React keys for a block list: the block's id, or its position for a block without an id or with
 * an id another block in the list also has.
 */
export function blockKeys(blocks: readonly Block[]): string[] {
  const seen = new Map<string, number>();
  for (const block of blocks) {
    if (typeof block.id === 'string' && block.id !== '') seen.set(block.id, (seen.get(block.id) ?? 0) + 1);
  }
  return blocks.map((block, i) =>
    typeof block.id === 'string' && block.id !== '' && seen.get(block.id) === 1 ? `id:${block.id}` : `at:${i}`,
  );
}
