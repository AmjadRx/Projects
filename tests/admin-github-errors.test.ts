/**
 * A GitHub refusal names the call that failed and the token permission GitHub asked for, from its
 * x-accepted-github-permissions header, so a token that can read but not write says why. Found on
 * the Phase 6 preview, where a fine-grained token could read the repository and every save got 403.
 * The token here is synthetic and built at run time.
 */
import { describe, expect, it } from 'vitest';
import { createGitHubClient } from '../lib/admin/server/repo';

const TOKEN = ['github', 'pat', 'SYNTHETIC0TOKEN0FOR0TESTS0ONLY0abcdef'].join('_');

function client(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })) as typeof fetch;
  return createGitHubClient({ token: TOKEN, repo: 'Owner/Name' }, fetchImpl);
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
}

describe('a GitHub refusal', () => {
  it('names the call, without its query string, and the permission GitHub asked for', async () => {
    const github = client(403, { message: 'Resource not accessible by personal access token' }, { 'x-accepted-github-permissions': 'contents=write' });
    const reply = await github.request('POST', '/git/refs?probe=1', { body: { ref: 'refs/heads/draft', sha: 'a'.repeat(40) } });
    const message = refusal(() => github.expect(reply, 201));
    expect(message).toBe('GitHub refused POST /git/refs (403: Resource not accessible by personal access token). GitHub says the token needs "contents=write".');
    expect(message).not.toContain(TOKEN);
  });

  it('keeps the plain wording when GitHub sends no permission header', async () => {
    const github = client(404, { message: 'Not Found' });
    const reply = await github.request('GET', '/git/ref/heads/missing');
    expect(refusal(() => github.expect(reply, 200))).toBe('GitHub refused GET /git/ref/heads/missing (404: Not Found).');
  });

  it('never passes on a token GitHub echoes back, or odd characters in the header', async () => {
    const github = client(403, { message: `Bad credentials for ${TOKEN}` }, { 'x-accepted-github-permissions': 'contents=write; "metadata=read"<b>' });
    const reply = await github.request('PATCH', '/git/refs/heads/draft');
    const message = refusal(() => github.expect(reply, 200));
    expect(message).not.toContain(TOKEN);
    expect(message).toContain('GitHub says the token needs "contents=write; metadata=readb".');
  });
});
