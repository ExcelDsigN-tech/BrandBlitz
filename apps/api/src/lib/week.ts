export function getUtcWeekStart(date = new Date()): string {
  const utcYear = date.getUTCFullYear();
  const utcMonth = date.getUTCMonth();
  const utcDate = date.getUTCDate();

  const d = new Date(Date.UTC(utcYear, utcMonth, utcDate, 0, 0, 0, 0));
  const day = d.getUTCDay(); // 0 Sun ... 6 Sat
  const diffToMonday = (day + 6) % 7; // Monday => 0
  d.setUTCDate(d.getUTCDate() - diffToMonday);

  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function addUtcDays(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
