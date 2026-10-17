import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function BrandAnalyticsLoading() {
  return (
    <main
      className="mx-auto max-w-4xl px-6 py-12"
      role="status"
      aria-busy="true"
      aria-label="Loading brand analytics"
    >
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-32 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-10 w-44 rounded-md" />
      </div>

      <div className="mb-8 grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, idx) => (
          <Card key={idx} className="text-center">
            <CardContent className="space-y-2 pb-4 pt-6">
              <Skeleton className="mx-auto h-7 w-28" />
              <Skeleton className="mx-auto h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-56" />
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-[80px_1fr_120px_120px] gap-4 border-b border-[var(--border)] px-6 py-3">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="ml-auto h-4 w-16" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[80px_1fr_120px_120px] items-center gap-4 border-b border-[var(--border)] px-6 py-3 last:border-0"
            >
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="ml-auto h-4 w-16" />
              <Skeleton className="ml-auto h-4 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
