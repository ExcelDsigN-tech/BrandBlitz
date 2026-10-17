import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--background)]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-[var(--muted-foreground)] md:flex-row">
        <p>
          &copy; {new Date().getFullYear()} BrandBlitz. Powered by{" "}
          <span className="font-medium">Stellar USDC</span>.
        </p>
        <div className="flex gap-6">
          <Link href="/leaderboard" className="transition-colors hover:text-[var(--foreground)]">
            Leaderboard
          </Link>
          <Link href="/challenge" className="transition-colors hover:text-[var(--foreground)]">
            Challenges
          </Link>
          <Link href="/dashboard" className="transition-colors hover:text-[var(--foreground)]">
            For Brands
          </Link>
        </div>
      </div>
    </footer>
  );
}
