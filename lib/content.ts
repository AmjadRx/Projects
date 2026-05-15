import { getStore } from '@netlify/blobs';
import seed from '@/data/seed-content.json';
import type { Content } from './types';

const BLOB_STORE = 'portfolio-content';
const BLOB_KEY = 'main';

export const seedContent = seed as Content;

export async function loadContent(): Promise<Content> {
  try {
    const store = getStore({ name: BLOB_STORE, consistency: 'strong' });
    const stored = await store.get(BLOB_KEY, { type: 'json' });
    if (stored && typeof stored === 'object') {
      return stored as Content;
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[content] Falling back to seed content:', (err as Error)?.message);
    }
  }
  return seedContent;
}

export async function saveContent(next: Content): Promise<{ savedAt: string }> {
  const stamped: Content = {
    ...next,
    lastUpdated: new Date().toISOString().slice(0, 10),
  };
  const store = getStore({ name: BLOB_STORE, consistency: 'strong' });
  await store.setJSON(BLOB_KEY, stamped);
  return { savedAt: new Date().toISOString() };
}
