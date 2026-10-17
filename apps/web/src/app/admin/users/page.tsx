"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { createApiClient } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AdminUser {
  id: string;
  username: string | null;
  email: string;
  createdAt: string;
  suspendedAt: string | null;
  fraudScore: number;
  totalPayouts: number;
}

interface BulkActionResult {
  userId: string;
  success: boolean;
  status?: string;
  error?: string;
  code?: string;
}

interface BulkActionResponse {
  action: "suspend" | "unsuspend";
  succeeded: number;
  failed: number;
  results: BulkActionResult[];
}

type OrderBy = "createdAt" | "fraudScore";
type BulkAction = "suspend" | "unsuspend";

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const apiToken = (session as { apiToken?: string } | null)?.apiToken;
  const userRole = (session?.user as { role?: string } | undefined)?.role;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [minFraudScore, setMinFraudScore] = useState(0);
  const [filterInput, setFilterInput] = useState("0");
  const [orderBy, setOrderBy] = useState<OrderBy>("createdAt");
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkActionResponse | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated" && userRole !== "admin") {
      router.push("/dashboard");
    }
  }, [status, userRole, router]);

  const loadUsers = useCallback(
    async (cursor: string | null) => {
      if (!apiToken) return;
      setLoading(true);
      try {
        const api = createApiClient(apiToken);
        const response = await api.get("/admin/users", {
          params: {
            limit: 25,
            minFraudScore,
            orderBy,
            ...(cursor ? { cursor } : {}),
          },
        });
        setUsers(response.data.users);
        setNextCursor(response.data.nextCursor);
        setCurrentCursor(cursor);
      } catch {
        setUsers([]);
        setNextCursor(null);
      } finally {
        setLoading(false);
      }
    },
    [apiToken, minFraudScore, orderBy]
  );

  useEffect(() => {
    if (status === "authenticated" && userRole === "admin") {
      setCursorHistory([]);
      void loadUsers(null);
    }
  }, [loadUsers, status, userRole]);

  function applyFraudFilter(event: React.FormEvent) {
    event.preventDefault();
    const parsed = Number.parseInt(filterInput, 10);
    setMinFraudScore(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
  }

  function goNext() {
    if (!nextCursor) return;
    setCursorHistory((history) => [...history, currentCursor]);
    void loadUsers(nextCursor);
  }

  function goPrevious() {
    const previous = cursorHistory.at(-1);
    if (previous === undefined) return;
    setCursorHistory((history) => history.slice(0, -1));
    void loadUsers(previous);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const allOnPageSelected = users.length > 0 && users.every((user) => selectedIds.has(user.id));

  function toggleSelectAll() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allOnPageSelected) {
        for (const user of users) next.delete(user.id);
      } else {
        for (const user of users) next.add(user.id);
      }
      return next;
    });
  }

  async function runBulkAction(action: BulkAction) {
    if (!apiToken || selectedIds.size === 0) return;
    if (action === "suspend" && bulkReason.trim().length === 0) {
      toast.error("A suspension reason is required.");
      return;
    }

    setBulkLoading(true);
    setBulkResult(null);
    try {
      const api = createApiClient(apiToken);
      const response = await api.post<BulkActionResponse>("/admin/users/bulk-suspend", {
        userIds: Array.from(selectedIds),
        action,
        ...(action === "suspend" ? { reason: bulkReason.trim() } : {}),
      });
      setBulkResult(response.data);
      if (response.data.failed === 0) {
        toast.success(
          `${response.data.succeeded} user${response.data.succeeded === 1 ? "" : "s"} ${
            action === "suspend" ? "suspended" : "unsuspended"
          }.`
        );
      } else {
        toast.warning(
          `${response.data.succeeded} succeeded, ${response.data.failed} failed. See details below.`
        );
      }
      setSelectedIds(new Set());
      setBulkReason("");
      await loadUsers(currentCursor);
    } catch {
      // createApiClient surfaces API errors via toast.
    } finally {
      setBulkLoading(false);
    }
  }

  if (status === "loading" || (status === "authenticated" && userRole !== "admin")) {
    return null;
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Fraud Review</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Review account risk and payout activity.
        </p>
      </div>

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <form onSubmit={applyFraudFilter} className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="min-fraud-score">Minimum fraud score</Label>
              <Input
                id="min-fraud-score"
                type="number"
                min={0}
                value={filterInput}
                onChange={(event) => setFilterInput(event.target.value)}
                className="w-40"
              />
            </div>
            <Button type="submit" variant="outline">
              Apply
            </Button>
          </form>

          <div className="space-y-1">
            <Label>Order by</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={orderBy === "createdAt" ? "default" : "outline"}
                onClick={() => setOrderBy("createdAt")}
              >
                Newest
              </Button>
              <Button
                size="sm"
                variant={orderBy === "fraudScore" ? "default" : "outline"}
                onClick={() => setOrderBy("fraudScore")}
              >
                Fraud score
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedIds.size > 0 && (
        <Card className="mb-6 border-indigo-200 bg-indigo-50">
          <CardContent className="flex flex-wrap items-end gap-4 pt-6">
            <div className="text-sm font-medium">
              {selectedIds.size} user{selectedIds.size === 1 ? "" : "s"} selected
            </div>
            <div className="space-y-1">
              <Label htmlFor="bulk-reason">Suspension reason</Label>
              <Input
                id="bulk-reason"
                value={bulkReason}
                onChange={(event) => setBulkReason(event.target.value)}
                placeholder="Reason (required to suspend)"
                className="w-64"
                maxLength={500}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={bulkLoading}
                onClick={() => void runBulkAction("suspend")}
              >
                {bulkLoading ? "Working…" : "Suspend selected"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={bulkLoading}
                onClick={() => void runBulkAction("unsuspend")}
              >
                Unsuspend selected
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={bulkLoading}
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {bulkResult && bulkResult.failed > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              {bulkResult.succeeded} succeeded · {bulkResult.failed} failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {bulkResult.results
                .filter((result) => !result.success)
                .map((result) => (
                  <li key={result.userId} className="text-red-600">
                    <span className="font-mono">{result.userId}</span> — {result.error}
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Users</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">Loading…</div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
              No users match this fraud threshold.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs font-medium text-gray-500">
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all users on this page"
                        checked={allOnPageSelected}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Username</th>
                    <th className="px-4 py-3 text-right">Fraud score</th>
                    <th className="px-4 py-3 text-right">Payouts</th>
                    <th className="px-4 py-3">Suspended</th>
                    <th className="px-4 py-3">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${user.email}`}
                          checked={selectedIds.has(user.id)}
                          onChange={() => toggleSelected(user.id)}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium">{user.email}</td>
                      <td className="px-4 py-3">{user.username ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-mono">{user.fraudScore}</td>
                      <td className="px-4 py-3 text-right font-mono">{user.totalPayouts}</td>
                      <td className="px-4 py-3">
                        {user.suspendedAt ? new Date(user.suspendedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3">{new Date(user.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={cursorHistory.length === 0 || loading}
          onClick={goPrevious}
        >
          Previous
        </Button>
        <Button variant="outline" disabled={!nextCursor || loading} onClick={goNext}>
          Next
        </Button>
      </div>
    </main>
  );
}
