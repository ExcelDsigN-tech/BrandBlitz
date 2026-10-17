import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)] text-[var(--foreground)]">
      <header className="flex h-16 items-center border-b border-[var(--border)] px-6">
        <Link
          href="/"
          className="text-xl font-extrabold text-[var(--primary)]"
          aria-label="BrandBlitz home"
        >
          BrandBlitz
        </Link>
      </header>

      <main
        role="main"
        className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center"
      >
        <p className="mb-4 text-6xl font-extrabold text-[var(--primary)]" aria-hidden="true">
          404
        </p>
        <h1 className="mb-3 text-2xl font-bold">Page not found</h1>
        <p className="mb-8 max-w-sm text-[var(--muted-foreground)]">
          We couldn&apos;t find what you were looking for. Try a live challenge from the home page
          instead.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Play a live challenge
          </Link>
          <Link
            href="/leaderboard"
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] px-5 py-2.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
          >
            View leaderboard
          </Link>
        </div>
      </main>
    </div>
  );
}
