"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <head>
        <title>Critical Error - BrandBlitz</title>
      </head>
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center font-sans">
          <div className="mb-6 rounded-full bg-red-100 p-4 text-red-600">
            <svg
              className="h-12 w-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
          </div>
          <h1 className="mb-3 text-3xl font-bold text-slate-900">A critical error occurred</h1>
          <p className="mb-8 max-w-md text-lg text-slate-600">
            Something went very wrong and we couldn&apos;t recover. The team has been automatically
            notified.
          </p>
          <button
            onClick={() => reset()}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-8 py-3 text-lg font-semibold text-white shadow-lg transition-all hover:bg-blue-700 hover:shadow-xl active:scale-95"
          >
            Reload Application
          </button>
          {error.digest && (
            <p className="mt-8 font-mono text-xs text-slate-400">Error ID: {error.digest}</p>
          )}
        </div>
      </body>
    </html>
  );
}
