"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

/**
 * Self-serve GDPR data export (issue #1004). Downloads the signed-in user's
 * full data as a JSON file from `GET /me/export`.
 */
export function DataExportButton() {
  const { data: session } = useSession();
  const apiToken = (session as { apiToken?: string } | null)?.apiToken;
  const [downloading, setDownloading] = useState(false);

  if (!apiToken) return null;

  async function download() {
    if (downloading) return;
    setDownloading(true);
    try {
      const api = createApiClient(apiToken);
      const response = await api.get("/me/export", { responseType: "blob" });
      const blob = new Blob([response.data as BlobPart], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "brandblitz-data-export.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Your data export is downloading.");
    } catch {
      toast.error("We couldn't prepare your data export. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={downloading} onClick={() => void download()}>
      {downloading ? "Preparing…" : "Download my data"}
    </Button>
  );
}
