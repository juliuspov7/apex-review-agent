import { promises as fs } from "fs";
import path from "path";
import { parseCsv } from "./csv.ts";
import { analyse } from "./llm.ts";
import { matchWorkOrder } from "./match.ts";
import { scrub } from "./pii.ts";
import { safetyNet } from "./safety.ts";
import { ConflictError, readStored, writeStored } from "./store.ts";
import {
  emptyState, isTechnical,
  type Analysis, type Category, type Issue, type OutboxItem, type Review, type SafetyType, type State, type WorkOrder,
} from "./types.ts";

export interface RouteRow { country: string; gm: string; engineer: string; housekeeping: string }
let routingCache: Record<string, RouteRow> | null = null;
export async function routing(): Promise<Record<string, RouteRow>> {
  if (!routingCache) routingCache = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "routing.json"), "utf8"));
  return routingCache!;
}

const STATE_FILE = "agent/state.json";
async function loadWithEtag(): Promise<{ st: State; etag?: string }> {
  const s = await readStored(STATE_FILE);
  return { st: s ? ({ ...emptyState(), ...JSON.parse(s.buf.toString("utf8")) } as State) : emptyState(), etag: s?.etag };
}
export async function loadState(): Promise<State> {
  return (await loadWithEtag()).st;
}
export async function saveState(st: State, etag?: string | null) {
  st.log = st.log.slice(-5000);
  await writeStored(STATE_FILE, JSON.stringify(st), "application/json", etag);
}

/**
 * Read-modify-write with optimistic locking: the write only succeeds if nobody changed the state in between
 * (Blob ETag). On conflict the change is re-applied to the fresh state, so parallel actions (an approval while
 * a batch is being processed) cannot overwrite each other.
 */
export async function withState<T>(fn: (st: State) => Promise<T> | T): Promise<T> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const { st, etag } = await loadWithEtag();
    const out = await fn(st);
    try {
      await saveState(st, etag ?? null); // no file yet = only write if still no file
      return out;
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 250 * (attempt + 1))); // jitter, so simultaneous writers do not collide again together
    }
  }
  throw new Error("The system is busy, please try again");
}

export const BUNDLED_BATCHES = ["batch_01.csv", "batch_02.csv"];
export async function readBundled(name: string) {
  if (!BUNDLED_BATCHES.includes(name)) throw new Error("unknown batch file");
  return fs.readFile(path.join(process.cwd(), "data", name), "utf8");
}

const now = () => new Date().toISOString();
const log = (st: State, entry: Omit<import("./types.ts").LogEntry, "ts" | "actor"> & { actor?: string }) =>
  st.log.push({ ts: now(), actor: entry.actor ?? "agent", review: entry.review, workOrder: entry.workOrder, text: entry.text });

const tokens = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
function similarity(a: string, b: string) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// ---------------------------------------------------------------- 1. collect
export function collect(st: State, csv: string, batch: string) {
  const rows = parseCsv(csv);
  let added = 0, dups = 0, skipped = 0;
  const existing = () => Object.values(st.reviews);
  for (const r of rows.sort((a, b) => a.received_at.localeCompare(b.received_at))) {
    const id = r.review_id;
    if (!id || !r.hotel_id) { skipped++; continue; }
    if (st.reviews[id]) { skipped++; continue; } // already seen: no double processing
    const sc = scrub(`${r.title}\n${r.text}`);
    const scale = Number((r.rating_scale || "1-5").split("-")[1]) || 5;
    const raw = Number(r.rating);
    const review: Review = {
      id, receivedAt: r.received_at, source: r.source, hotel: r.hotel_id,
      rating5: Number.isFinite(raw) ? Math.round((raw / scale) * 50) / 10 : null,
      ratingRaw: `${r.rating}/${scale}`, reviewer: r.reviewer_name, title: r.title,
      text: sc.stored, rooms: sc.rooms, pii: sc.removed, batch, status: "queued",
      workOrderIds: [], processedAt: now(),
    };
    // cross-post / duplicate detection (same hotel, near-identical text)
    const twin = existing().find((o) => o.hotel === review.hotel && o.status !== "duplicate" && similarity(o.text, review.text) >= 0.85);
    if (twin) {
      review.status = "duplicate";
      review.duplicateOf = twin.id;
      log(st, { review: id, text: `${id} (${r.source}) is a duplicate of ${twin.id} (${twin.source}) – same hotel, same text. No new analysis, work order or reply; the GM can use the reply drafted for ${twin.id} on both platforms.` });
      dups++;
    } else {
      added++;
      if (sc.removed.length) log(st, { review: id, text: `${id}: removed ${sc.removed.join(", ")} from the review text before storing and before AI analysis.` });
    }
    st.reviews[id] = review;
  }
  st.batches[batch] = { loadedAt: now(), rows: rows.length, newRows: added + dups };
  log(st, { text: `Collected ${batch}: ${rows.length} rows, ${added + dups} new (${dups} duplicate), ${skipped} already known and skipped.` });
  return { rows: rows.length, added, dups, skipped };
}

// ---------------------------------------------------------------- 2. analyse + act
const TYPE_TO_CAT: Record<Exclude<SafetyType, "none">, Category> = {
  electrical: "Technical – Electrical / Safety",
  smoke_fire: "Technical – Electrical / Safety",
  lift_trapped: "Technical – Lifts",
  water_leak: "Technical – Water",
};
const SAFETY_LABEL: Record<Exclude<SafetyType, "none">, string> = {
  electrical: "possible electrical hazard", smoke_fire: "possible smoke / fire-alarm problem", lift_trapped: "lift malfunction, possible entrapment", water_leak: "possible water leak / flooding",
};

function ownerFor(cat: Category, hotel: string, r: Record<string, RouteRow>) {
  const row = r[hotel];
  if (cat === "Housekeeping") return row.housekeeping;
  return row.engineer;
}

function nextWo(st: State) { st.counters.wo++; return `WO-${String(st.counters.wo).padStart(4, "0")}`; }
function nextMsg(st: State) { st.counters.msg++; return `MSG-${String(st.counters.msg).padStart(4, "0")}`; }
function send(st: State, item: Omit<OutboxItem, "id" | "createdAt">) {
  st.outbox.push({ id: nextMsg(st), createdAt: now(), ...item });
}

async function upsertWorkOrder(st: State, rev: Review, issue: Issue, safety: SafetyType, r: Record<string, RouteRow>, pastStay = false) {
  const isSafety = safety !== "none";
  const priority: WorkOrder["priority"] = isSafety ? "P1 safety" : issue.urgency === "high" || issue.urgency === "critical" ? "P2" : "P3";
  const assignedTo = ownerFor(issue.category, rev.hotel, r);
  const line = `${rev.id} (${rev.source}${rev.rooms.length ? ", room " + rev.rooms.join("/") : ""}): ${issue.summary}${pastStay ? " [guest also refers to an earlier stay – please verify it is still a problem]" : ""}`;
  const cutoff = Date.now() - 21 * 86400e3;
  const candidates = Object.values(st.workOrders).filter(
    (w) => w.hotel === rev.hotel && w.category === issue.category && w.status !== "closed" && (isSafety || !w.safety) && Date.parse(w.createdAt) >= cutoff,
  );
  let open: WorkOrder | undefined;
  if (candidates.length) {
    const m = await matchWorkOrder(issue.summary, candidates.map((c) => ({ id: c.id, lines: c.summary.map((x) => x.replace(/^RV-\d+ \([^)]*\): /, "")) })));
    st.usage.calls++; st.usage.inTokens += m.inTokens; st.usage.outTokens += m.outTokens; st.usage.costUsd += m.costUsd;
    open = candidates.find((c) => c.id === m.id);
  }
  if (open) {
    if (!open.reviewIds.includes(rev.id)) {
      open.reviewIds.push(rev.id);
      open.summary.push(line);
      for (const rm of rev.rooms) if (!open.rooms.includes(rm)) open.rooms.push(rm);
      if (priority === "P2" && open.priority === "P3") open.priority = "P2";
      if (isSafety && !open.safety) {
        // a later report shows this problem is safety-relevant: upgrade the existing order
        open.safety = true;
        open.safetyType = safety;
        open.priority = "P1 safety";
        log(st, { review: rev.id, workOrder: open.id, text: `${open.id} was UPGRADED to a safety case because ${rev.id} describes a safety risk (${safety}).` });
      }
      open.updatedAt = now();
      open.title = `${issue.category} – ${open.reviewIds.length} guest reports`;
    }
    log(st, { review: rev.id, workOrder: open.id, text: `${rev.id}: same problem already open at ${rev.hotel} (${issue.category}), so it was ADDED to ${open.id} (now ${open.reviewIds.length} reports) instead of creating a new work order.` });
    return { wo: open, created: false };
  }
  const wo: WorkOrder = {
    id: nextWo(st), hotel: rev.hotel, category: issue.category, priority,
    title: `${issue.category}: ${issue.summary}`.slice(0, 140), summary: [line], rooms: [...rev.rooms],
    reviewIds: [rev.id], assignedTo, safety: isSafety, safetyType: safety, status: "open", createdAt: now(), updatedAt: now(),
  };
  st.workOrders[wo.id] = wo;
  return { wo, created: true };
}

function escalate(st: State, wo: WorkOrder, rev: Review, r: Record<string, RouteRow>, why: string) {
  const row = r[wo.hotel];
  send(st, {
    kind: "safety_escalation",
    to: [row.engineer, row.gm],
    subject: `URGENT SAFETY – ${wo.hotel} – ${SAFETY_LABEL[wo.safetyType as Exclude<SafetyType, "none">] ?? "safety"} – ${wo.id}`,
    body: `A guest review reports a possible safety issue at ${wo.hotel}.\n\n${wo.summary.join("\n")}\n\nWhy this was escalated: ${why}\n\nPlease check immediately. This case can only be closed by a person (GM confirmation with a note); the agent will never close it.\nReview ${rev.id}: "${rev.title}"`,
    related: wo.id,
  });
  log(st, { review: rev.id, workOrder: wo.id, text: `SAFETY ESCALATION ${wo.id} at ${wo.hotel}: urgent alert queued in the (simulated) outbox for chief engineer (${row.engineer}) and GM (${row.gm}). Reason: ${why}` });
}

export async function applyAnalysis(st: State, rev: Review, a: Analysis, r: Record<string, RouteRow>) {
  rev.analysis = a;
  const guestIssues: Issue[] = [...a.issues];

  // safety net can only ADD an escalation: upgrade the matching issue, or add one if the model had none for it
  if (a.net_safety && !guestIssues.some((i) => i.safety_type !== "none")) {
    const cat = TYPE_TO_CAT[a.net_safety as Exclude<SafetyType, "none">];
    const same = guestIssues.find((i) => i.category === cat);
    if (same) {
      same.safety_type = a.net_safety;
      same.urgency = "critical";
    } else {
      guestIssues.push({
        category: cat,
        summary: `Safety risk reported: ${SAFETY_LABEL[a.net_safety as Exclude<SafetyType, "none">]} (flagged by the safety keyword check)`,
        urgency: "critical", safety_type: a.net_safety,
      });
    }
    a.needs_human_review = true;
    log(st, { review: rev.id, text: `${rev.id}: the AI did not mark a safety issue but the keyword safety check did (${a.net_safety}) – escalated to be safe and flagged for human review.` });
  }
  a.issues = guestIssues;

  if (a.spam) {
    rev.status = "spam";
    log(st, { review: rev.id, text: `${rev.id} classified as spam/advertising – no work order, no reply drafted.` });
    return;
  }

  const cats = [...new Set(guestIssues.map((i) => i.category))];
  log(st, { review: rev.id, text: `${rev.id} (${rev.hotel}, ${a.language}, ${a.sentiment}${rev.rating5 !== null ? `, ${rev.rating5}/5` : ""}): ${cats.length ? cats.join("; ") : "no complaints"}. ${a.reason}` });

  for (const issue of guestIssues) {
    const safety = issue.safety_type;
    const needsWo = isTechnical(issue.category) || issue.category === "Housekeeping";
    if (!needsWo) continue;
    const { wo, created } = await upsertWorkOrder(st, rev, issue, safety, r, a.refers_to_past_stay);
    if (!rev.workOrderIds.includes(wo.id)) rev.workOrderIds.push(wo.id);
    if (created) {
      log(st, { review: rev.id, workOrder: wo.id, text: `Work order ${wo.id} created (${wo.priority}) for ${wo.hotel} – ${wo.category}, assigned to ${wo.assignedTo}.` });
      if (wo.safety) escalate(st, wo, rev, r, `${SAFETY_LABEL[safety as Exclude<SafetyType, "none">]} reported in review ${rev.id} (the guest report is not verified)${a.net_safety ? "; confirmed by keyword check" : ""}.`);
      else
        send(st, {
          kind: "work_order", to: [wo.assignedTo], related: wo.id,
          subject: `[${wo.priority}] ${wo.hotel} – ${wo.title}`,
          body: `New work order ${wo.id} from a guest review.\n\n${wo.summary.join("\n")}\n\nPriority: ${wo.priority}\nCategory: ${wo.category}`,
        });
    } else if (wo.safety && wo.priority === "P1 safety" && safety !== "none" && wo.reviewIds.length > 1) {
      escalate(st, wo, rev, r, `another guest report of the same safety issue (${wo.reviewIds.length} reports).`);
    }
  }

  if (a.draft_reply) {
    rev.draft = { language: a.language, text: a.draft_reply, status: "pending" };
    log(st, { review: rev.id, text: `Reply to guest drafted in ${a.language.toUpperCase()} for GM ${r[rev.hotel].gm}. NOT sent – waiting for approval.` });
  }
  rev.status = a.needs_human_review ? "needs_review" : "processed";
}

type Result = { net: ReturnType<typeof safetyNet>; res?: Awaited<ReturnType<typeof analyse>>; err?: Error & { inTokens?: number; outTokens?: number } };

/** Phase 1: AI analysis of queued reviews, in parallel. Reads the state, changes nothing. */
export async function analyseQueue(st: State, limit = 30, concurrency = 6) {
  const queue = Object.values(st.reviews).filter((x) => x.status === "queued").sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).slice(0, limit);
  const results = new Map<string, Result>();
  let i = 0;
  async function worker() {
    while (i < queue.length) {
      const rev = queue[i++];
      const net = safetyNet(rev.text);
      try { results.set(rev.id, { net, res: await analyse(scrub(`${rev.title}\n${rev.text}`).forModel, guestName(rev)) }); }
      catch (e) { results.set(rev.id, { net, err: e as Error }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results;
}

/** Phase 2: act on the results one by one in arrival order (keeps grouping deterministic). */
export async function applyResults(st: State, results: Map<string, Result>) {
  const r = await routing();
  const queue = Object.values(st.reviews).filter((x) => x.status === "queued" && results.has(x.id)).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  let done = 0, failed = 0;
  for (const rev of queue) {
    const { net, res, err } = results.get(rev.id)!;
    if (res) {
      st.usage.calls++; st.usage.inTokens += res.inTokens; st.usage.outTokens += res.outTokens; st.usage.costUsd += res.costUsd;
      await applyAnalysis(st, rev, { ...res.analysis, net_safety: net, needs_human_review: false }, r);
      rev.error = undefined;
      rev.processedAt = now();
      done++;
      continue;
    }
    st.usage.failures++;
    st.usage.inTokens += err?.inTokens ?? 0; st.usage.outTokens += err?.outTokens ?? 0;
    rev.attempts = (rev.attempts ?? 0) + 1;
    rev.error = err?.message;
    failed++;
    if (net) {
      // AI unavailable, but the keyword check still protects guests: escalate with the net alone
      const a: Analysis = { language: "en", sentiment: "negative", spam: false, refers_to_past_stay: false, issues: [], reason: "AI analysis failed; handled by the safety keyword check only.", draft_reply: null, net_safety: net, needs_human_review: true };
      await applyAnalysis(st, rev, a, r);
      rev.status = "needs_review";
    } else if (rev.attempts >= 3) {
      rev.status = "error";
      log(st, { review: rev.id, text: `${rev.id}: AI analysis failed ${rev.attempts} times (${err?.message}). A person needs to handle this review manually.` });
    } else {
      log(st, { review: rev.id, text: `${rev.id}: AI analysis failed (${err?.message}); it stays in the queue and will be retried on the next run.` });
    }
  }
  const remaining = Object.values(st.reviews).filter((x) => x.status === "queued" && (x.attempts ?? 0) < 3).length;
  return { done, failed, remaining };
}

export async function processQueued(st: State, limit = 30, concurrency = 6) {
  return applyResults(st, await analyseQueue(st, limit, concurrency));
}

// ---------------------------------------------------------------- 3. humans decide
export async function actors() {
  const r = await routing();
  return Object.entries(r).flatMap(([h, x]) => [
    { email: x.gm, role: "GM", hotel: h },
    { email: x.engineer, role: "Chief engineer", hotel: h },
  ]);
}

export function guestName(rev: Review) {
  const n = rev.reviewer.split(/[\s.]/)[0];
  return n || "Guest";
}
export const renderDraft = (rev: Review, text: string) => text.replaceAll("{{GUEST}}", guestName(rev));

export async function decideDraft(st: State, id: string, action: "approve" | "reject", actor: string, edited?: string) {
  const r = await routing();
  const rev = st.reviews[id];
  if (!rev?.draft) throw new Error("No draft for this review");
  if (rev.draft.status !== "pending") throw new Error("This draft has already been decided");
  if (r[rev.hotel].gm !== actor) throw new Error(`Only the GM of ${rev.hotel} (${r[rev.hotel].gm}) can approve or reject replies`);
  const d = rev.draft;
  d.decidedBy = actor;
  d.decidedAt = now();
  if (action === "reject") {
    d.status = "rejected";
    log(st, { actor, review: id, text: `${actor} REJECTED the drafted reply to ${id}. Nothing was sent.` });
    return;
  }
  if (edited && edited.trim() && edited !== d.text) d.editedText = edited.trim();
  d.status = "approved";
  const finalText = renderDraft(rev, d.editedText ?? d.text);
  const msg: OutboxItem = {
    id: nextMsg(st), kind: "reply", createdAt: now(), related: id,
    to: [`platform:${rev.source}`],
    subject: `Public reply to review ${id} on ${rev.source}`,
    body: finalText,
  };
  st.outbox.push(msg);
  d.publishedAs = msg.id;
  log(st, { actor, review: id, text: `${actor} APPROVED${d.editedText ? " (after editing)" : ""} the reply to ${id}. It was released to ${rev.source} (simulated in this demo: see Outbox ${msg.id}).` });
}

export async function updateWorkOrder(st: State, id: string, action: "start" | "close", actor: string, note?: string) {
  const r = await routing();
  const wo = st.workOrders[id];
  if (!wo) throw new Error("Unknown work order");
  const row = r[wo.hotel];
  if (actor !== row.gm && actor !== row.engineer && actor !== row.housekeeping) throw new Error(`${actor} is not responsible for ${wo.hotel}`);
  if (action === "start") {
    wo.status = "in_progress";
    wo.updatedAt = now();
    log(st, { actor, workOrder: id, text: `${actor} started work on ${id}.` });
    return;
  }
  if (wo.safety && actor !== row.gm) throw new Error(`Safety cases can only be closed by the GM (${row.gm})`);
  if (wo.safety && (!note || note.trim().length < 10)) throw new Error("Closing a safety case needs a note of what was checked or repaired (min 10 characters)");
  wo.status = "closed";
  wo.closedBy = actor;
  wo.closeNote = note?.trim();
  wo.updatedAt = now();
  log(st, { actor, workOrder: id, text: `${actor} CLOSED ${id}${wo.safety ? " (safety case, confirmed by GM)" : ""}${note ? `: ${note.trim()}` : ""}.` });
}
