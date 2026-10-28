import Link from "next/link";

export default function BrandNotFound() {
  return (
    <main
      role="main"
      className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-20 text-center"
    >
      <p className="mb-4 text-6xl font-extrabold text-[var(--primary)]" aria-hidden="true">
        404
      </p>
      <h1 className="mb-3 text-2xl font-bold">This brand doesn&apos;t exist</h1>
      <p className="mb-8 max-w-sm text-[var(--muted-foreground)]">
        The brand you&apos;re looking for doesn&apos;t exist — create your own and launch a
        challenge.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href="/brand/new"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Create a brand
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] px-5 py-2.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
