"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  actor_username: string | null;
  action: string;
  entity: string;
  entity_key: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface ConfigDiffRow {
  key: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

/**
 * Diffs a config change's before/after JSON into per-key added/removed/
 * changed rows (#1005), instead of making the admin eyeball two raw blobs.
 */
function computeConfigDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): ConfigDiffRow[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();

  const rows: ConfigDiffRow[] = [];
  for (const key of keys) {
    const hasBefore = Object.prototype.hasOwnProperty.call(b, key);
    const hasAfter = Object.prototype.hasOwnProperty.call(a, key);
    if (!hasBefore && hasAfter) {
      rows.push({ key, kind: "added", after: a[key] });
    } else if (hasBefore && !hasAfter) {
      rows.push({ key, kind: "removed", before: b[key] });
    } else if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      rows.push({ key, kind: "changed", before: b[key], after: a[key] });
    }
  }
  return rows;
}

function formatDiffValue(value: unknown): string {
  if (value === undefined) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function ConfigDiffView({ rows }: { rows: ConfigDiffRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">No field-level changes.</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.key}
          className={`rounded border px-3 py-2 text-sm ${
            row.kind === "added"
              ? "border-green-700 bg-green-950/40"
              : row.kind === "removed"
                ? "border-red-700 bg-red-950/40"
                : "border-amber-700 bg-amber-950/40"
          }`}
        >
          <div className="font-mono text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            {row.kind} · {row.key}
          </div>
          {row.kind === "changed" ? (
            <div className="mt-1 flex flex-col gap-1 font-mono text-xs">
              <span className="text-red-300 line-through">{formatDiffValue(row.before)}</span>
              <span className="text-green-300">{formatDiffValue(row.after)}</span>
            </div>
          ) : (
            <div className="mt-1 font-mono text-xs">
              {formatDiffValue(row.kind === "added" ? row.after : row.before)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AdminAuditLogPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiToken = (session as { apiToken?: string } | null)?.apiToken;
  const userRole = (session?.user as { role?: string } | undefined)?.role;

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(searchParams.get("action") || "");
  const [fromDate, setFromDate] = useState(searchParams.get("from") || "");
  const [toDate, setToDate] = useState(searchParams.get("to") || "");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
    if (status === "authenticated" && userRole !== "admin") {
      router.push("/");
    }
  }, [status, userRole, router]);

  const loadEntries = useCallback(
    async (page = 1) => {
      if (status !== "authenticated" || !apiToken) return;

      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", "50");
        if (action) params.set("action", action);
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);
        if (search) params.set("search", search);

        const api = createApiClient(apiToken);
        const response = await api.get(`/admin/audit-log?${params}`);
        const data = response.data;

        setEntries(data.entries || []);
        setPagination(data.pagination || { page: 1, pageSize: 50, total: 0, totalPages: 1 });
      } catch (error) {
        console.error("Failed to load audit log entries", error);
      } finally {
        setLoading(false);
      }
    },
    [status, apiToken, action, fromDate, toDate, search]
  );

  useEffect(() => {
    const url = new URLSearchParams();
    if (action) url.set("action", action);
    if (fromDate) url.set("from", fromDate);
    if (toDate) url.set("to", toDate);
    if (search) url.set("search", search);
    router.push(`/admin/audit-log?${url.toString()}`);
  }, [action, fromDate, toDate, search, router]);

  useEffect(() => {
    loadEntries(pagination.page);

    refreshIntervalRef.current = setInterval(() => {
      loadEntries(pagination.page);
    }, 30000);

    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [loadEntries, pagination.page]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (status !== "authenticated") return null;
  if (userRole !== "admin") return null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Audit Log</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          View and search all admin actions
        </p>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-2 block text-sm font-medium">Action Type</label>
              <Input
                type="text"
                placeholder="e.g., update, suspend_user"
                value={action}
                onChange={(e) => setAction(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">From Date</label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">To Date</label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Search</label>
              <Input
                type="text"
                placeholder="Username or entity ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button
              onClick={() => loadEntries(1)}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setAction("");
                setFromDate("");
                setToDate("");
                setSearch("");
              }}
            >
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Entries ({pagination.total})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                        Actor
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                        Action
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                        Entity
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                        Target
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                        Date
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-b border-[var(--border)] last:border-0"
                      >
                        <td className="px-6 py-3 font-medium">
                          {entry.actor_username ? (
                            <Badge variant="secondary">{entry.actor_username}</Badge>
                          ) : (
                            <span className="text-[var(--muted-foreground)]">System</span>
                          )}
                        </td>
                        <td className="px-6 py-3">
                          <Badge variant="default">{entry.action}</Badge>
                        </td>
                        <td className="px-6 py-3 text-[var(--muted-foreground)]">
                          {entry.entity}
                        </td>
                        <td className="px-6 py-3 text-[var(--muted-foreground)]">
                          {entry.entity_key || "—"}
                        </td>
                        <td className="px-6 py-3 text-right text-[var(--muted-foreground)]">
                          {formatDate(entry.created_at)}
                        </td>
                        <td className="px-6 py-3 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setExpandedId(expandedId === entry.id ? null : entry.id)
                            }
                          >
                            {expandedId === entry.id ? "Hide" : "Show"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {expandedId && (
                <Dialog open={expandedId !== null} onOpenChange={() => setExpandedId(null)}>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>
                        {entries.find((e) => e.id === expandedId)?.action} Details
                      </DialogTitle>
                    </DialogHeader>
                    {(() => {
                      const entry = entries.find((e) => e.id === expandedId);
                      if (!entry) return null;

                      if (entry.entity === "app_config") {
                        return (
                          <div>
                            <h3 className="mb-2 font-semibold">Changes</h3>
                            <div className="max-h-64 overflow-auto">
                              <ConfigDiffView rows={computeConfigDiff(entry.before, entry.after)} />
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="space-y-6">
                          {entry.before && (
                            <div>
                              <h3 className="mb-2 font-semibold">Before</h3>
                              <pre className="rounded bg-slate-900 p-4 text-xs text-white overflow-auto max-h-64">
                                {JSON.stringify(entry.before, null, 2)}
                              </pre>
                            </div>
                          )}
                          {entry.after && (
                            <div>
                              <h3 className="mb-2 font-semibold">After</h3>
                              <pre className="rounded bg-slate-900 p-4 text-xs text-white overflow-auto max-h-64">
                                {JSON.stringify(entry.after, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </DialogContent>
                </Dialog>
              )}
            </>
          ) : (
            <div className="px-6 py-12 text-center">
              <p className="text-[var(--muted-foreground)]">No audit log entries found</p>
            </div>
          )}
        </CardContent>
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm text-[var(--muted-foreground)]">
            Page {pagination.page} of {pagination.totalPages}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => loadEntries(Math.max(1, pagination.page - 1))}
              disabled={pagination.page === 1 || loading}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              onClick={() => loadEntries(Math.min(pagination.totalPages, pagination.page + 1))}
              disabled={pagination.page === pagination.totalPages || loading}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
