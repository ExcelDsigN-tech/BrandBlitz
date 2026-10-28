"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { NotificationBell } from "./notification-bell";

export function Header() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [streak, setStreak] = useState<number | null>(null);

  const apiToken = useMemo(() => (session as any)?.apiToken as string | undefined, [session]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("[aria-label='Open menu']")) return;
      if (target.closest("#mobile-menu-panel")) return;
      setMenuOpen(false);
    }

    document.addEventListener("click", handleClickOutside, true);
    return () => document.removeEventListener("click", handleClickOutside, true);
  }, [menuOpen]);

  useEffect(() => {
    if (!apiToken) {
      return;
    }

    const api = createApiClient(apiToken);
    void api.get("/users/me/streak").then((response) => {
      const data = response.data;
      setStreak(data.streak ?? null);
    });
  }, [apiToken]);

  const navLinks = (
    <>
      <Link
        href="/challenge"
        className="block py-2 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        onClick={() => setMenuOpen(false)}
      >
        Challenges
      </Link>
      <Link
        href="/leaderboard"
        className="block py-2 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        onClick={() => setMenuOpen(false)}
      >
        Leaderboard
      </Link>
      {session && (
        <Link
          href="/dashboard"
          className="block py-2 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          onClick={() => setMenuOpen(false)}
        >
          Dashboard
        </Link>
      )}
    </>
  );

  return (
    <header className="bg-[var(--background)]/95 sticky top-0 z-50 border-b border-[var(--border)] backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="text-xl font-extrabold text-[var(--primary)]">
          BrandBlitz
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 text-sm md:flex">{navLinks}</nav>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          {apiToken && <NotificationBell apiToken={apiToken} />}

          {/* Hamburger — mobile only */}
          <button
            className="flex h-10 w-10 flex-col items-center justify-center gap-1.5 rounded-md transition-colors hover:bg-[var(--muted)] md:hidden"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <span className="block h-0.5 w-5 bg-[var(--foreground)] transition-transform" />
            <span className="block h-0.5 w-5 bg-[var(--foreground)]" />
            <span className="block h-0.5 w-5 bg-[var(--foreground)] transition-transform" />
          </button>

          {status === "loading" ? null : session ? (
            <div className="hidden items-center gap-3 md:flex">
              {session.user?.image ? (
                <Image
                  src={session.user.image}
                  alt={session.user.name ?? "User"}
                  width={32}
                  height={32}
                  sizes="32px"
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary)] text-sm font-bold text-white">
                  {session.user?.name?.charAt(0).toUpperCase() ?? "U"}
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={() => signOut()}>
                Sign Out
              </Button>
            </div>
          ) : (
            <Link href="/login" className="hidden md:block">
              <Button size="sm">Sign In</Button>
            </Link>
          )}
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div
          id="mobile-menu-panel"
          className="border-t border-[var(--border)] bg-[var(--background)] px-6 pb-4 md:hidden"
        >
          <nav className="flex flex-col pt-3 text-sm">{navLinks}</nav>
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            {session ? (
              <div className="flex items-center gap-3">
                {session.user?.image ? (
                  <Image
                    src={session.user.image}
                    alt={session.user.name ?? "User"}
                    width={32}
                    height={32}
                    sizes="32px"
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary)] text-sm font-bold text-white">
                    {session.user?.name?.charAt(0).toUpperCase() ?? "U"}
                  </div>
                )}
                <span className="text-sm text-[var(--foreground)]">{session.user?.name}</span>
                <Button variant="ghost" size="sm" onClick={() => signOut()} className="ml-auto">
                  Sign Out
                </Button>
              </div>
            ) : (
              <Link href="/login" onClick={() => setMenuOpen(false)}>
                <Button size="sm" className="min-h-[44px] w-full">
                  Sign In
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
