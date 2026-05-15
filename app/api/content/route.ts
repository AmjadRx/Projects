import { NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';
import { seedContent } from '@/lib/content';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const store = getStore({ name: 'portfolio-content', consistency: 'strong' });
    const stored = await store.get('main', { type: 'json' });
    if (stored && typeof stored === 'object') {
      return NextResponse.json(stored, {
        headers: { 'cache-control': 'no-store' },
      });
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[api/content] Falling back to seed:', (err as Error)?.message);
    }
  }
  return NextResponse.json(seedContent, {
    headers: { 'cache-control': 'no-store' },
  });
}
