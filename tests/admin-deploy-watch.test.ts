/**
 * The preview watch after a save (components/admin/shell/deploy.ts, `watchDeploy`), driven with
 * fake timers against a stubbed /api/status that answers like the route: the newest draft head,
 * the draft's unpublished commits, and the deployment of that head or why it cannot be read. Every
 * media upload and delete is its own commit, so the head moves past the saved commit; the watch
 * follows it, starts its five minutes again when it moves, names the commit it waits for, never
 * follows a head without the saved commit, never reports a timeout for a head that is no longer
 * the newest or whose build state it could not read, and stops twenty minutes after the save. The
 * last part runs the same watch against the real route and the fake GitHub. No request leaves
 * the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { GET as statusRoute } from '../app/api/status/route';
import {
  DEPLOY_FIRST_POLL_MS,
  DEPLOY_POLL_MS,
  DEPLOY_WATCH_LIMIT_MS,
  DEPLOY_WATCH_MESSAGES,
  DEPLOY_WATCH_MS,
  watchDeploy,
  type DeployView,
} from '../components/admin/shell/deploy';
import type { ApiResult, DeployState, StatusResponse } from '../lib/admin/contract';
import { DEPLOY_MESSAGES } from '../lib/admin/server/deploy';
import { adminRequest, installFakeGitHub, stubAdminEnv, type FakeDeployment, type FakeGitHub } from './admin-github-fake';

const LIVE = 'e'.repeat(40);
const PREV = 'f'.repeat(40);
const SAVED = 'a'.repeat(40);
const UPLOAD = 'b'.repeat(40);
const REMOVAL = 'c'.repeat(40);
const MINUTE = 60_000;
const CANNOT_READ = DEPLOY_MESSAGES.githubCannotRead;

/** What the server knows: the draft, each commit's build, and whether it answers at all. */
interface World {
  /** The draft's commits the published branch lacks, oldest first. */
  history: string[];
  /** The draft head, or null when the route cannot read it. */
  head: string | null;
  builds: Map<string, DeployState['state']>;
  answers: 'yes' | 'failing' | 'signed-out';
  /** Why the deploy lookup cannot read build state, or null when it can. */
  unreadable: string | null;
  /** Whether the answer lists the draft's unpublished commits (the compare answered). */
  commitsRead: boolean;
}

/** The unpublished commits up to the head: all of them for the newest, none when the draft is the published head. */
function draftCommitsOf(world: World): string[] | null {
  if (!world.head || !world.commitsRead) return null;
  const at = world.history.indexOf(world.head);
  return at === -1 ? [] : world.history.slice(0, at + 1);
}

function statusOf(world: World): StatusResponse {
  const state = world.head ? world.builds.get(world.head) : undefined;
  return {
    ok: true,
    runtime: { vercelEnv: 'preview', branch: 'v3', commit: SAVED, node: 'v24.0.0' },
    env: [],
    github: {
      configured: true,
      ok: world.head !== null,
      detail: '',
      tokenKind: 'fine-grained',
      repo: 'owner/name',
      liveBranch: 'sandbox-main',
      draftBranch: 'sandbox-draft',
      liveExists: true,
      draftExists: world.head !== null,
      draftHead: world.head,
      draftCommits: draftCommitsOf(world),
      writeAccess: null,
      writeDetail: 'Not known.',
      ahead: world.history.length,
      behind: 0,
    },
    storage: { repo: { target: 'github', problem: null }, blob: { configured: false, host: null }, limits: { repoMaxBytes: 4_000_000, blobMaxBytes: 500_000_000 } },
    contentCheck: { publicRules: 40, blocklistSet: true, failClosed: true },
    // Like GitHub's deployment records: the deployment of the head, none before its build starts,
    // or none and why when the records cannot be read.
    deploy: {
      source: 'github',
      detail: world.unreadable ?? 'From GitHub deployment records.',
      draft:
        !world.unreadable && state && world.head
          ? { state, url: `https://build-${world.head.slice(0, 7)}.example.test`, sha: world.head, createdAt: null }
          : null,
      live: null,
      draftUnknown: world.head ? world.unreadable : null,
      liveUnknown: world.unreadable,
    },
    preview: { branch: 'sandbox-draft', url: 'https://draft.example.test' },
    session: { expiresAt: 0 },
    security: { loginLimit: 'runtime-cache', address: 'x-real-ip', detail: 'Counted in Vercel Runtime Cache.' },
  };
}

let world: World;
let views: DeployView[];
let status: Mock<(signal: AbortSignal) => Promise<ApiResult<StatusResponse>>>;
let stop: (() => void) | undefined;

function start(commit = SAVED): void {
  stop = watchDeploy(commit, { status, show: (view) => views.push(view) });
}

/** A new commit on the draft (an upload, a delete, another save), and its build when it has one. */
function push(sha: string, state?: DeployState['state']): void {
  world.history.push(sha);
  world.head = sha;
  if (state) world.builds.set(sha, state);
}

const last = (): DeployView => views[views.length - 1];
/** Every timeout the watch reported, by the commit it named. */
const timeouts = (): string[] => views.filter((view) => view.detail?.startsWith('No finished preview build')).map((view) => view.detail!);

/** No poll after the watch ended. */
async function expectStopped(): Promise<void> {
  const polls = status.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10 * MINUTE);
  expect(status.mock.calls.length).toBe(polls);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  world = { history: [SAVED], head: SAVED, builds: new Map(), answers: 'yes', unreadable: null, commitsRead: true };
  views = [];
  stop = undefined;
  status = vi.fn(async (_signal: AbortSignal): Promise<ApiResult<StatusResponse>> => {
    if (world.answers === 'signed-out') return { ok: false, code: 'unauthorized', error: 'Your session has ended.' };
    if (world.answers === 'failing') return { ok: false, code: 'server', error: 'The server could not be reached.' };
    return statusOf(world);
  });
});

afterEach(() => {
  stop?.();
  vi.useRealTimers();
});

describe('the preview watch after a save', () => {
  it('follows the newest draft head: a media upload after the save is the build it waits for', async () => {
    world.builds.set(SAVED, 'building');
    start();
    expect(last()).toEqual({ phase: 'waiting', url: null, detail: null, commit: SAVED });

    // An upload lands right after the save. The saved commit's build never finishes (Vercel
    // builds the newest head), which used to leave the save bar waiting for it for five minutes.
    push(UPLOAD, 'building');
    await vi.advanceTimersByTimeAsync(DEPLOY_FIRST_POLL_MS);
    expect(last()).toMatchObject({ phase: 'building', commit: UPLOAD, url: 'https://build-bbbbbbb.example.test' });

    world.builds.set(UPLOAD, 'ready');
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toMatchObject({ phase: 'ready', commit: UPLOAD, url: 'https://build-bbbbbbb.example.test' });

    // Done: no more polls, and nothing ever said the build was missing.
    await expectStopped();
    expect(timeouts()).toEqual([]);
  });

  it('starts its five minutes again when the head moves, and gives up naming the head it waited for', async () => {
    world.builds.set(SAVED, 'building');
    start();
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(last()).toMatchObject({ phase: 'building', commit: SAVED });

    // A media file is deleted four minutes in: the newest head is now that commit.
    push(REMOVAL, 'queued');
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toMatchObject({ phase: 'building', commit: REMOVAL });

    // Past five minutes from the save, but not from the move: still waiting, no timeout.
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(last()).toMatchObject({ phase: 'building', commit: REMOVAL });
    expect(timeouts()).toEqual([]);

    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(last()).toMatchObject({ phase: 'unknown', commit: REMOVAL, detail: DEPLOY_WATCH_MESSAGES.timedOut(REMOVAL) });
    expect(last().detail).toContain('commit ccccccc');
    expect(timeouts()).toEqual([DEPLOY_WATCH_MESSAGES.timedOut(REMOVAL)]);
    await expectStopped();
  });

  it('never reports a timeout for a head that is no longer the newest', async () => {
    world.builds.set(SAVED, 'building');
    start();
    await vi.advanceTimersByTimeAsync(4 * MINUTE + 30_000);

    // The status cannot be read across the five-minute mark, while an upload moves the head on.
    world.answers = 'failing';
    push(UPLOAD, 'building');
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(last()).toMatchObject({ phase: 'building', commit: SAVED, detail: null });

    // The server answers but cannot read the draft head: still no timeout for the saved commit.
    world.answers = 'yes';
    world.head = null;
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(last()).toMatchObject({ phase: 'building', commit: SAVED, detail: null });

    world.head = UPLOAD;
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toMatchObject({ phase: 'building', commit: UPLOAD });
    world.builds.set(UPLOAD, 'ready');
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toMatchObject({ phase: 'ready', commit: UPLOAD });
    expect(timeouts()).toEqual([]);
  });

  it('ends with a plain sentence after five minutes without an answer that names the draft head', async () => {
    world.answers = 'failing';
    start();
    await vi.advanceTimersByTimeAsync(DEPLOY_WATCH_MS - DEPLOY_POLL_MS);
    expect(last()).toMatchObject({ phase: 'waiting', commit: SAVED });
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toMatchObject({ phase: 'unknown', commit: SAVED, detail: DEPLOY_WATCH_MESSAGES.unread });
    expect(timeouts()).toEqual([]);
    await expectStopped();
  });

  it('reports a failed build of the newest head, and stops quietly when the session ends', async () => {
    push(UPLOAD, 'error');
    start();
    await vi.advanceTimersByTimeAsync(DEPLOY_FIRST_POLL_MS);
    expect(last()).toMatchObject({ phase: 'failed', commit: UPLOAD });
    stop?.();

    views = [];
    world.answers = 'signed-out';
    start();
    await vi.advanceTimersByTimeAsync(DEPLOY_FIRST_POLL_MS);
    expect(last()).toMatchObject({ phase: 'unknown', commit: SAVED, detail: DEPLOY_WATCH_MESSAGES.signedOut });
    await expectStopped();
  });

  it('stops polling and showing once stopped', async () => {
    world.builds.set(SAVED, 'building');
    start();
    await vi.advanceTimersByTimeAsync(DEPLOY_FIRST_POLL_MS);
    const shown = views.length;
    const polls = status.mock.calls.length;
    stop?.();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(views.length).toBe(shown);
    expect(status.mock.calls.length).toBe(polls);
    expect(status.mock.calls[0][0].aborted).toBe(true);
  });

  it('never follows a head without the saved commit: a read that still names the head before the save', async () => {
    // The head before the save has a finished build. Following it ended the watch "ready" with a
    // build that does not hold the save.
    world.history = [PREV, SAVED];
    world.head = PREV;
    world.builds.set(PREV, 'ready');
    world.builds.set(SAVED, 'building');
    start();
    await vi.advanceTimersByTimeAsync(DEPLOY_FIRST_POLL_MS);
    expect(last()).toEqual({ phase: 'waiting', url: null, detail: null, commit: SAVED });

    world.head = SAVED;
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toMatchObject({ phase: 'building', commit: SAVED });
    world.builds.set(SAVED, 'ready');
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toMatchObject({ phase: 'ready', commit: SAVED, url: 'https://build-aaaaaaa.example.test' });
    expect(views.some((view) => view.commit === PREV)).toBe(false);
  });

  it('stops following when a discard elsewhere takes the saved commit off the draft, and says so', async () => {
    world.builds.set(SAVED, 'building');
    push(UPLOAD, 'building');
    start();
    await vi.advanceTimersByTimeAsync(DEPLOY_FIRST_POLL_MS);
    expect(last()).toMatchObject({ phase: 'building', commit: UPLOAD });

    // Another tab discards the draft: it is the published head again, whose build is long ready.
    world.history = [];
    world.head = LIVE;
    world.builds.set(LIVE, 'ready');
    await vi.advanceTimersByTimeAsync(DEPLOY_WATCH_MS - DEPLOY_POLL_MS);
    expect(last()).toMatchObject({ phase: 'building', commit: UPLOAD, detail: null });
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toMatchObject({ phase: 'unknown', commit: UPLOAD, detail: DEPLOY_WATCH_MESSAGES.left(UPLOAD) });
    expect(views.some((view) => view.commit === LIVE || view.phase === 'ready')).toBe(false);
    expect(timeouts()).toEqual([]);
    await expectStopped();
  });

  it('does not follow a newer head while the answer cannot list the unpublished commits', async () => {
    world.builds.set(SAVED, 'building');
    start();
    world.commitsRead = false;
    push(UPLOAD, 'building');
    await vi.advanceTimersByTimeAsync(DEPLOY_FIRST_POLL_MS + DEPLOY_POLL_MS);
    expect(views.some((view) => view.commit === UPLOAD)).toBe(false);

    world.commitsRead = true;
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toMatchObject({ phase: 'building', commit: UPLOAD });
  });

  it('waits for the newest head by name while its deployment has not started yet', async () => {
    world.builds.set(SAVED, 'building');
    start();
    await vi.advanceTimersByTimeAsync(DEPLOY_FIRST_POLL_MS);
    expect(last()).toMatchObject({ phase: 'building', commit: SAVED });

    // An upload whose deployment record Vercel has not written yet: the lookup answered, and found none.
    push(UPLOAD);
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toEqual({ phase: 'waiting', url: 'https://draft.example.test', detail: null, commit: UPLOAD });

    world.builds.set(UPLOAD, 'building');
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toMatchObject({ phase: 'building', commit: UPLOAD });
  });

  it('says why the build state cannot be read, and ends with that, never "no finished build"', async () => {
    world.unreadable = CANNOT_READ;
    world.builds.set(SAVED, 'ready');
    start();
    await vi.advanceTimersByTimeAsync(DEPLOY_FIRST_POLL_MS);
    expect(last()).toEqual({ phase: 'unknown', url: 'https://draft.example.test', detail: CANNOT_READ, commit: SAVED });

    await vi.advanceTimersByTimeAsync(DEPLOY_WATCH_MS);
    expect(last()).toMatchObject({ phase: 'unknown', commit: SAVED, detail: DEPLOY_WATCH_MESSAGES.unreadState(SAVED, CANNOT_READ) });
    expect(last().detail).toContain('commit aaaaaaa could not be read');
    expect(timeouts()).toEqual([]);
    await expectStopped();
  });

  it('decides the end by the last answer: a build state read again ends with no finished build', async () => {
    world.unreadable = CANNOT_READ;
    world.builds.set(SAVED, 'building');
    start();
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(last()).toMatchObject({ phase: 'unknown', detail: CANNOT_READ });

    world.unreadable = null;
    await vi.advanceTimersByTimeAsync(DEPLOY_WATCH_MS - 2 * MINUTE);
    expect(last()).toMatchObject({ phase: 'unknown', commit: SAVED, detail: DEPLOY_WATCH_MESSAGES.timedOut(SAVED) });
  });

  it('stops twenty minutes after the save however often the head moves, naming the newest head', async () => {
    world.builds.set(SAVED, 'building');
    start();
    // A media commit every four minutes keeps restarting the five-minute wait.
    const heads = ['1', '2', '3', '4', '5'].map((digit) => digit.repeat(40));
    for (const head of heads.slice(0, 4)) {
      await vi.advanceTimersByTimeAsync(4 * MINUTE);
      push(head, 'building');
    }
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(last()).toMatchObject({ phase: 'unknown', commit: heads[3], detail: DEPLOY_WATCH_MESSAGES.limit(heads[3]) });
    expect(last().detail).toContain('commit 4444444');
    expect(timeouts()).toEqual([]);
    expect(status.mock.calls.length).toBeLessThanOrEqual(DEPLOY_WATCH_LIMIT_MS / DEPLOY_POLL_MS);

    push(heads[4], 'building');
    await expectStopped();
  });
});

// ---------------------------------------------------------------------------------------------
// The same watch against the real /api/status route and the fake GitHub
// ---------------------------------------------------------------------------------------------

/**
 * GitHub's compare lists the commits the head has and the base lacks, oldest first; the fake
 * leaves the list out, so this adds it to every compare the route asks for.
 */
function listCompareCommits(fake: FakeGitHub): void {
  const reachable = (sha: string): string[] => {
    const seen: string[] = [];
    const queue = [sha];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (seen.includes(next)) continue;
      seen.push(next);
      queue.push(...(fake.commits.get(next)?.parents ?? []));
    }
    return seen;
  };
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const answer = await fake.fetch(input, init);
    const match = /\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(String(input instanceof Request ? input.url : input));
    if (!match || answer.status !== 200) return answer;
    const base = reachable(match[1]);
    const commits = reachable(match[2])
      .filter((sha) => !base.includes(sha))
      .reverse()
      .map((sha) => ({ sha }));
    return new Response(JSON.stringify({ ...((await answer.json()) as object), commits }), { status: 200 });
  });
}

/** A deployment record of `sha` with one status, made now. */
function record(id: number, sha: string, state: string, environment = 'Preview', url?: string): FakeDeployment {
  const at = new Date(Date.now()).toISOString();
  return { id, sha, environment, created_at: at, statuses: [{ state, created_at: at, ...(url ? { environment_url: url } : {}) }] };
}

describe('the preview watch through the real route', () => {
  let fake: FakeGitHub;
  let main: string;
  let saved: string;

  beforeEach(() => {
    // Deploy state from GitHub's deployment records (no VERCEL_TOKEN), and a preview address by hand.
    stubAdminEnv({ VERCEL_TOKEN: '', DRAFT_PREVIEW_URL: 'https://draft.example.test' });
    fake = installFakeGitHub();
    listCompareCommits(fake);
    main = fake.refs.get('main')!;
    fake.refs.set('draft', main);
    saved = fake.push('draft', { 'content/projects/raven.json': '{}' }, 'save');
    status = vi.fn(async () => JSON.parse(await (await statusRoute(adminRequest('GET', '/api/status'))).text()) as ApiResult<StatusResponse>);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('follows an upload, by name while its deployment record does not exist yet, until its build is ready', async () => {
    const records = [record(1, saved, 'in_progress')];
    fake.deployments = records;
    start(saved);
    await vi.advanceTimersByTimeAsync(DEPLOY_FIRST_POLL_MS);
    expect(last()).toMatchObject({ phase: 'building', commit: saved });

    // A media upload lands; Vercel has not written its deployment record yet.
    const upload = fake.push('draft', { 'public/media/site/new.webp': new Uint8Array([1, 2, 3]) }, 'upload');
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toEqual({ phase: 'waiting', url: 'https://draft.example.test', detail: null, commit: upload });

    records.push(record(2, upload, 'in_progress'));
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toMatchObject({ phase: 'building', commit: upload });

    records[1].statuses.push({ state: 'success', environment_url: 'https://site-upload.vercel.app', created_at: new Date(Date.now()).toISOString() });
    await vi.advanceTimersByTimeAsync(DEPLOY_POLL_MS);
    expect(last()).toEqual({ phase: 'ready', url: 'https://site-upload.vercel.app', detail: null, commit: upload });
    expect(timeouts()).toEqual([]);
  });

  it('ends with why the build state cannot be read when the token cannot read deployments', async () => {
    fake.deployments = null; // GitHub answers 403, as for a token without Deployments read
    start(saved);
    await vi.advanceTimersByTimeAsync(DEPLOY_FIRST_POLL_MS);
    expect(last()).toMatchObject({ phase: 'unknown', commit: saved, detail: CANNOT_READ });

    await vi.advanceTimersByTimeAsync(DEPLOY_WATCH_MS);
    expect(last()).toMatchObject({ phase: 'unknown', commit: saved, detail: DEPLOY_WATCH_MESSAGES.unreadState(saved, CANNOT_READ) });
    expect(timeouts()).toEqual([]);
  });

  it('never follows the published head after a discard elsewhere, and says why it stopped', async () => {
    fake.deployments = [record(1, saved, 'in_progress'), record(2, main, 'success', 'Production', 'https://site-live.vercel.app')];
    start(saved);
    await vi.advanceTimersByTimeAsync(DEPLOY_FIRST_POLL_MS);
    expect(last()).toMatchObject({ phase: 'building', commit: saved });

    // Another tab discards the draft: the draft branch is the published head again.
    fake.refs.set('draft', main);
    await vi.advanceTimersByTimeAsync(DEPLOY_WATCH_MS);
    expect(last()).toMatchObject({ phase: 'unknown', commit: saved, detail: DEPLOY_WATCH_MESSAGES.left(saved) });
    expect(views.every((view) => view.commit === saved && view.phase !== 'ready')).toBe(true);
  });
});
