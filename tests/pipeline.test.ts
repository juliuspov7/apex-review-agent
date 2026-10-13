// Run with: npm test   (Node's built-in test runner; no network, no API key needed)
import test from "node:test";
import assert from "node:assert/strict";
import { applyAnalysis, collect, decideDraft, routing, updateWorkOrder } from "../lib/pipeline.ts";
import { scrub } from "../lib/pii.ts";
import { safetyNet } from "../lib/safety.ts";
import { validate } from "../lib/llm.ts";
import { parseCsv } from "../lib/csv.ts";
import { emptyState, type Analysis } from "../lib/types.ts";

delete process.env.OPENAI_API_KEY; // grouping falls back to "separate work order" without the model

const HEAD = "review_id,received_at,source,hotel_id,rating,rating_scale,reviewer_name,title,text";
const csv = (...rows: string[]) => [HEAD, ...rows].join("\n");
const row = (id: string, hotel: string, text: string, source = "Google") => `${id},2026-09-01T10:00:00,${source},${hotel},4,1-5,Anna K.,Title,"${text}"`;

const analysis = (over: Partial<Analysis> = {}): Analysis => ({
  language: "en", sentiment: "negative", spam: false, refers_to_past_stay: false, needs_human_review: false, net_safety: null,
  reason: "test", draft_reply: "Dear {{GUEST}}, thank you.", issues: [], ...over,
});

test("CSV parser handles quotes, commas and newlines", () => {
  const r = parseCsv(`${HEAD}\nRV-1,2026-09-01T10:00:00,Booking,H01,5,1-10,Tom,"Hi, there","line one\nline ""two"""`);
  assert.equal(r.length, 1);
  assert.equal(r[0].text, 'line one\nline "two"');
});

test("personal data is removed; room numbers are kept for the engineer but masked for the model", () => {
  const s = scrub("Room 512, call +48 600 123 456 or mail jan.k@example.com. Booking ref 4481-2290. Booking no. 77812345.");
  assert.ok(!/\+48|jan\.k@|4481-2290|77812345/.test(s.stored));
  assert.deepEqual(s.rooms, ["512"]);
  assert.ok(s.stored.includes("512"));
  assert.ok(!s.forModel.includes("512") && s.forModel.includes("[ROOM]"));
  assert.deepEqual(new Set(s.removed), new Set(["phone", "email", "booking number"]));
});

test("safety keyword net catches multilingual hazards but not cigarette smoke", () => {
  assert.equal(safetyNet("La duș am simțit un șoc electric"), "electrical");
  assert.equal(safetyNet("Gniazdko iskrzyło i poczuliśmy zapach spalenizny"), "electrical");
  assert.equal(safetyNet("Fire alarm went off at 3 am"), "smoke_fire");
  assert.equal(safetyNet("Liftul s-a blocat din nou"), "lift_trapped");
  assert.equal(safetyNet("Woda z sufitu kapała w łazience"), "water_leak");
  assert.equal(safetyNet("În cameră mirosea puternic a fum de țigară"), null);
  assert.equal(safetyNet("The elevator was out of service"), null);
});

test("model output is validated strictly", () => {
  const ok = { language: "en", sentiment: "negative", spam: false, refers_to_past_stay: false, reason: "x", draft_reply: "Dear {{GUEST}}", issues: [{ category: "Technical – HVAC", summary: "AC", urgency: "high", safety_type: "none" }] };
  assert.equal(validate(ok).issues.length, 1);
  assert.throws(() => validate({ ...ok, issues: [{ ...ok.issues[0], category: "Made up" }] }), /category/);
  assert.throws(() => validate({ ...ok, sentiment: "angry" }), /sentiment/);
  assert.throws(() => validate({ ...ok, draft_reply: null }), /draft/);
  assert.equal(validate({ ...ok, spam: true, draft_reply: null, issues: [] }).spam, true);
});

test("collect is incremental: known review ids are skipped, cross-posted duplicates are linked", () => {
  const st = emptyState();
  const r1 = collect(st, csv(row("RV-1", "H02", "AC did not work in the room all night long"), row("RV-2", "H05", "Lovely staff")), "b1.csv");
  assert.equal(r1.added, 2);
  const r2 = collect(st, csv(row("RV-1", "H02", "AC did not work in the room all night long"), row("RV-3", "H02", "AC did not work in the room all night long", "TripAdvisor")), "b2.csv");
  assert.equal(r2.skipped, 1);
  assert.equal(r2.dups, 1);
  assert.equal(st.reviews["RV-3"].duplicateOf, "RV-1");
  assert.equal(st.reviews["RV-3"].status, "duplicate");
  assert.equal(Object.keys(st.reviews).length, 3);
});

test("work order is created, routed to the chief engineer, and no double order for a duplicate review", async () => {
  const st = emptyState();
  const r = await routing();
  collect(st, csv(row("RV-1", "H02", "Room 412 was cold, radiator barely warm")), "b.csv");
  await applyAnalysis(st, st.reviews["RV-1"], analysis({ issues: [{ category: "Technical – HVAC", summary: "Room cold", urgency: "medium", safety_type: "none" }] }), r);
  const wo = Object.values(st.workOrders);
  assert.equal(wo.length, 1);
  assert.equal(wo[0].assignedTo, r.H02.engineer);
  assert.deepEqual(wo[0].rooms, ["412"]);
  assert.equal(st.reviews["RV-1"].draft?.status, "pending"); // reply waits for the GM
  assert.equal(st.outbox.filter((m) => m.kind === "reply").length, 0); // nothing sent
});

test("safety case: P1, immediate e-mail to engineer and GM, only the GM can close it, and needs a note", async () => {
  const st = emptyState();
  const r = await routing();
  collect(st, csv(row("RV-1", "H01", "Electric shock in the shower, room 318")), "b.csv");
  await applyAnalysis(st, st.reviews["RV-1"], analysis({ issues: [{ category: "Technical – Electrical / Safety", summary: "Electric shock", urgency: "critical", safety_type: "electrical" }] }), r);
  const wo = Object.values(st.workOrders)[0];
  assert.equal(wo.priority, "P1 safety");
  const alert = st.outbox.find((m) => m.kind === "safety_escalation")!;
  assert.deepEqual(alert.to, [r.H01.engineer, r.H01.gm]);
  await assert.rejects(updateWorkOrder(st, wo.id, "close", r.H01.engineer, "fixed it all"), /only be closed by the GM/);
  await assert.rejects(updateWorkOrder(st, wo.id, "close", r.H01.gm, "ok"), /note/);
  await updateWorkOrder(st, wo.id, "close", r.H01.gm, "Electrician replaced the faulty shower mixer");
  assert.equal(st.workOrders[wo.id].status, "closed");
});

test("the keyword net escalates even when the model missed the safety issue", async () => {
  const st = emptyState();
  const r = await routing();
  collect(st, csv(row("RV-1", "H07", "Loose cable hanging from the ceiling in the bathroom, lebensgefährlich")), "b.csv");
  await applyAnalysis(st, st.reviews["RV-1"], analysis({ net_safety: "electrical", issues: [{ category: "Technical – Electrical / Safety", summary: "cable", urgency: "low", safety_type: "none" }] }), r);
  assert.equal(Object.values(st.workOrders)[0].priority, "P1 safety");
  assert.equal(st.reviews["RV-1"].status, "needs_review");
});

test("only the hotel's GM can approve a reply; approval is the only way a reply reaches the outbox", async () => {
  const st = emptyState();
  const r = await routing();
  collect(st, csv(row("RV-1", "H03", "Slow check-in")), "b.csv");
  await applyAnalysis(st, st.reviews["RV-1"], analysis({ issues: [{ category: "Front office / Service", summary: "slow", urgency: "low", safety_type: "none" }] }), r);
  await assert.rejects(decideDraft(st, "RV-1", "approve", r.H03.engineer), /Only the GM/);
  await assert.rejects(decideDraft(st, "RV-1", "approve", r.H04.gm), /Only the GM/);
  assert.equal(st.outbox.filter((m) => m.kind === "reply").length, 0);
  await decideDraft(st, "RV-1", "approve", r.H03.gm, "Dear {{GUEST}}, edited text.");
  const sent = st.outbox.filter((m) => m.kind === "reply");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body, "Dear Anna, edited text.");
  await assert.rejects(decideDraft(st, "RV-1", "approve", r.H03.gm), /already been decided/);
});

test("spam gets no work order and no reply draft", async () => {
  const st = emptyState();
  const r = await routing();
  collect(st, csv(row("RV-1", "H06", "Best deals at www.cheap-travel.example")), "b.csv");
  await applyAnalysis(st, st.reviews["RV-1"], analysis({ spam: true, draft_reply: null }), r);
  assert.equal(st.reviews["RV-1"].status, "spam");
  assert.equal(st.reviews["RV-1"].draft, undefined);
  assert.equal(Object.keys(st.workOrders).length, 0);
});
