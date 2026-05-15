import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card max-w-md p-8 text-center">
        <div className="font-mono text-xs uppercase tracking-widest text-cyan">404</div>
        <h1 className="mt-3 text-2xl font-bold text-ink">Not found</h1>
        <p className="mt-2 text-ink-dim">That page doesn't exist — yet.</p>
        <Link href="/" className="btn-primary mt-6">
          ← back home
        </Link>
      </div>
    </main>
  );
}
