"use client";

import { useEffect, useState } from "react";
import { Eye, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

export function ImpersonationBanner({ className }: { className?: string }) {
  const [impersonation, setImpersonation] = useState<{
    targetEmail?: string;
    targetName?: string;
    token?: string;
  } | null>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("brandblitz:impersonation");
      if (stored) {
        setImpersonation(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, []);

  if (!impersonation) return null;

  async function handleExit() {
    try {
      const token =
        impersonation?.token || sessionStorage.getItem("brandblitz:impersonation_token");
      if (token) {
        await fetch(`${API_URL}/admin/users/impersonate-exit`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
      }
    } catch (err) {
      console.error("Failed to exit impersonation:", err);
    } finally {
      sessionStorage.removeItem("brandblitz:impersonation");
      sessionStorage.removeItem("brandblitz:impersonation_token");
      window.location.href = "/admin/users";
    }
  }

  return (
    <div
      className={cn(
        "sticky top-0 z-50 w-full border-b border-indigo-700 bg-indigo-600 px-4 py-2.5 text-white shadow-md",
        className
      )}
      role="alert"
      aria-live="assertive"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Eye className="h-4 w-4 shrink-0 text-indigo-200" aria-hidden="true" />
          <span>
            Support Mode: Viewing as{" "}
            <strong>{impersonation.targetName || impersonation.targetEmail || "User"}</strong>{" "}
            <span className="opacity-80">(Read-Only)</span>
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleExit}
          className="h-8 gap-1 border-white/40 bg-white/10 text-white hover:bg-white hover:text-indigo-900"
        >
          <LogOut className="h-3.5 w-3.5" />
          Exit Impersonation
        </Button>
      </div>
    </div>
  );
}
