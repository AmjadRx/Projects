import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BlockSchema, isKnownBlock, KNOWN_BLOCK_TYPES, ProjectSchema } from '../lib/schema';

const raven = JSON.parse(fs.readFileSync(path.resolve('content/projects/raven.json'), 'utf8'));

describe('blocks', () => {
  it('accepts a block of an unknown type and keeps every field of it', () => {
    const unknown = { id: 'zz-1', type: 'hologram', depth: 3, layers: [{ any: 'shape' }] };
    const result = ProjectSchema.safeParse({ ...raven, blocks: [...raven.blocks, unknown] });
    expect(result.success).toBe(true);
    expect(result.data!.blocks.at(-1)).toEqual(unknown);
  });

  it('ignores the unknown block when rendering: only known blocks are rendered', () => {
    const project = ProjectSchema.parse({ ...raven, blocks: [...raven.blocks, { id: 'zz-1', type: 'hologram' }] });
    const rendered = project.blocks.filter(isKnownBlock);
    expect(rendered).toHaveLength(raven.blocks.length);
    expect(rendered.map((block) => block.type as string)).not.toContain('hologram');
  });

  it('rejects a known block type with a wrong shape, with the field path', () => {
    const result = BlockSchema.safeParse({ id: 'b1', type: 'bullets', items: [42] });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path.join('.'))).toEqual(['items.0']);
  });

  it('rejects a key a known block does not have', () => {
    const result = BlockSchema.safeParse({ id: 't1', type: 'text', md: 'Hello', colour: 'red' });
    expect(result.success).toBe(false);
  });

  it('validates the blocks inside a twoCol block', () => {
    const good = { id: 'c1', type: 'twoCol', left: [{ id: 'a', type: 'text', md: 'Left' }], right: [] };
    const bad = { id: 'c2', type: 'twoCol', left: [], right: [{ id: 'b', type: 'text' }] };
    expect(BlockSchema.safeParse(good).success).toBe(true);
    expect(BlockSchema.safeParse(bad).error!.issues.map((issue) => issue.path.join('.'))).toEqual(['right.0.md']);
  });

  it('knows the twelve v2 block types and the nine that revision 2 adds', () => {
    expect(KNOWN_BLOCK_TYPES).toHaveLength(21);
  });
});
