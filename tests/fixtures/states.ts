/**
 * Content for the states the seed does not have (the canvas's States boards), built from a copy of
 * content/ so the seed itself never changes. Used by tests/states.test.ts, and written to a folder
 * for a dev server to show in the browser (SITE_CONTENT_DIR=<folder> next dev), with the words of
 * the States boards where they give them:
 *
 * - "states": Raven's gallery holds one photo, its second (S.2), and its build log one entry, its
 *   oldest, which is also the only entry on /log (S.4); the CAN bus tool has no photo and two
 *   callouts, which read as the row under the placeholder (S.1); MoonLamp carries a gallery block
 *   with no items, which renders nothing (S.1); and the STM32 suite takes the States board's test
 *   title, 72 characters (S.3).
 * - "logphoto": Raven's latest log entry has a photo, a stand-in as on the board, for the entry
 *   photo that fails to load (S.4, S.5).
 * - "nolog": no project has a build log, so /log says so and points to the projects (S.4).
 * - "heromedia": the hero shows the owner's photo (media mode), for the photo that fails to load (S.5).
 *
 * Only node:fs and node:path, so a plain Node script can import it as well as Vitest.
 */
import fs from 'node:fs';
import path from 'node:path';

export type StatesVariant = 'states' | 'logphoto' | 'nolog' | 'heromedia';

/** The States board's test string for a long title (States-LongTitle), not a project's. */
export const LONG_TITLE = 'A test title, not a project: long enough to take five lines at full size';

/** The callouts given to a project with no photo, for the row under its placeholder (test words, not facts). */
export const NO_PHOTO_CALLOUTS = [
  { label: 'Fixture span', value: '12 mm' },
  { label: 'Fixture mass', value: '3 g' },
];

/** The stand-in photo the fixture gives Raven's latest log entry: a file the seed already has. */
export const LOG_PHOTO = '/media/fsae-bronco-racing/img-7658.jpeg';

type Json = Record<string, any>;

function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function editProject(dir: string, slug: string, edit: (project: Json) => void): void {
  const file = path.join(dir, 'projects', `${slug}.json`);
  const project = readJson(file);
  edit(project);
  writeJson(file, project);
}

/**
 * Copies the content folder `from` to `to` (which must not exist yet, or be empty) and edits the
 * copy into `variant`. Returns `to`.
 */
export function writeStatesContent(from: string, to: string, variant: StatesVariant = 'states'): string {
  fs.cpSync(from, to, { recursive: true });

  if (variant === 'states') {
    editProject(to, 'raven', (raven) => {
      for (const block of raven.blocks) {
        if (block.type === 'gallery') block.items = block.items.slice(-1);
        if (block.type === 'log') block.entries = block.entries.slice(-1);
      }
    });
    editProject(to, 'can-bus-diagnostic-tool', (tool) => {
      tool.callouts = NO_PHOTO_CALLOUTS;
    });
    editProject(to, 'moonlamp', (lamp) => {
      lamp.blocks.push({ id: 'fx-empty-gallery', type: 'gallery', items: [] });
    });
    editProject(to, 'stm32-embedded-projects', (suite) => {
      suite.title = LONG_TITLE;
    });
  }

  if (variant === 'logphoto') {
    editProject(to, 'raven', (raven) => {
      const log = raven.blocks.find((block: Json) => block.type === 'log');
      log.entries[0].media = [{ kind: 'image', src: LOG_PHOTO, alt: '' }];
    });
  }

  if (variant === 'nolog') {
    for (const name of fs.readdirSync(path.join(to, 'projects'))) {
      editProject(to, name.replace(/\.json$/, ''), (project) => {
        project.blocks = project.blocks.filter((block: Json) => block.type !== 'log');
      });
    }
  }

  if (variant === 'heromedia') {
    const file = path.join(to, 'site.json');
    const site = readJson(file);
    site.settings.heroMode = 'media';
    writeJson(file, site);
  }

  return to;
}
