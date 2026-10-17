import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileLoading() {
  return (
    <main
      className="mx-auto max-w-2xl px-6 py-12"
      role="status"
      aria-busy="true"
      aria-label="Loading profile"
    >
      <div className="mb-10 flex items-center gap-6">
        <Skeleton className="h-20 w-20 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-5 w-32" />
        </div>
      </div>

      <div className="mb-8 grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, idx) => (
          <Card key={idx} className="text-center">
            <CardContent className="space-y-2 pb-4 pt-6">
              <Skeleton className="mx-auto h-8 w-24" />
              <Skeleton className="mx-auto h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-24" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div
                key={idx}
                className="flex flex-col items-center gap-2 rounded-md border border-[var(--border)] p-3"
              >
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-44" />
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[1fr_120px_80px] items-center gap-4 border-b border-[var(--border)] px-6 py-3 last:border-0"
            >
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-4 w-16" />
              <Skeleton className="ml-auto h-4 w-10" />
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
