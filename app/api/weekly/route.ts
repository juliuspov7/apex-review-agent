import { loadState, routing, saveState } from "@/lib/pipeline";
import { weekly, weeklyText } from "@/lib/weekly";

export const dynamic = "force-dynamic";

/** Queue one weekly summary e-mail per hotel GM (simulated outbox). */
export async function POST(req: Request) {
  const { week } = (await req.json()) as { week: string };
  const st = await loadState();
  const r = await routing();
  const rows = weekly(st, week, Object.keys(r));
  let n = 0;
  for (const row of rows) {
    if (!row.reviews && !row.openWorkOrders) continue;
    st.counters.msg++;
    st.outbox.push({
      id: `MSG-${String(st.counters.msg).padStart(4, "0")}`, kind: "weekly", createdAt: new Date().toISOString(),
      to: [r[row.hotel].gm], subject: `Weekly review summary – ${row.hotel} – week of ${week}`, body: weeklyText(row, week), related: week,
    });
    n++;
  }
  st.log.push({ ts: new Date().toISOString(), actor: "agent", text: `Weekly summaries for the week of ${week} queued for ${n} GMs.` });
  await saveState(st);
  return Response.json({ ok: true, queued: n });
}
