import { NextResponse, type NextRequest } from 'next/server';
import { sessionValid } from '@/lib/auth';
import { ghBranch, ghConfigured, ghRepo, ghToken } from '@/lib/github';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Admin-only CMS diagnostics: reports which env vars the server actually sees
 * (never the values of secrets) and live-tests the GitHub token against the API.
 */
export async function GET(req: NextRequest) {
  if (!sessionValid(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = ghToken();
  const repo = ghRepo();
  const branch = ghBranch();

  const tokenType = !token
    ? null
    : token.startsWith('github_pat_')
      ? 'fine-grained'
      : token.startsWith('ghp_')
        ? 'classic'
        : 'unknown format';

  const result: {
    runtime: {
      nodeEnv: string;
      vercelEnv: string | null;
      host: string;
    };
    env: {
      adminPasswordSet: boolean;
      githubTokenSet: boolean;
      githubTokenType: string | null;
      githubRepo: string | null;
      githubBranch: string;
    };
    github: null | {
      ok: boolean;
      status?: number;
      detail: string;
      writeAccess?: boolean;
      branchExists?: boolean;
    };
  } = {
    runtime: {
      nodeEnv: process.env.NODE_ENV ?? 'unknown',
      vercelEnv: process.env.VERCEL_ENV ?? null,
      host: process.env.VERCEL ? 'vercel' : process.env.NETLIFY ? 'netlify' : 'other',
    },
    env: {
      adminPasswordSet: Boolean(process.env.ADMIN_PASSWORD),
      githubTokenSet: Boolean(token),
      githubTokenType: tokenType,
      githubRepo: repo || null,
      githubBranch: branch,
    },
    github: null,
  };

  if (ghConfigured()) {
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      };
      const repoRes = await fetch(`https://api.github.com/repos/${repo}`, {
        headers,
        cache: 'no-store',
      });
      if (repoRes.ok) {
        const data = await repoRes.json();
        const writeAccess = Boolean(data.permissions?.push);
        const branchRes = await fetch(
          `https://api.github.com/repos/${repo}/branches/${encodeURIComponent(branch)}`,
          { headers, cache: 'no-store' },
        );
        result.github = {
          ok: writeAccess && branchRes.ok,
          status: repoRes.status,
          writeAccess,
          branchExists: branchRes.ok,
          detail: !writeAccess
            ? 'Token can read the repo but has no write access. Grant Contents: Read and write.'
            : !branchRes.ok
              ? `Branch "${branch}" not found on ${repo}.`
              : `Connected to ${data.full_name} (branch ${branch}, write access).`,
        };
      } else {
        result.github = {
          ok: false,
          status: repoRes.status,
          detail:
            repoRes.status === 401
              ? 'Token rejected (bad credentials). Re-create the fine-grained PAT and paste it again.'
              : repoRes.status === 404
                ? `Repo "${repo}" not found with this token. Either the repo name is wrong or the token was not granted access to it.`
                : repoRes.status === 403
                  ? 'Token forbidden (rate limit or missing permission).'
                  : `GitHub API returned ${repoRes.status}.`,
        };
      }
    } catch (err) {
      result.github = { ok: false, detail: `Network error: ${(err as Error).message}` };
    }
  }

  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
}
