"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";

export default function BrandError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: "brand" } });
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <div className="bg-[var(--destructive)]/10 mb-6 rounded-full p-4">
        <svg
          className="h-10 w-10 text-[var(--destructive)]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21"
          />
        </svg>
      </div>

      <h1 className="mb-3 text-2xl font-bold">Something went wrong with Brand tools</h1>
      <p className="mb-8 max-w-sm text-[var(--muted-foreground)]">
        We ran into an issue loading the brand dashboard. Your brand data is safe — please try
        again.
      </p>

      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={reset}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] px-5 py-2.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
        >
          Brand dashboard
        </Link>
      </div>

      {error.digest && (
        <p className="mt-6 text-xs text-[var(--muted-foreground)]">Error ID: {error.digest}</p>
      )}
    </div>
  );
}
