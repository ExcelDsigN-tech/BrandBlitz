import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <Card className={cn("text-center", className)}>
      <CardContent className="py-16">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
          {icon ?? (
            <span aria-hidden className="text-xl">
              ✨
            </span>
          )}
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <p className="mt-2 text-[var(--muted-foreground)]">{description}</p> : null}
        {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
      </CardContent>
    </Card>
  );
}
