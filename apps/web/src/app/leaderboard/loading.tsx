import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function LeaderboardLoading() {
  return (
    <main
      className="mx-auto max-w-3xl px-6 py-12"
      role="status"
      aria-busy="true"
      aria-label="Loading leaderboard"
    >
      <Skeleton className="mb-2 h-9 w-64" />
      <Skeleton className="mb-8 h-5 w-80" />

      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-48" />
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-[80px_1fr_120px_120px] gap-4 border-b border-[var(--border)] px-6 py-3">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="ml-auto h-4 w-16" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[80px_1fr_120px_120px] items-center gap-4 border-b border-[var(--border)] px-6 py-4 last:border-0"
            >
              <Skeleton className="h-5 w-10" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 w-36" />
              </div>
              <Skeleton className="ml-auto h-4 w-20" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
