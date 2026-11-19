/**
 * What the owner is told about a video's sound (lib/admin/convert/video.ts), with the real
 * prepareVideo and mediabunny under Node on the sample clip (H.264 with AAC sound). Only the poster
 * is left out: it is drawn from a <video> element, which Node does not have.
 *
 * Regression of the Phase 6 review (CONVERT-6): a sound track this browser cannot decode was
 * dropped while the owner read that it had been converted to AAC. Node decodes no AC-3 and knows
 * no AMR, so both stand for the browsers that cannot.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as mediabunny from 'mediabunny';
import { describe, expect, it, vi } from 'vitest';
import { CONVERT_MESSAGES as M } from '@/lib/admin/convert/messages';
import { createContext } from '@/lib/admin/convert/util';
import { prepareVideo, soundOutcomeOf } from '@/lib/admin/convert/video';

vi.mock('@/lib/admin/convert/poster', () => ({ captureVideoPoster: async () => null, posterTime: () => 0 }));

const SAMPLE = path.join(process.cwd(), 'public', 'dev', 'samples', 'clip.mp4');

/** The sample with its sound entry relabelled; `hideCodec` also renames the AAC details (esds), so no reader can guess the codec. */
function relabelled(fourcc: string, hideCodec: boolean): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.from(fs.readFileSync(SAMPLE));
  const entry = bytes.indexOf(Buffer.from('mp4a', 'latin1'));
  if (entry < 0) throw new Error('the sample has no mp4a entry');
  bytes.write(fourcc, entry, 'latin1');
  if (hideCodec) {
    const esds = bytes.indexOf(Buffer.from('esds', 'latin1'), entry);
    if (esds < 0) throw new Error('the sample has no esds box');
    bytes.write('xxxx', esds, 'latin1');
  }
  return new Uint8Array(bytes);
}

async function tracksOf(data: Uint8Array | ArrayBuffer): Promise<string[]> {
  const input = new mediabunny.Input({ source: new mediabunny.BufferSource(data), formats: mediabunny.ALL_FORMATS });
  try {
    return await Promise.all((await input.getTracks()).map(async (track) => `${track.type}:${await track.getCodec()}`));
  } finally {
    input.dispose();
  }
}

async function prepare(bytes: Uint8Array<ArrayBuffer>, name: string) {
  const file = new File([bytes], name, { type: name.endsWith('.mov') ? 'video/quicktime' : 'video/mp4' });
  const detected = name.endsWith('.mov') ? ({ format: 'mov', ext: 'mov', brand: 'qt  ' } as const) : ({ format: 'mp4', ext: 'mp4', brand: 'isom' } as const);
  const prepared = await prepareVideo(file, detected, createContext(name));
  const main = prepared.parts.find((part) => part.role === 'main');
  return { prepared, stored: await tracksOf(new Uint8Array(await (main?.blob ?? new Blob()).arrayBuffer())) };
}

const codes = (warnings: { code: string }[]) => warnings.map((warning) => warning.code);

describe('a video whose sound cannot be converted here (CONVERT-6)', () => {
  for (const [label, fourcc, hideCodec, name] of [
    ['AC-3 sound, which this browser cannot decode', 'ac-3', false, 'clip.mp4'],
    ['sound of a codec no reader here knows (AMR)', 'samr', true, 'clip.mov'],
  ] as const) {
    it(`asks the owner before storing it silent: ${label}`, async () => {
      const bytes = relabelled(fourcc, hideCodec);
      expect((await tracksOf(bytes)).some((track) => track.startsWith('audio:'))).toBe(true);
      const { prepared, stored } = await prepare(bytes, name);
      // The video is kept, without sound, and the owner must accept that first.
      expect(stored).toEqual(['video:avc']);
      expect(prepared.warnings).toContainEqual({ code: 'sound-dropped', message: M.soundDropped, confirm: true });
      // Never the claim that the sound was converted.
      expect(codes(prepared.warnings)).not.toContain('sound-converted');
    }, 60_000);
  }

  it('says nothing about the sound when it is copied as it is', async () => {
    const { prepared, stored } = await prepare(new Uint8Array(fs.readFileSync(SAMPLE)), 'clip.mp4');
    expect(stored).toEqual(['video:avc', 'audio:aac']);
    expect(codes(prepared.warnings)).not.toContain('sound-dropped');
    expect(codes(prepared.warnings)).not.toContain('sound-converted');
  }, 60_000);

  it('reads what a set-up conversion does with the sound', () => {
    const video = { type: 'video' as const };
    const audio = { type: 'audio' as const };
    type Conversion = Parameters<typeof soundOutcomeOf>[0];
    const outcome = (utilized: { type: string }[], discarded: { track: { type: string }; reason: string }[]) =>
      soundOutcomeOf({ utilizedTracks: utilized, discardedTracks: discarded } as unknown as Conversion);
    expect(outcome([video, audio], [])).toEqual({ kept: true, dropped: false });
    expect(outcome([video], [{ track: audio, reason: 'undecodable_source_codec' }])).toEqual({ kept: false, dropped: true });
    expect(outcome([video], [{ track: audio, reason: 'unknown_source_codec' }])).toEqual({ kept: false, dropped: true });
    expect(outcome([video], [{ track: audio, reason: 'no_encodable_target_codec' }])).toEqual({ kept: false, dropped: true });
    // The caller's own choice is not a dropped sound.
    expect(outcome([video], [{ track: audio, reason: 'discarded_by_user' }])).toEqual({ kept: false, dropped: false });
    expect(outcome([video], [])).toEqual({ kept: false, dropped: false });
  });
});
