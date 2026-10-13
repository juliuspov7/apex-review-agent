// Parallel read-modify-write actions must all survive (optimistic locking in withState).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.STORE_DIR = mkdtempSync(path.join(tmpdir(), "apex-store-"));
delete process.env.BLOB_READ_WRITE_TOKEN;
const { withState, loadState, saveState, collect, decideDraft, routing, applyResults } = await import("../lib/pipeline.ts");
const { emptyState } = await import("../lib/types.ts");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("many parallel actions on a brand-new (empty) store all persist", async () => {
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      withState(async (st) => {
        await sleep(5 * (i % 3)); // interleave the read and the write
        st.counters.wo++;
        st.log.push({ ts: new Date().toISOString(), actor: "test", text: `action ${i}` });
      }),
    ),
  );
  const st = await loadState();
  assert.equal(st.counters.wo, 8);
  assert.equal(st.log.length, 8);
});

test("a GM approval made while a long AI batch is running is not overwritten by the batch result", async () => {
  await saveState(emptyState());
  const r = await routing();
  const csv = [
    "review_id,received_at,source,hotel_id,rating,rating_scale,reviewer_name,title,text",
    'RV-1,2026-09-01T10:00:00,Google,H03,4,1-5,Anna K.,Slow,"Slow check-in at the reception desk"',
    'RV-2,2026-09-02T10:00:00,Google,H05,2,1-5,Tom,Cold,"The room was cold at night"',
  ].join("\n");
  await withState((st) => collect(st, csv, "b.csv"));

  // RV-1 gets analysed and has a draft waiting
  await withState((st) =>
    applyResults(st, new Map([["RV-1", { net: null, res: { analysis: { language: "en", sentiment: "negative", spam: false, refers_to_past_stay: false, issues: [], reason: "x", draft_reply: "Dear {{GUEST}}, sorry." }, inTokens: 1, outTokens: 1, costUsd: 0 } }]])),
  );

  // long batch: snapshot taken now, result applied later
  const snapshot = await loadState();
  assert.equal(snapshot.reviews["RV-2"].status, "queued");
  const batch = (async () => {
    await sleep(60); // pretend the AI call takes a while
    return withState((st) =>
      applyResults(st, new Map([["RV-2", { net: null, res: { analysis: { language: "en", sentiment: "negative", spam: false, refers_to_past_stay: false, issues: [], reason: "y", draft_reply: "Dear {{GUEST}}, sorry about the cold." }, inTokens: 1, outTokens: 1, costUsd: 0 } }]])),
    );
  })();
  // meanwhile the GM approves RV-1
  await withState((st) => decideDraft(st, "RV-1", "approve", r.H03.gm));
  await batch;

  const st = await loadState();
  assert.equal(st.reviews["RV-1"].draft?.status, "approved", "approval survived");
  assert.equal(st.reviews["RV-2"].status, "processed", "batch result survived");
  assert.equal(st.outbox.filter((m) => m.kind === "reply").length, 1);
});
