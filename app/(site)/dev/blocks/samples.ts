/**
 * One of every block for /dev/blocks, on the sample files in public/dev/samples/ (made by
 * scripts/make-samples.mjs). Words here are sample text only: no facts about the owner. Each
 * block is checked against the schema when the page is built, so a malformed sample fails the
 * build. This file, the page, and the samples are removed before release.
 */
import { BlockSchema } from '@/lib/schema';
import type { Block } from '@/lib/types';
// The audio samples' waveforms, computed by scripts/make-samples.mjs as the admin will at upload.
import SAMPLE_PEAKS from './sample-peaks.json';

const S = '/dev/samples';

export interface Sample {
  /** The anchor id of the section. */
  id: string;
  /** The block type (or types) the section shows. */
  title: string;
  /** What to try in the section. */
  note: string;
  blocks: Block[];
}

const RAW: { id: string; title: string; note: string; blocks: unknown[] }[] = [
  {
    id: 'heading',
    title: 'heading',
    note: 'A section heading. It renders one level under the section label above it.',
    blocks: [{ id: 'd-heading', type: 'heading', text: 'A heading block' }],
  },
  {
    id: 'text',
    title: 'text',
    note: 'Markdown with emphasis, links, inline code, and a list. A link to a page the site does not render prints as plain text.',
    blocks: [
      {
        id: 'd-text',
        type: 'text',
        md: 'A paragraph with **bold**, *italic*, and `inline code`. Here is [a link to the projects page](/projects), [an outside link](https://github.com/AmjadRx), and [a link to a page that does not exist](/projects/no-such-project).\n\n- First list item\n- Second list item\n- Third list item',
      },
    ],
  },
  {
    id: 'image',
    title: 'image',
    note: 'Select the photo to open the lightbox; zoom with the buttons, the wheel, a pinch, or the plus and minus keys, and drag to pan.',
    blocks: [
      {
        id: 'd-image',
        type: 'image',
        media: { kind: 'image', src: `${S}/photo-wide.webp`, alt: 'A fractal pattern in orange and green on a blue field', caption: 'Sample photo, 1600 by 1000 pixels.' },
      },
    ],
  },
  {
    id: 'gallery',
    title: 'gallery',
    note: 'A mixed gallery: a photo, a video, and a 3D model. Each opens in the lightbox; arrow keys move between items and Escape closes.',
    blocks: [
      {
        id: 'd-gallery',
        type: 'gallery',
        items: [
          { kind: 'image', src: `${S}/photo-tall.webp`, alt: 'Soft color gradients in a tall frame', caption: 'A tall photo.' },
          { kind: 'image', src: `${S}/photo-wide.webp`, alt: 'A fractal pattern in orange and green on a blue field', caption: 'A wide photo.' },
          {
            kind: 'video',
            src: `${S}/clip.mp4`,
            poster: `${S}/clip-poster.webp`,
            captions: `${S}/clip.vtt`,
            alt: 'A color test pattern with a moving counter',
            caption: 'A video in the gallery.',
          },
          {
            kind: 'model',
            src: `${S}/model.glb`,
            poster: `${S}/model-poster.webp`,
            alt: 'A sample assembly of four parts: a base plate, a column, a ring, and a cap',
            caption: 'A 3D model in the gallery.',
          },
        ],
      },
    ],
  },
  {
    id: 'video',
    title: 'video',
    note: 'Play, pause, seek, mute, captions, and full screen. Captions come from a WebVTT file.',
    blocks: [
      {
        id: 'd-video',
        type: 'video',
        media: {
          kind: 'video',
          src: `${S}/clip.mp4`,
          poster: `${S}/clip-poster.webp`,
          captions: `${S}/clip.vtt`,
          alt: 'A color test pattern with a moving counter and a test tone',
          caption: 'Sample video, 12 seconds, with captions.',
        },
      },
    ],
  },
  {
    id: 'video-scrub',
    title: 'video with scrub',
    note: 'With a mouse or trackpad, scrolling moves through this video. With a touch screen, or with reduced motion set, it is a normal player.',
    blocks: [
      {
        id: 'd-video-scrub',
        type: 'video',
        scrub: true,
        media: {
          kind: 'video',
          src: `${S}/clip.mp4`,
          poster: `${S}/clip-poster.webp`,
          captions: `${S}/clip.vtt`,
          alt: 'A color test pattern with a moving counter',
          caption: 'Scroll to scrub.',
        },
      },
    ],
  },
  {
    id: 'video-embed',
    title: 'video (YouTube embed)',
    note: 'A click-to-load player: nothing loads from YouTube until you press the button. The sample is a public-domain NASA video.',
    blocks: [
      {
        id: 'd-embed',
        type: 'video',
        media: {
          kind: 'embed',
          src: 'https://www.youtube.com/watch?v=uM7HD7CAswc',
          caption: 'Sample embed: Apollo 11 lifts off, July 16, 1969 (NASA, public domain).',
        },
      },
    ],
  },
  {
    id: 'spec-table',
    title: 'specTable',
    note: 'Label and value rows.',
    blocks: [
      {
        id: 'd-spec',
        type: 'specTable',
        rows: [
          { label: 'First label', value: 'First value' },
          { label: 'Second label', value: '12.5 units' },
          { label: 'Third label', value: 'A longer value that wraps onto a second line on a narrow screen' },
        ],
      },
    ],
  },
  {
    id: 'bullets',
    title: 'bullets',
    note: 'A list with its own heading.',
    blocks: [{ id: 'd-bullets', type: 'bullets', heading: 'A list heading', items: ['First point', 'Second point, with **bold** text', 'Third point'] }],
  },
  {
    id: 'two-col',
    title: 'twoCol',
    note: 'Two columns of blocks; they stack on a phone.',
    blocks: [
      {
        id: 'd-twocol',
        type: 'twoCol',
        left: [
          { id: 'd-twocol-h', type: 'heading', text: 'Left column' },
          { id: 'd-twocol-t', type: 'text', md: 'Text in the left column.' },
        ],
        right: [
          { id: 'd-twocol-s', type: 'specTable', rows: [{ label: 'Right label', value: 'Right value' }] },
          { id: 'd-twocol-b', type: 'bullets', items: ['A point on the right'] },
        ],
      },
    ],
  },
  {
    id: 'quote',
    title: 'quote',
    note: 'A quotation with its attribution.',
    blocks: [{ id: 'd-quote', type: 'quote', text: 'A sample quotation for the quote block.', attribution: 'Sample attribution' }],
  },
  {
    id: 'link-row',
    title: 'linkRow',
    note: 'A row of links; a link to a page that does not exist prints as plain text.',
    blocks: [
      {
        id: 'd-links',
        type: 'linkRow',
        links: [
          { label: 'GitHub profile', url: 'https://github.com/AmjadRx', icon: 'github' },
          { label: 'All projects', url: '/projects' },
          { label: 'A missing page', url: '/projects/no-such-project' },
        ],
      },
    ],
  },
  {
    id: 'roadmap',
    title: 'roadmap',
    note: 'Stages up to the current one are filled; every stage names its status in words.',
    blocks: [
      {
        id: 'd-roadmap',
        type: 'roadmap',
        stages: [
          { n: 1, title: 'First stage', desc: 'Sample stage.', status: 'done' },
          { n: 2, title: 'Second stage', desc: 'Sample stage.', status: 'in-progress' },
          { n: 3, title: 'Third stage', desc: 'Sample stage.', status: 'next' },
          { n: 4, title: 'Fourth stage', desc: 'Sample stage.', status: 'future' },
        ],
      },
    ],
  },
  {
    id: 'log',
    title: 'log',
    note: 'The revision table, newest first, with a photo on one entry. Dates of different precision sort together.',
    blocks: [
      {
        id: 'd-log',
        type: 'log',
        entries: [
          { date: '2026-03', title: 'Second sample entry', md: 'An entry with a month only.' },
          {
            date: '2026-05-20',
            title: 'Newest sample entry',
            md: 'An entry with a photo.',
            media: [{ kind: 'image', src: `${S}/log-photo.webp`, alt: 'A pattern of cyan cells on a dark blue field' }],
          },
          { date: '2025-11-02', title: 'Oldest sample entry', md: 'The first entry.' },
        ],
      },
    ],
  },
  {
    id: 'file',
    title: 'file',
    note: 'Any file as a download, with its type and size.',
    blocks: [{ id: 'd-file', type: 'file', label: 'Sample data file', src: `${S}/data.csv`, note: 'A small comma-separated file.' }],
  },
  {
    id: 'callout',
    title: 'callout',
    note: 'Two tones: a note and a status.',
    blocks: [
      { id: 'd-callout-note', type: 'callout', tone: 'note', md: 'A sample note callout.' },
      { id: 'd-callout-status', type: 'callout', tone: 'status', md: 'A sample status callout.' },
    ],
  },
  {
    id: 'model3d',
    title: 'model3d',
    note: 'Drag to orbit. After you press the model, the wheel or a pinch zooms; until then the wheel scrolls the page. Switch between the Realistic, Blueprint, and Thermal views, open the exploded view, and hover or tap the parts list. On a phone, tap to load.',
    blocks: [
      {
        id: 'd-model',
        type: 'model3d',
        media: {
          kind: 'model',
          src: `${S}/model.glb`,
          poster: `${S}/model-poster.webp`,
          alt: 'A sample assembly of four parts: a base plate, a column, a ring, and a cap',
          caption: 'Sample model, four named parts.',
        },
        views: ['realistic', 'blueprint', 'thermal'],
        explode: true,
        callouts: [
          { label: 'Base width', value: '2.0 m' },
          { label: 'Overall height', value: '1.92 m' },
        ],
      },
    ],
  },
  {
    id: 'document-pdf',
    title: 'document (PDF)',
    note: 'Turn pages, zoom, and search; the first page is the poster.',
    blocks: [
      {
        id: 'd-pdf',
        type: 'document',
        title: 'Sample PDF document',
        media: {
          kind: 'document',
          src: `${S}/document.pdf`,
          poster: `${S}/document-poster.webp`,
          alt: 'A three-page sample document with a table and repeated search words',
        },
      },
    ],
  },
  {
    id: 'document-word',
    title: 'document (Word)',
    note: 'A Word file renders inside an isolated frame.',
    blocks: [
      {
        id: 'd-docx',
        type: 'document',
        title: 'Sample Word document',
        media: { kind: 'document', src: `${S}/document.docx`, alt: 'A three-page sample Word document with headings, paragraphs, and a table' },
      },
    ],
  },
  {
    id: 'audio',
    title: 'audio',
    note: 'A waveform player: play, pause, and seek on the waveform. The waveform comes with the page, stored with the media; the player never downloads the file to draw it.',
    blocks: [
      {
        id: 'd-audio',
        type: 'audio',
        title: 'Sample audio, a chord of test tones',
        media: { kind: 'audio', src: `${S}/tone.mp3`, alt: 'A soft chord of three test tones, 8 seconds', waveform: SAMPLE_PEAKS['tone.mp3'] },
      },
    ],
  },
  {
    id: 'audio-long',
    title: 'audio (over 1 MB)',
    note: 'A longer file with its stored waveform: nothing large loads before you press play, and then only the stream the player needs.',
    blocks: [
      {
        id: 'd-audio-long',
        type: 'audio',
        title: 'Sample audio, 80 seconds',
        media: { kind: 'audio', src: `${S}/tone-long.mp3`, alt: 'Two test tones that swell and fade, 80 seconds', waveform: SAMPLE_PEAKS['tone-long.mp3'] },
      },
    ],
  },
  {
    id: 'audio-plain',
    title: 'audio (no stored waveform)',
    note: 'Media without a stored waveform keeps the plain progress bar; the file is never downloaded to draw one.',
    blocks: [
      {
        id: 'd-audio-plain',
        type: 'audio',
        title: 'Sample audio without a waveform',
        media: { kind: 'audio', src: `${S}/tone.mp3`, alt: 'A soft chord of three test tones, 8 seconds' },
      },
    ],
  },
  {
    id: 'code',
    title: 'code',
    note: 'Highlighted at build time, with a copy button and a link to the repository.',
    blocks: [
      {
        id: 'd-code',
        type: 'code',
        language: 'ts',
        code: "// Sample code for the code block.\nexport function clamp(value: number, min: number, max: number): number {\n  return Math.min(max, Math.max(min, value));\n}\n\nconst samples = [3, 14, 15].map((n) => clamp(n, 0, 10));\nconsole.log(samples);\n",
        repoUrl: 'https://github.com/AmjadRx/MoonLight',
      },
      {
        id: 'd-code-unknown',
        type: 'code',
        language: 'not-a-language',
        code: 'A language the highlighter does not know falls back to plain text.',
      },
    ],
  },
  {
    id: 'compare',
    title: 'compare',
    note: 'Drag the divider, or focus it and use the arrow keys.',
    blocks: [
      {
        id: 'd-compare',
        type: 'compare',
        before: { kind: 'image', src: `${S}/before.webp`, alt: 'The fractal pattern, blurred and in gray' },
        after: { kind: 'image', src: `${S}/after.webp`, alt: 'The fractal pattern, sharp and in color' },
      },
    ],
  },
  {
    id: 'panzoom',
    title: 'panzoom',
    note: 'A large drawing: drag to pan, zoom with the buttons, the wheel, a pinch, or the keyboard. The overview shows where you are.',
    blocks: [
      {
        id: 'd-panzoom',
        type: 'panzoom',
        media: { kind: 'image', src: `${S}/drawing.svg`, alt: 'A sample drawing: a grid with zone labels, concentric circles, and a line of fine print at the center', caption: 'Sample drawing, 2400 by 1600.' },
      },
    ],
  },
  {
    id: 'panzoom-raster',
    title: 'panzoom (PNG)',
    note: 'The same drawing as a raster image, served through the image optimizer.',
    blocks: [
      {
        id: 'd-panzoom-png',
        type: 'panzoom',
        media: { kind: 'image', src: `${S}/drawing.png`, alt: 'A sample drawing: a grid with zone labels, concentric circles, and a line of fine print at the center', caption: 'Sample drawing as PNG, 2400 by 1600.' },
      },
    ],
  },
  {
    id: 'repo',
    title: 'repo',
    note: 'A public repository card, fetched at build time, with a plain link as the fallback.',
    blocks: [{ id: 'd-repo', type: 'repo', url: 'https://github.com/AmjadRx/MoonLight' }],
  },
  {
    id: 'unknown',
    title: 'an unknown block type',
    note: 'This section holds a block of a type the site does not know. Nothing should render under this line.',
    blocks: [{ id: 'd-unknown', type: 'hologram', depth: 3 }],
  },
];

export const SAMPLES: Sample[] = RAW.map((sample) => ({
  ...sample,
  blocks: sample.blocks.map((block) => BlockSchema.parse(block)),
}));
