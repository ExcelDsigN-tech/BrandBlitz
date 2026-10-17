"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandKitForm } from "@/components/brand/brand-kit-form";
import {
  GalleryTemplateSelector,
  type GalleryTemplate,
} from "@/components/brand/gallery-template-selector";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type Mode = "choose" | "blank" | "gallery";

export default function NewBrandPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("choose");
  const [templates, setTemplates] = useState<GalleryTemplate[] | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/brand/new");
    }
  }, [status, router]);

  // Fetch gallery templates when the user picks that mode
  useEffect(() => {
    if (mode !== "gallery" || templates !== null) return;

    setLoadingTemplates(true);
    setGalleryError(null);
    api
      .get<{ templates: GalleryTemplate[]; nextCursor: string | null }>(
        "/challenge-templates/gallery?limit=12"
      )
      .then(({ data }) => {
        setTemplates(data.templates);
      })
      .catch(() => {
        setGalleryError("Could not load gallery templates. Please try again.");
        setTemplates([]);
      })
      .finally(() => setLoadingTemplates(false));
  }, [mode, templates]);

  if (status === "loading" || !session) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="animate-pulse space-y-6">
          <div className="h-9 w-56 rounded bg-[var(--muted)]" />
          <div className="h-5 w-80 rounded bg-[var(--muted)]" />
          <div className="h-96 rounded-lg bg-[var(--muted)]" />
        </div>
      </div>
    );
  }

  /* ── Mode: choose ─────────────────────────────────────────────────────────── */
  if (mode === "choose") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="mb-2 text-3xl font-bold">Create a Challenge</h1>
        <p className="mb-10 text-[var(--muted-foreground)]">
          Start from scratch with your brand kit, or browse proven challenge formats from other
          brands.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Start from scratch */}
          <button
            type="button"
            onClick={() => setMode("blank")}
            className="group flex flex-col items-start gap-3 rounded-xl border-2 border-[var(--border)] p-6 text-left transition-all hover:border-[var(--primary)] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--muted)] text-2xl"
              aria-hidden="true"
            >
              ✏️
            </span>
            <span>
              <span className="block font-semibold text-lg">Start from scratch</span>
              <span className="mt-1 block text-sm text-[var(--muted-foreground)]">
                Upload your brand assets and configure a new challenge.
              </span>
            </span>
          </button>

          {/* Browse gallery */}
          <button
            type="button"
            onClick={() => setMode("gallery")}
            className="group flex flex-col items-start gap-3 rounded-xl border-2 border-[var(--border)] p-6 text-left transition-all hover:border-[var(--primary)] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--muted)] text-2xl"
              aria-hidden="true"
            >
              🏆
            </span>
            <span>
              <span className="block font-semibold text-lg">Start from gallery template</span>
              <span className="mt-1 block text-sm text-[var(--muted-foreground)]">
                Clone a top-performing challenge format proven to drive high completion rates.
              </span>
            </span>
          </button>
        </div>
      </main>
    );
  }

  /* ── Mode: gallery ────────────────────────────────────────────────────────── */
  if (mode === "gallery") {
    // We need at least one brand to clone into. If none, nudge them to create
    // a brand first. The simplest heuristic: require a brand id in the query
    // string OR fall back to a "create brand first" message.
    const brandId =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("brandId") ?? ""
        : "";

    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        {/* Back / breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode("choose")}
            className="gap-1 pl-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            ← Back
          </Button>
        </nav>

        <h1 className="mb-2 text-3xl font-bold">Gallery Templates</h1>
        <p className="mb-8 text-[var(--muted-foreground)]">
          Browse top-performing challenges. Credit for the original format is shown on the card.
          Participant data and escrow details are never copied.
        </p>

        {loadingTemplates && (
          <div className="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label="Loading templates">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-44 animate-pulse rounded-xl bg-[var(--muted)]"
                aria-hidden="true"
              />
            ))}
          </div>
        )}

        {galleryError && (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {galleryError}
          </div>
        )}

        {!loadingTemplates && !galleryError && templates && (
          <>
            {!brandId && (
              <div
                role="alert"
                className="mb-6 rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
              >
                You need a Brand Kit before you can clone a template.{" "}
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-yellow-800 underline"
                  onClick={() => setMode("blank")}
                >
                  Create one first
                </Button>
                .
              </div>
            )}
            <GalleryTemplateSelector
              templates={templates}
              apiToken={session.apiToken ?? ""}
              brandId={brandId}
              poolAmountUsdc="10.0000000"
            />
          </>
        )}
      </main>
    );
  }

  /* ── Mode: blank (existing BrandKitForm flow) ─────────────────────────────── */
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      {/* Back button */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMode("choose")}
          className="gap-1 pl-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          ← Back
        </Button>
      </nav>

      <h1 className="mb-2 text-3xl font-bold">Create Brand Kit</h1>
      <p className="mb-8 text-[var(--muted-foreground)]">
        Upload your brand assets and information to generate a challenge.
      </p>
      <BrandKitForm apiToken={session.apiToken} />
    </main>
  );
}
