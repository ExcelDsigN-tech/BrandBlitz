import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function ChallengesLoading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-2 h-9 w-56 animate-pulse rounded bg-[var(--muted)]" />
      <div className="mb-8 h-5 w-80 animate-pulse rounded bg-[var(--muted)]" />
      <div className="mb-6 flex flex-wrap gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 w-28 animate-pulse rounded bg-[var(--muted)]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="mb-2 h-12 w-32 rounded bg-[var(--muted)]" />
              <div className="h-5 w-40 rounded bg-[var(--muted)]" />
            </CardHeader>
            <CardContent>
              <div className="mb-3 h-4 w-24 rounded bg-[var(--muted)]" />
              <div className="h-10 w-full rounded bg-[var(--muted)]" />
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
