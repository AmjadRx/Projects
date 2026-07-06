const API = 'https://api.github.com';

/**
 * GitHub-CMS mode requires BOTH env vars set explicitly:
 *   GITHUB_TOKEN — fine-grained PAT, single repo, Contents read/write
 *   GITHUB_REPO  — e.g. "AmjadRx/Projects"
 * Without them, save/upload fall back to the local filesystem (dev mode).
 */
export function ghConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
}

function repo(): string {
  return process.env.GITHUB_REPO || '';
}

function branch(): string {
  return process.env.GITHUB_BRANCH || 'main';
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function gh(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...init?.headers }, cache: 'no-store' });
}

export async function ghGetFile(
  path: string,
): Promise<{ content: Buffer; sha: string } | null> {
  const res = await gh(`/repos/${repo()}/contents/${encodeURI(path)}?ref=${branch()}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read ${path}: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) throw new Error(`${path} is a directory`);
  return { content: Buffer.from(data.content, 'base64'), sha: data.sha };
}

export async function ghPutFile(path: string, content: Buffer, message: string): Promise<void> {
  const existing = await ghGetFile(path).catch(() => null);
  const res = await gh(`/repos/${repo()}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: content.toString('base64'),
      branch: branch(),
      ...(existing ? { sha: existing.sha } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub write ${path}: ${res.status} ${body.slice(0, 200)}`);
  }
}

export async function ghDeleteFile(path: string, message: string): Promise<void> {
  const existing = await ghGetFile(path);
  if (!existing) return;
  const res = await gh(`/repos/${repo()}/contents/${encodeURI(path)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha: existing.sha, branch: branch() }),
  });
  if (!res.ok) throw new Error(`GitHub delete ${path}: ${res.status}`);
}

export async function ghListDir(
  path: string,
): Promise<{ name: string; path: string; size: number; type: string }[]> {
  const res = await gh(`/repos/${repo()}/contents/${encodeURI(path)}?ref=${branch()}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub list ${path}: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((f: { name: string; path: string; size: number; type: string }) => ({
    name: f.name,
    path: f.path,
    size: f.size,
    type: f.type,
  }));
}
