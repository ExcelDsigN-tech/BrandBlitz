"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";

export default function ChallengeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: "challenge-detail" } });
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
            d="M14.25 9.75 16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z"
          />
        </svg>
      </div>

      <h1 className="mb-3 text-2xl font-bold">Challenge loading failed</h1>
      <p className="mb-8 max-w-sm text-[var(--muted-foreground)]">
        We couldn&apos;t load this specific challenge. It might be ended or unavailable. Try
        refreshing or browse others.
      </p>

      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={reset}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Retry
        </button>
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] px-5 py-2.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
        >
          Back to Challenges
        </Link>
      </div>

      {error.digest && (
        <p className="mt-6 text-xs text-[var(--muted-foreground)]">Error ID: {error.digest}</p>
      )}
    </div>
  );
}
