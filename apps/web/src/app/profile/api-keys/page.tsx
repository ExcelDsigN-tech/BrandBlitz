"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Key, Copy, Check, Trash2, ArrowLeft, Sparkles } from "lucide-react";
import {
  isCelebrationEnabled,
  setCelebrationEnabled,
} from "@/components/gamification/milestone-celebration";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  isActive: boolean;
}

export default function ApiKeysPage() {
  const { data: session, status } = useSession();
  const apiToken = (session as { apiToken?: string } | null)?.apiToken;

  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [celebrationsActive, setCelebrationsActive] = useState(true);

  useEffect(() => {
    setCelebrationsActive(isCelebrationEnabled());
  }, []);

  useEffect(() => {
    if (!apiToken) {
      if (status !== "loading") setLoading(false);
      return;
    }

    async function loadKeys() {
      try {
        const res = await fetch(`${API_URL}/users/me/api-keys`, {
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setKeys(data.keys ?? []);
        }
      } catch (err) {
        console.error("Failed to load API keys:", err);
      } finally {
        setLoading(false);
      }
    }

    void loadKeys();
  }, [apiToken, status]);

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim() || !apiToken) return;

    setGenerating(true);
    try {
      const res = await fetch(`${API_URL}/users/me/api-keys`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        setGeneratedKey(data.key);
        setNewKeyName("");
        setKeys((prev) => [
          {
            id: data.id,
            name: data.name,
            keyPrefix: data.keyPrefix,
            scopes: data.scopes,
            createdAt: data.createdAt,
            lastUsedAt: null,
            revokedAt: null,
            isActive: true,
          },
          ...prev,
        ]);
      }
    } catch (err) {
      console.error("Failed to generate API key:", err);
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevokeKey(id: string) {
    if (!apiToken) return;
    if (
      !window.confirm("Are you sure you want to revoke this API key? This action cannot be undone.")
    ) {
      return;
    }

    try {
      const res = await fetch(`${API_URL}/users/me/api-keys/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      });

      if (res.ok) {
        setKeys((prev) =>
          prev.map((k) =>
            k.id === id ? { ...k, isActive: false, revokedAt: new Date().toISOString() } : k
          )
        );
      }
    } catch (err) {
      console.error("Failed to revoke API key:", err);
    }
  }

  function handleCopy() {
    if (!generatedKey) return;
    void navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function toggleCelebrations() {
    const nextVal = !celebrationsActive;
    setCelebrationsActive(nextVal);
    setCelebrationEnabled(nextVal);
  }

  if (status === "loading" || loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-[var(--muted-foreground)]">Loading API keys and settings…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">Personal API Keys</h1>
        <p className="mt-2 text-[var(--muted-foreground)]">
          Please log in to manage your API keys.
        </p>
        <Link href="/login" className="mt-4 inline-block">
          <Button>Log In</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-3">
        <Link href="/leaderboard" className="hover:text-foreground text-[var(--muted-foreground)]">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Personal API Keys & Preferences</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Programmatically query your BrandBlitz history and statistics with read-only scoped API
            keys.
          </p>
        </div>
      </div>

      {/* Preferences Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Celebratory Animations
          </CardTitle>
          <CardDescription>
            Configure animations for top-3 podium finishes and new personal best scores on
            leaderboards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={celebrationsActive}
              onChange={toggleCelebrations}
              className="h-4 w-4 rounded border-[var(--border)] text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm font-medium">
              Enable milestone celebratory animations (confetti)
            </span>
          </label>
        </CardContent>
      </Card>

      {/* Generated Key Alert */}
      {generatedKey && (
        <Card className="border-green-600 bg-green-500/10">
          <CardHeader>
            <CardTitle className="text-green-700 dark:text-green-400">
              API Key Generated Successfully
            </CardTitle>
            <CardDescription className="text-green-800 dark:text-green-300">
              Please copy your API key now. For your security, this is the only time it will ever be
              shown.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={generatedKey}
                className="bg-white font-mono text-sm dark:bg-black"
              />
              <Button type="button" onClick={handleCopy} className="shrink-0 gap-1.5">
                {copied ? (
                  <Check className="h-4 w-4 text-green-300" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? "Copied" : "Copy Key"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Key Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Key className="h-5 w-5 text-indigo-500" />
            Generate New API Key
          </CardTitle>
          <CardDescription>
            Personal API keys are strictly read-only and have independent per-key rate limits (120
            requests/minute).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateKey} className="flex gap-3">
            <Input
              placeholder="e.g., Discord Bot, Personal Stats Tracker"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              disabled={generating}
              required
              className="max-w-md"
            />
            <Button type="submit" disabled={generating || !newKeyName.trim()}>
              {generating ? "Generating…" : "Generate Key"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Keys List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your API Keys</CardTitle>
          <CardDescription>Existing API keys and their recent activity.</CardDescription>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No personal API keys generated yet.
            </p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{k.name}</span>
                      <code className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)]">
                        {k.keyPrefix}…
                      </code>
                      {k.isActive ? (
                        <Badge variant="outline" className="border-green-600/30 text-green-600">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-red-500/30 text-red-500">
                          Revoked
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                      Created: {new Date(k.createdAt).toLocaleDateString()}
                      {k.lastUsedAt &&
                        ` • Last used: ${new Date(k.lastUsedAt).toLocaleDateString()}`}
                    </div>
                  </div>

                  {k.isActive && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevokeKey(k.id)}
                      className="gap-1 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="h-4 w-4" />
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
