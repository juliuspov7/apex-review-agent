// node --env-file=.env.local scripts/smoke.ts [N]
import { readFileSync } from "node:fs";
import { collect, processQueued } from "../lib/pipeline.ts";
import { emptyState } from "../lib/types.ts";

const n = Number(process.argv[2] ?? 8);
const st = emptyState();
const csv = readFileSync("data/batch_01.csv", "utf8");
collect(st, csv, "batch_01.csv");
// keep only the first n queued reviews for a quick check
const ids = Object.keys(st.reviews);
for (const id of ids.slice(n)) delete st.reviews[id];
const t0 = Date.now();
const res = await processQueued(st, n);
console.log(res, `${((Date.now() - t0) / 1000).toFixed(1)}s`, st.usage);
for (const r of Object.values(st.reviews)) {
  console.log(r.id, r.status, r.analysis?.language, r.analysis?.sentiment, JSON.stringify(r.analysis?.issues.map((i) => `${i.category.replace("Technical – ", "T:")}/${i.safety_type}`)), r.error ?? "");
}
console.log(Object.values(st.workOrders).map((w) => `${w.id} ${w.hotel} ${w.priority} ${w.category} x${w.reviewIds.length}`).join("\n"));
console.log("OUTBOX", st.outbox.length);
const r1 = Object.values(st.reviews)[0];
console.log(r1.analysis?.draft_reply);
