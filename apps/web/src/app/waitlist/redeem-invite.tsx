"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RedeemInvite({ onActivated }: { onActivated?: () => void } = {}) {
  const { data: session } = useSession();
  const apiToken = (session as { apiToken?: string } | null)?.apiToken;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!apiToken) return;
    let cancelled = false;
    void createApiClient(apiToken)
      .get("/waitlist/access", { skipErrorToast: true })
      .then((res) => {
        if (!cancelled) {
          const activated = res.data.status === "active";
          setActive(activated);
          if (activated) onActivated?.();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiToken, onActivated]);

  async function redeem(event: FormEvent) {
    event.preventDefault();
    if (!apiToken || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await createApiClient(apiToken).post("/waitlist/redeem-code", { code: code.trim() });
      setActive(true);
      onActivated?.();
    } catch (error) {
      const response = error as { response?: { data?: { error?: string } } };
      setMessage(response.response?.data?.error ?? "Couldn't redeem this code. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Redeem invite code"
      className="mt-6 space-y-3 rounded-lg border border-[var(--border)] p-5"
    >
      <h2 className="font-semibold">Have a brand invite code?</h2>
      {active ? (
        <p role="status">
          Your early access is active.{" "}
          <Link className="underline" href="/challenges">
            Explore challenges
          </Link>
        </p>
      ) : !apiToken ? (
        <p>
          <Link className="underline" href="/login?callbackUrl=/waitlist">
            Sign in
          </Link>{" "}
          with your waitlist email to redeem your code.
        </p>
      ) : (
        <form onSubmit={redeem} className="space-y-3">
          <p className="text-sm text-[var(--muted-foreground)]">
            Join the waitlist above using your account email, then enter your code.
          </p>
          <label htmlFor="invite-code" className="block text-sm">
            Invite code
          </label>
          <Input
            id="invite-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
            maxLength={32}
            autoComplete="off"
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !code.trim()}>
            {busy ? "Redeeming…" : "Redeem code"}
          </Button>
        </form>
      )}
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
