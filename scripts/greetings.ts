// Prints the greeting line of every drafted reply so the grammar of names can be checked by eye.
import { readFileSync } from "node:fs";
import { collect, processQueued } from "../lib/pipeline.ts";
import { emptyState } from "../lib/types.ts";

const st = emptyState();
collect(st, readFileSync("data/batch_01.csv", "utf8"), "b1");
collect(st, readFileSync("data/batch_02.csv", "utf8"), "b2");
await processQueued(st, 100, 8);
for (const r of Object.values(st.reviews)) {
  const d = r.analysis?.draft_reply;
  if (d) console.log(`${r.analysis!.language} | ${r.reviewer} → ${d.split("\n")[0].slice(0, 60)}`);
}
