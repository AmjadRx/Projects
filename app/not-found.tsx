import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="text-center">
        <p className="kicker">404</p>
        <h1 className="display-2 mt-4">Page not found</h1>
        <p className="body-lg mt-4">That page does not exist, yet.</p>
        <Link href="/" className="btn-primary mt-8">
          Back home
        </Link>
      </div>
    </main>
  );
}
