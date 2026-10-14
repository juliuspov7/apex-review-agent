// How much do two runs of the same prompt differ? Usage: node --env-file=.env.local scripts/stability.ts   
import { readFileSync } from "node:fs";
import { collect, processQueued } from "../lib/pipeline.ts";
import { emptyState } from "../lib/types.ts";

async function run() {
  const st = emptyState();
  collect(st, readFileSync("data/batch_01.csv", "utf8"), "b1");
  collect(st, readFileSync("data/batch_02.csv", "utf8"), "b2");
  while ((await processQueued(st, 100, 8)).remaining) { /* until done */ }
  return st;
}
const a = await run();
const b = await run();
const sig = (r: any) => JSON.stringify([r.analysis?.sentiment, [...new Set((r.analysis?.issues ?? []).map((i: any) => i.category))].sort(), (r.analysis?.issues ?? []).some((i: any) => i.safety_type !== "none")]);
let diffSent = 0, diffCat = 0, diffSafety = 0, diffAny = 0, n = 0;
for (const id of Object.keys(a.reviews)) {
  const x = a.reviews[id], y = b.reviews[id];
  if (!x.analysis || !y.analysis) continue;
  n++;
  const [s1, c1, f1] = JSON.parse(sig(x)), [s2, c2, f2] = JSON.parse(sig(y));
  if (s1 !== s2) diffSent++;
  if (JSON.stringify(c1) !== JSON.stringify(c2)) diffCat++;
  if (f1 !== f2) diffSafety++;
  if (sig(x) !== sig(y)) diffAny++;
}
console.log(`reviews compared: ${n}; sentiment differs: ${diffSent}; category set differs: ${diffCat}; safety flag differs: ${diffSafety}; any difference: ${diffAny}`);
