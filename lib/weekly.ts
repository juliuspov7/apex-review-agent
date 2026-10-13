import type { State } from "./types.ts";

export interface WeeklyRow {
  hotel: string;
  reviews: number;
  avgRating: number | null;
  prevAvgRating: number | null;
  negative: number;
  topIssues: { category: string; count: number }[];
  prevIssueCount: number;
  issueCount: number;
  openWorkOrders: number;
  openSafety: number;
  pendingReplies: number;
}

export function weekStart(iso: string) {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
const addDays = (s: string, n: number) => new Date(Date.parse(s + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);

export function weeksIn(st: State) {
  return [...new Set(Object.values(st.reviews).map((r) => weekStart(r.receivedAt)))].sort();
}

export function weekly(st: State, week: string, hotels: string[]): WeeklyRow[] {
  const prev = addDays(week, -7);
  const real = Object.values(st.reviews).filter((r) => r.status !== "duplicate" && r.status !== "spam");
  return hotels.map((hotel) => {
    const mine = real.filter((r) => r.hotel === hotel);
    const cur = mine.filter((r) => weekStart(r.receivedAt) === week);
    const old = mine.filter((r) => weekStart(r.receivedAt) === prev);
    const avg = (xs: typeof cur) => {
      const v = xs.map((x) => x.rating5).filter((x): x is number => x !== null);
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
    };
    const counts = new Map<string, number>();
    let issueCount = 0;
    for (const r of cur) for (const c of new Set((r.analysis?.issues ?? []).map((i) => i.category))) { counts.set(c, (counts.get(c) ?? 0) + 1); issueCount++; }
    const prevIssueCount = old.reduce((s, r) => s + new Set((r.analysis?.issues ?? []).map((i) => i.category)).size, 0);
    const wos = Object.values(st.workOrders).filter((w) => w.hotel === hotel && w.status !== "closed");
    return {
      hotel, reviews: cur.length, avgRating: avg(cur), prevAvgRating: avg(old),
      negative: cur.filter((r) => r.analysis?.sentiment === "negative").length,
      topIssues: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([category, count]) => ({ category, count })),
      issueCount, prevIssueCount, openWorkOrders: wos.length, openSafety: wos.filter((w) => w.safety).length,
      pendingReplies: cur.filter((r) => r.draft?.status === "pending").length,
    };
  });
}

export function weeklyText(row: WeeklyRow, week: string) {
  const trend = row.prevAvgRating === null || row.avgRating === null ? "no previous week to compare" : row.avgRating > row.prevAvgRating ? `up from ${row.prevAvgRating}` : row.avgRating < row.prevAvgRating ? `down from ${row.prevAvgRating}` : `unchanged vs ${row.prevAvgRating}`;
  const issues = row.topIssues.length ? row.topIssues.map((i) => `${i.category} (${i.count})`).join(", ") : "none";
  return `Weekly guest-review summary – ${row.hotel} – week of ${week}\n\nReviews: ${row.reviews}, average rating ${row.avgRating ?? "n/a"}/5 (${trend}), negative: ${row.negative}.\nTop issues: ${issues}.\nIssue reports: ${row.issueCount} (previous week ${row.prevIssueCount}).\nOpen work orders today (all weeks, not only this week): ${row.openWorkOrders}${row.openSafety ? ` – including ${row.openSafety} SAFETY case(s)` : ""}.\nReplies waiting for your approval (this week reviews): ${row.pendingReplies}.`;
}
