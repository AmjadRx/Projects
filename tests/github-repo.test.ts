import { beforeEach, describe, expect, it, vi } from 'vitest';

// lib/github-repo.ts is marked server-only; outside a React server build that marker throws.
vi.mock('server-only', () => ({}));

import {
  clearRepoCardCache,
  isSiteRepository,
  loadRepoCard,
  parseRepoUrl,
  type RepoCardOptions,
  type RepoFetcher,
} from '../lib/github-repo';

// Every value here is made up. No test reads the real environment: each call passes its own
// `env`, so a real GITHUB_TOKEN or CONTENT_BLOCKLIST on this machine is never read or printed.
const TERM = 'zorblax';
const CASE_TERM = 'Quuxly';
const FAKE_TOKEN = 'synthetic-token-for-tests';
const ENV = { CONTENT_BLOCKLIST: `${TERM}|cs:${CASE_TERM}`, GITHUB_TOKEN: '', GITHUB_REPO: 'example-owner/site-repo' };
const URL_OK = 'https://github.com/Example-Owner/demo-repo';
const API_URL = 'https://api.github.com/repos/Example-Owner/demo-repo';

function repoJson(overrides: Record<string, unknown> = {}) {
  return {
    name: 'demo-repo',
    full_name: 'Example-Owner/demo-repo',
    html_url: 'https://github.com/Example-Owner/demo-repo',
    description: 'A small sample repository for tests.',
    language: 'TypeScript',
    pushed_at: '2026-08-13T17:04:05Z',
    private: false,
    visibility: 'public',
    ...overrides,
  };
}

function answer(status: number, body: unknown) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

function fetcherFor(...answers: (() => Promise<Response>)[]) {
  const queue = [...answers];
  return vi.fn<RepoFetcher>(async () => {
    const next = queue.shift();
    if (!next) throw new Error('No more answers in this test.');
    return next();
  });
}

function setup(fetcher: RepoFetcher, env: Record<string, string | undefined> = ENV, extra: Partial<RepoCardOptions> = {}) {
  const warnings: string[] = [];
  const options: RepoCardOptions = { fetcher, env, warn: (message) => warnings.push(message), timeoutMs: 2000, ...extra };
  return { options, warnings };
}

beforeEach(() => {
  clearRepoCardCache();
});

describe('parseRepoUrl', () => {
  it('accepts https://github.com/OWNER/REPO, with or without a final slash', () => {
    expect(parseRepoUrl(URL_OK)).toEqual({ owner: 'Example-Owner', repo: 'demo-repo' });
    expect(parseRepoUrl(`${URL_OK}/`)).toEqual({ owner: 'Example-Owner', repo: 'demo-repo' });
    expect(parseRepoUrl('  https://github.com/a/b.c_d-e  ')).toEqual({ owner: 'a', repo: 'b.c_d-e' });
  });

  it('refuses every other address', () => {
    const refused = [
      'http://github.com/a/b',
      'https://www.github.com/a/b',
      'https://gitlab.com/a/b',
      'https://github.com/a',
      'https://github.com/a/b/tree/main',
      'https://github.com/a/b?tab=readme',
      'https://github.com/a/b#readme',
      'https://github.com/a/b.git',
      'https://github.com/-a/b',
      'https://github.com/a--/b',
      'https://github.com/a/..',
      'https://github.com/a/b%2Fc',
      'https://user@github.com/a/b',
      'https://github.com:8443/a/b',
      'github.com/a/b',
      'javascript:alert(1)',
      '',
    ];
    for (const value of refused) expect(parseRepoUrl(value), value).toBeNull();
  });
});

describe('isSiteRepository', () => {
  it('finds any address inside the repository named by GITHUB_REPO, without regard to case', () => {
    expect(isSiteRepository('https://github.com/Example-Owner/Site-Repo', ENV)).toBe(true);
    expect(isSiteRepository('https://github.com/example-owner/site-repo/tree/v3/lib', ENV)).toBe(true);
    expect(isSiteRepository('https://www.github.com/example-owner/site-repo.git', ENV)).toBe(true);
    expect(isSiteRepository(URL_OK, ENV)).toBe(false);
    expect(isSiteRepository('https://github.com/example-owner/site-repo', { GITHUB_REPO: '' })).toBe(false);
  });
});

describe('loadRepoCard', () => {
  it('builds the card from a public repository and asks GitHub the documented way', async () => {
    const fetcher = fetcherFor(async () => answer(200, repoJson()));
    const { options, warnings } = setup(fetcher);
    const result = await loadRepoCard(URL_OK, options);
    expect(result).toEqual({
      kind: 'card',
      card: {
        href: 'https://github.com/Example-Owner/demo-repo',
        fullName: 'Example-Owner/demo-repo',
        description: 'A small sample repository for tests.',
        language: 'TypeScript',
        pushed: { iso: '2026-08-13T17:04:05Z', date: '2026-08-13' },
      },
    });
    expect(warnings).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(API_URL);
    expect(init.headers.Accept).toBe('application/vnd.github+json');
    expect(init.headers['User-Agent']).toBeTruthy();
    expect('Authorization' in init.headers).toBe(false);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends GITHUB_TOKEN as a bearer token when it is set, and never reports it', async () => {
    const fetcher = fetcherFor(async () => answer(200, repoJson()));
    const { options, warnings } = setup(fetcher, { ...ENV, GITHUB_TOKEN: FAKE_TOKEN });
    expect((await loadRepoCard(URL_OK, options)).kind).toBe('card');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(warnings.join(' ')).not.toContain(FAKE_TOKEN);
  });

  it('asks again without the token when GitHub refuses it or the token cannot see the repository', async () => {
    for (const status of [401, 403, 404]) {
      clearRepoCardCache();
      const fetcher = fetcherFor(
        async () => answer(status, { message: 'refused' }),
        async () => answer(200, repoJson()),
      );
      const { options } = setup(fetcher, { ...ENV, GITHUB_TOKEN: FAKE_TOKEN });
      expect((await loadRepoCard(URL_OK, options)).kind).toBe('card');
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect('Authorization' in fetcher.mock.calls[1][1].headers).toBe(false);
    }
  });

  it('asks only once more, and falls back when the repository is missing either way', async () => {
    const fetcher = fetcherFor(
      async () => answer(404, { message: 'Not Found' }),
      async () => answer(404, { message: 'Not Found' }),
    );
    const { options } = setup(fetcher, { ...ENV, GITHUB_TOKEN: FAKE_TOKEN });
    expect((await loadRepoCard(URL_OK, options)).kind).toBe('link');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not ask again after a server error', async () => {
    const fetcher = fetcherFor(async () => answer(502, {}));
    const { options } = setup(fetcher, { ...ENV, GITHUB_TOKEN: FAKE_TOKEN });
    expect((await loadRepoCard(URL_OK, options)).kind).toBe('link');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('leaves out a description, language, or date that GitHub does not give', async () => {
    const fetcher = fetcherFor(async () => answer(200, repoJson({ description: null, language: null, pushed_at: 'yesterday' })));
    const { options } = setup(fetcher);
    expect(await loadRepoCard(URL_OK, options)).toEqual({
      kind: 'card',
      card: { href: 'https://github.com/Example-Owner/demo-repo', fullName: 'Example-Owner/demo-repo' },
    });
  });

  describe('falls back to the plain link', () => {
    const LINK = { kind: 'link', href: URL_OK, text: 'github.com/Example-Owner/demo-repo', github: true };

    it('when the request fails', async () => {
      const { options, warnings } = setup(
        fetcherFor(async () => {
          throw new Error('getaddrinfo ENOTFOUND api.github.com');
        }),
      );
      expect(await loadRepoCard(URL_OK, options)).toEqual(LINK);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('the request failed');
    });

    it('when GitHub answers with an error status', async () => {
      for (const status of [404, 403, 500, 301]) {
        clearRepoCardCache();
        const { options, warnings } = setup(fetcherFor(async () => answer(status, { message: 'x' })));
        expect(await loadRepoCard(URL_OK, options)).toEqual(LINK);
        expect(warnings[0]).toContain(String(status));
      }
    });

    it('when the answer is not a repository', async () => {
      for (const body of ['<html>', '[]', JSON.stringify({ message: 'odd' }), JSON.stringify(repoJson({ full_name: 'a/b/c' }))]) {
        clearRepoCardCache();
        const { options } = setup(fetcherFor(async () => answer(200, body)));
        expect(await loadRepoCard(URL_OK, options)).toEqual(LINK);
      }
    });

    it('when the request takes too long, and it cancels the request', async () => {
      let seen: AbortSignal | undefined;
      const fetcher = vi.fn<RepoFetcher>((_url, init) => {
        seen = init.signal;
        return new Promise<Response>(() => undefined);
      });
      const { options, warnings } = setup(fetcher, ENV, { timeoutMs: 30 });
      expect(await loadRepoCard(URL_OK, options)).toEqual(LINK);
      expect(warnings[0]).toContain('timed out');
      expect(seen?.aborted).toBe(true);
    });

    it('when the repository is private', async () => {
      const bodies = [repoJson({ private: true }), repoJson({ visibility: 'internal' }), repoJson({ private: undefined })];
      for (const body of bodies) {
        clearRepoCardCache();
        const { options, warnings } = setup(fetcherFor(async () => answer(200, body)));
        expect(await loadRepoCard(URL_OK, options)).toEqual(LINK);
        expect(warnings[0]).toContain('not public');
      }
    });

    it('when the repository answers under another name or address', async () => {
      for (const body of [repoJson({ full_name: 'Example-Owner/renamed' }), repoJson({ html_url: 'https://example.com/x' })]) {
        clearRepoCardCache();
        const { options } = setup(fetcherFor(async () => answer(200, body)));
        expect(await loadRepoCard(URL_OK, options)).toEqual(LINK);
      }
    });

    it('when a fetched word is on the blocklist, reporting the entry number and never the term', async () => {
      const cases = [
        { body: repoJson({ description: `Built for the ${TERM} team.` }), field: 'description', entry: 1 },
        { body: repoJson({ language: CASE_TERM }), field: 'language', entry: 2 },
      ];
      for (const { body, field, entry } of cases) {
        clearRepoCardCache();
        const { options, warnings } = setup(fetcherFor(async () => answer(200, body)));
        const result = await loadRepoCard(URL_OK, options);
        expect(result).toEqual(LINK);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`${field}: `);
        expect(warnings[0]).toContain('BLOCKLIST');
        expect(warnings[0]).toContain(`term ${entry}`);
        const reported = `${warnings.join(' ')} ${JSON.stringify(result)}`.toLowerCase();
        expect(reported.includes(TERM)).toBe(false);
        expect(reported.includes(CASE_TERM.toLowerCase())).toBe(false);
      }
    });

    it('when a fetched word breaks a public rule, reporting the rule id', async () => {
      const dash = String.fromCharCode(0x2014);
      const { options, warnings } = setup(fetcherFor(async () => answer(200, repoJson({ description: `Fast${dash}and small` }))));
      expect(await loadRepoCard(URL_OK, options)).toEqual(LINK);
      expect(warnings[0]).toContain('description: rule DASH');
    });

    it('when CONTENT_BLOCKLIST is missing on Vercel or in CI, without asking GitHub', async () => {
      const fetcher = fetcherFor(async () => answer(200, repoJson()));
      const { options, warnings } = setup(fetcher, { GITHUB_TOKEN: '', VERCEL: '1' });
      expect(await loadRepoCard(URL_OK, options)).toEqual(LINK);
      expect(fetcher).not.toHaveBeenCalled();
      expect(warnings[0]).toContain('CONTENT_BLOCKLIST is not set');
    });
  });

  it('checks fetched words against the public rules when the blocklist is missing on a dev machine', async () => {
    const fetcher = fetcherFor(async () => answer(200, repoJson()));
    const { options } = setup(fetcher, { GITHUB_TOKEN: '' });
    expect((await loadRepoCard(URL_OK, options)).kind).toBe('card');
  });

  it('shows another web address as a plain link without asking GitHub', async () => {
    const fetcher = fetcherFor();
    const { options } = setup(fetcher);
    expect(await loadRepoCard('https://gitlab.com/someone/thing/', options)).toEqual({
      kind: 'link',
      href: 'https://gitlab.com/someone/thing/',
      text: 'gitlab.com/someone/thing',
      github: false,
    });
    expect(await loadRepoCard('https://github.com/a/b/tree/main', options)).toMatchObject({ kind: 'link', github: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('shows nothing for a value that is not a web address, or for the site repository', async () => {
    const fetcher = fetcherFor();
    const { options } = setup(fetcher);
    for (const value of ['javascript:alert(1)', 'not a link', 'mailto:x@example.com', '   ', 'https://github.com/example-owner/site-repo']) {
      expect(await loadRepoCard(value, options), value).toEqual({ kind: 'none' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('asks GitHub once per repository in a process, for cards and for fallbacks', async () => {
    const ok = fetcherFor(async () => answer(200, repoJson()));
    const { options } = setup(ok);
    const [first, second] = await Promise.all([loadRepoCard(URL_OK, options), loadRepoCard(`${URL_OK}/`, options)]);
    expect(first).toEqual(second);
    expect(await loadRepoCard('https://github.com/example-owner/DEMO-REPO', options)).toEqual(first);
    expect(ok).toHaveBeenCalledTimes(1);

    clearRepoCardCache();
    const failing = fetcherFor(async () => answer(500, {}));
    const later = setup(failing);
    await loadRepoCard(URL_OK, later.options);
    await loadRepoCard(URL_OK, later.options);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
