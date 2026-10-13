"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Review, State, WorkOrder } from "@/lib/types";
import { weekly, weeklyText } from "@/lib/weekly";

interface Api {
  state: State;
  routing: Record<string, { gm: string; engineer: string; housekeeping: string; country: string }>;
  actors: { email: string; role: string; hotel: string }[];
  bundled: string[];
  weeks: string[];
  model: string;
  price: { model: string; usdPerMIn: number; usdPerMOut: number };
  evalSummary: { model: string; lines: string[] } | null;
}
type Tab = "overview" | "approvals" | "orders" | "reviews" | "outbox" | "log" | "weekly" | "quality";

const SAFETY_SHORT: Record<string, string> = { electrical: "electrical", smoke_fire: "fire alarm", lift_trapped: "lift", water_leak: "water leak" };
const guest = (r: Review) => r.reviewer.split(/[\s.]/)[0] || "Guest";
const render = (r: Review, t: string) => t.replaceAll("{{GUEST}}", guest(r));
const short = (c: string) => c.replace("Technical – ", "T · ");
const fmtT = (s: string) => new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Agent() {
  const [api, setApi] = useState<Api | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [actor, setActor] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hotel, setHotel] = useState("All");

  const load = useCallback(async () => {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (r.ok) setApi(await r.json());
  }, []);
  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search); // deep links, e.g. ?tab=approvals&as=gm.h01@...
    const t = q.get("tab") as Tab | null;
    if (t) setTab(t);
    if (q.get("as")) setActor(q.get("as")!);
  }, [load]);

  const post = async (url: string, body: unknown) => {
    const r = await fetch(url, { method: "POST", body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
  };

  async function run(batch?: string) {
    setBusy(batch ?? "queue");
    setMsg(null);
    try {
      let first = await post("/api/run", { batch });
      let guard = 0;
      while (first.processed.remaining > 0 && guard++ < 6) first = await post("/api/run", {});
      const c = first.collected;
      setMsg({ ok: true, text: batch && c ? `${batch}: ${c.rows} rows, ${c.added} new to analyse, ${c.dups} duplicate, ${c.skipped} already known (skipped).` : "Queue processed." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy("");
    load();
  }

  async function act(fn: () => Promise<unknown>) {
    setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); window.scrollTo({ top: 0, behavior: "smooth" }); }
    load();
  }

  const st = api?.state;
  const me = api?.actors.find((a) => a.email === actor);
  const reviews = useMemo(() => Object.values(st?.reviews ?? {}).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)), [st]);
  const orders = useMemo(() => Object.values(st?.workOrders ?? {}).sort((a, b) => (a.priority === "P1 safety" ? -1 : 0) - (b.priority === "P1 safety" ? -1 : 0) || b.updatedAt.localeCompare(a.updatedAt)), [st]);
  const hotels = useMemo(() => Object.keys(api?.routing ?? {}).sort(), [api]);
  const inScope = (h: string) => (hotel === "All" || h === hotel) && (!me || me.hotel === h || false);
  const visHotel = (h: string) => (me ? me.hotel === h : hotel === "All" || hotel === h);

  if (!api || !st) return <div className="wrap"><p style={{ marginTop: 40 }}>Loading…</p></div>;

  // everything the user sees is limited to the hotel they act for (HQ: all hotels or the chosen one)
  const rv = reviews.filter((r) => visHotel(r.hotel));
  const ord = orders.filter((o) => visHotel(o.hotel));
  const outboxS = [...st.outbox].reverse().filter((o) => visHotel(outboxHotel(o, st, api.routing)));
  const hotelOfLog = (l: State["log"][number]) => (l.workOrder && st.workOrders[l.workOrder]?.hotel) || (l.review && st.reviews[l.review]?.hotel) || "";
  const logS = st.log.filter((l) => (me || hotel !== "All" ? visHotel(hotelOfLog(l)) : true));
  const stS: State = { ...st, log: logS };
  const routingS = Object.fromEntries(Object.entries(api.routing).filter(([h]) => visHotel(h)));
  const apiS: Api = { ...api, routing: routingS };
  const pending = rv.filter((r) => r.draft?.status === "pending");
  const openSafety = ord.filter((o) => o.safety && o.status !== "closed");
  const openOrders = ord.filter((o) => o.status !== "closed");
  const counts = {
    total: rv.length,
    queued: reviews.filter((r) => r.status === "queued").length, // global: the agent processes the whole queue
    dup: rv.filter((r) => r.status === "duplicate").length,
    spam: rv.filter((r) => r.status === "spam").length,
    review: rv.filter((r) => r.status === "needs_review" || r.status === "error").length,
  };
  void inScope;

  return (
    <>
      <header className="top">
        <div className="wrap">
          <img src="/apex-logo.svg" alt="Apex Alliance" className="logo" />
          <h1>Guest review agent</h1>
          <div className="status"><span>AI: {api.model}</span><span>Cost so far: ${st.usage.costUsd.toFixed(3)} ({st.usage.calls} calls)</span></div>
          <div className="sp" />
          <label className="status" style={{ gap: 8, alignItems: "center" }}>
            Acting as (demo simulation, no real sign-in)
            <select value={actor} onChange={(e) => setActor(e.target.value)} style={{ color: "var(--text)" }}>
              <option value="">HQ – read only</option>
              {api.actors.map((a) => <option key={a.email} value={a.email}>{a.hotel} · {a.role} · {a.email}</option>)}
            </select>
          </label>
        </div>
      </header>
      <div className="wrap">
        {openSafety.length > 0 && (
          <div className="safety">
            <div className="safety-head">
              <span className="safety-ico">⚠</span>
              <div>
                <b>{openSafety.length} open safety case{openSafety.length > 1 ? "s" : ""}</b>
                <div className="safety-sub">Urgent alerts are queued for the chief engineer and GM (simulated outbox). Only a GM can close a safety case.</div>
              </div>
            </div>
            <div className="safety-chips">
              {openSafety.map((o) => (
                <button key={o.id} className="chip" onClick={() => setTab("orders")} title={`${o.id}: ${o.summary[0] ?? ""}`}>
                  <b>{o.hotel}</b> {SAFETY_SHORT[o.safetyType] ?? "safety"} <span className="chip-id">{o.id}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {msg && <div className={`banner ${msg.ok ? "ok" : "alert"}`} style={{ marginTop: 10 }}>{msg.text}</div>}

        {!me && <div className="bar">
          <b>Source files</b>
          {api.bundled.map((b) => {
            const info = st.batches[b];
            return (
              <button key={b} className="btn" disabled={!!busy} onClick={() => run(b)}>
                {busy === b ? "Processing…" : info ? `↻ Re-check ${b} (loaded: ${info.newRows} new)` : `⬇ Load ${b}`}
              </button>
            );
          })}
          <button className="btn" disabled={!!busy || counts.queued === 0} onClick={() => run()}>
            {busy === "queue" ? "Processing…" : `Process queue (${counts.queued})`}
          </button>
          <label className="btn" style={{ cursor: "pointer" }}>
            ⬆ Upload CSV
            <input type="file" accept=".csv" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              act(async () => { const fd = new FormData(); fd.set("file", f); const r = await fetch("/api/upload", { method: "POST", body: fd }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setMsg({ ok: true, text: `${f.name}: ${j.collected.added} new, ${j.collected.dups} duplicate, ${j.collected.skipped} already known. Press “Process queue”.` }); });
              e.target.value = "";
            }} />
          </label>
          <button className="btn" disabled={!!busy} title="Admin only: deletes all reviews, work orders, drafts and the log so the demo can be run again" onClick={() => {
            const password = prompt("Reset ALL agent data (reviews, work orders, drafts, log)?\nEnter the admin password to confirm:");
            if (!password) return;
            act(async () => { await post("/api/reset", { password }); setMsg({ ok: true, text: "All agent data was reset. Load batch_01.csv to start again." }); });
          }}>⟲ Reset demo</button>
          <span className="small">Only review ids not seen before are analysed – re-loading a file never creates double work.</span>
        </div>}

        <div className="tabs" style={{ overflowX: "auto" }}>
          {([["overview", "Overview"], ["approvals", `Approvals (${pending.length})`], ["orders", `Work orders (${openOrders.length})`], ["reviews", `Reviews (${rv.length})`], ["outbox", `Outbox (${outboxS.length})`], ["log", "Action log"], ["weekly", "Weekly"], ["quality", "Quality & cost"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          {tab !== "quality" && !me && (
            <div className="bar" style={{ marginTop: 0 }}>
              <label>Hotel
                <select value={hotel} onChange={(e) => setHotel(e.target.value)}>
                  <option>All</option>
                  {hotels.map((h) => <option key={h}>{h}</option>)}
                </select>
              </label>
            </div>
          )}
          {tab === "overview" && <Overview counts={counts} pending={pending.length} openOrders={openOrders.length} openSafety={openSafety} st={stS} reviews={rv} setTab={setTab} />}
          {tab === "approvals" && <Approvals items={pending} actor={actor} me={me} act={act} post={post} routing={api.routing} done={rv.filter((r) => r.draft && r.draft.status !== "pending")} />}
          {tab === "orders" && <Orders orders={ord} actor={actor} act={act} post={post} routing={api.routing} scope={Object.keys(routingS)} />}
          {tab === "reviews" && <Reviews reviews={rv} />}
          {tab === "outbox" && <Outbox items={outboxS} />}
          {tab === "log" && <Log st={stS} />}
          {tab === "weekly" && <Weekly api={apiS} act={act} post={post} setMsg={setMsg} />}
          {tab === "quality" && <Quality api={api} />}
        </div>
      </div>
    </>
  );
}

/** Which hotel does an outbox message belong to? (work order / review / weekly summary recipient) */
function outboxHotel(o: State["outbox"][number], st: State, routing: Api["routing"]) {
  if (o.related && st.workOrders[o.related]) return st.workOrders[o.related].hotel;
  if (o.related && st.reviews[o.related]) return st.reviews[o.related].hotel;
  return Object.keys(routing).find((h) => o.to.includes(routing[h].gm) || o.to.includes(routing[h].engineer)) ?? "";
}

function Overview({ counts, pending, openOrders, openSafety, st, reviews, setTab }: { counts: Record<string, number>; pending: number; openOrders: number; openSafety: WorkOrder[]; st: State; reviews: Review[]; setTab: (t: Tab) => void }) {
  const tile = (label: string, val: string | number, meta: string, tab?: Tab, cls = "") => (
    <div className={`card tile ${cls}`} style={{ cursor: tab ? "pointer" : "default" }} onClick={() => tab && setTab(tab)}>
      <div className="lbl">{label}</div><div className="val">{val}</div><div className="meta">{meta}</div>
    </div>
  );
  const last = st.log.slice(-6).reverse();
  return (
    <div className="grid">
      <div className="grid tiles" style={{ margin: 0 }}>
        {tile("Reviews collected", counts.total, `${counts.queued} waiting · ${counts.dup} duplicate · ${counts.spam} spam`, "reviews")}
        {tile("Replies waiting for GM", pending, "nothing is sent without approval", "approvals")}
        {tile("Open work orders", openOrders, "grouped per hotel and problem", "orders")}
        {tile("Open safety cases", openSafety.length, "escalated immediately", "orders")}
        {tile("Need a person to look", counts.review, "AI failed or disagreed with safety check", "reviews")}
      </div>
      <div className="card">
        <h2>What the agent did last</h2>
        <div className="sub">Plain-English action log (full list in “Action log”).</div>
        {last.length === 0 ? <p className="small">Nothing yet – load a source file above.</p> : last.map((l, i) => <p key={i} style={{ margin: "6px 0" }}><span className="small">{fmtT(l.ts)} · {l.actor}</span><br />{l.text}</p>)}
      </div>
      <div className="card small">
        <b>How it works:</b> collect new reviews → remove contact data → AI classifies (language, sentiment, category, urgency, safety) and drafts a reply → keyword safety check runs alongside → work orders are created or grouped and routed → GM approves replies → weekly summary. Reviews in this view: {reviews.length}.
      </div>
    </div>
  );
}

function Approvals({ items, actor, me, act, post, routing, done }: { items: Review[]; actor: string; me?: { role: string; hotel: string }; act: (f: () => Promise<unknown>) => void; post: (u: string, b: unknown) => Promise<unknown>; routing: Api["routing"]; done: Review[] }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  return (
    <div className="grid">
      {!actor && <div className="banner warn" style={{ margin: 0 }}>Choose a GM in “Acting as” (top right) to approve or reject replies. HQ view is read-only.</div>}
      {items.length === 0 && <p className="small">No replies waiting.</p>}
      {items.map((r) => {
        const can = actor === routing[r.hotel].gm;
        const text = edits[r.id] ?? render(r, r.draft!.text);
        return (
          <div className="card" key={r.id}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <b>{r.id}</b><span className="pill none">{r.hotel}</span><span className="pill none">{r.source}</span>
              <span className="small">{r.rating5 ?? "?"}/5 · {r.analysis?.language.toUpperCase()} · {r.analysis?.sentiment}</span>
              {r.analysis?.issues.some((i) => i.safety_type !== "none") && <span className="pill alert">⚠ safety</span>}
              <span className="small">Approver: {routing[r.hotel].gm}</span>
            </div>
            <p style={{ margin: "10px 0 4px" }}><b>{r.title}</b></p>
            <p style={{ margin: "0 0 10px", color: "var(--text-2)" }}>{r.text}</p>
            <div className="small" style={{ marginBottom: 4 }}>Drafted reply (in the guest&apos;s language – editable)</div>
            <textarea className="ta" value={text} onChange={(e) => setEdits({ ...edits, [r.id]: e.target.value })} rows={6} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn primary2" disabled={!can} title={can ? "" : "Only the GM of this hotel can approve"} onClick={() => act(() => post("/api/draft", { id: r.id, action: "approve", actor, text: edits[r.id] ? edits[r.id].replace(guest(r), "{{GUEST}}") : undefined }))}>✓ Approve &amp; publish</button>
              <button className="btn" disabled={!can} onClick={() => act(() => post("/api/draft", { id: r.id, action: "reject", actor }))}>✕ Reject</button>
              {!can && actor && <span className="small" style={{ alignSelf: "center" }}>You are {me?.role} of {me?.hotel}; this needs the GM of {r.hotel}.</span>}
            </div>
          </div>
        );
      })}
      {done.length > 0 && (
        <div className="card">
          <h2>Decided</h2>
          <table><tbody>{done.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.hotel}</td><td><span className={`pill ${r.draft!.status === "approved" ? "ok" : "none"}`}>{r.draft!.status}</span></td><td>{r.draft!.decidedBy}</td><td className="small">{r.draft!.decidedAt && fmtT(r.draft!.decidedAt)}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

function Orders({ orders, actor, act, post, routing, scope }: { orders: WorkOrder[]; actor: string; act: (f: () => Promise<unknown>) => void; post: (u: string, b: unknown) => Promise<unknown>; routing: Api["routing"]; scope: string[] }) {
  const [show, setShow] = useState<"open" | "all">("open");
  const list = orders.filter((o) => show === "all" || o.status !== "closed");
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h2>Work orders</h2>
        <div style={{ display: "flex", gap: 8 }}><a className="btn" href={`/api/export?hotels=${scope.length < 12 ? scope.join(",") : ""}${show === "all" ? "&all=1" : ""}`} title="Download the list as an Excel file (open orders, or all if “All” is selected)">⬇ Export to Excel</a><div className="seg"><button className={show === "open" ? "on" : ""} onClick={() => setShow("open")}>Open</button><button className={show === "all" ? "on" : ""} onClick={() => setShow("all")}>All</button></div></div>
      </div>
      <div className="sub">Repeated reports of the same problem at the same hotel are grouped into one work order (see “reports”). The agent never closes anything.</div>
      <div className="scroll">
        <table>
          <thead><tr><th>ID</th><th>Priority</th><th>Hotel</th><th>Category</th><th>What guests report</th><th className="n">Reports</th><th>Rooms</th><th>Assigned</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.map((o) => {
              const row = routing[o.hotel];
              const may = actor && (actor === row.gm || actor === row.engineer || actor === row.housekeeping);
              return (
                <tr key={o.id}>
                  <td><b>{o.id}</b></td>
                  <td><span className={`pill ${o.priority === "P1 safety" ? "alert" : o.priority === "P2" ? "warn" : "none"}`}>{o.priority}</span></td>
                  <td>{o.hotel}</td><td>{short(o.category)}</td>
                  <td style={{ maxWidth: 420 }}>{o.summary.map((s, i) => <div key={i} className="small" style={{ color: "var(--text)" }}>{s}</div>)}</td>
                  <td className="n">{o.reviewIds.length}</td><td>{o.rooms.join(", ") || "–"}</td><td className="small">{o.assignedTo}</td>
                  <td><span className={`pill ${o.status === "closed" ? "ok" : "none"}`}>{o.status.replace("_", " ")}</span>{o.closeNote && <div className="small">{o.closeNote}</div>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {o.status === "open" && <button className="btn" disabled={!may} onClick={() => act(() => post("/api/wo", { id: o.id, action: "start", actor }))}>Start</button>}{" "}
                    {o.status !== "closed" && <button className="btn" disabled={!may} onClick={() => {
                      let note: string | null = "";
                      if (o.safety) {
                        note = prompt("Safety case – what was checked or repaired? (GM confirmation, min. 10 characters)");
                        if (note === null) return; // cancelled
                        if (note.trim().length < 10) {
                          alert("A safety case cannot be closed without a note (at least 10 characters) describing what was checked or repaired. The case stays open.");
                          return;
                        }
                      }
                      act(() => post("/api/wo", { id: o.id, action: "close", actor, note }));
                    }}>Close</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!actor && <p className="small">Choose who you are (top right) to start or close work orders.</p>}
    </div>
  );
}

function Reviews({ reviews }: { reviews: Review[] }) {
  const [open, setOpen] = useState("");
  return (
    <div className="card scroll">
      <table>
        <thead><tr><th>ID</th><th>Date</th><th>Hotel</th><th>Source</th><th>Rating</th><th>Lang</th><th>Sentiment</th><th>Categories</th><th>Status</th></tr></thead>
        <tbody>
          {reviews.map((r) => (
            <>
              <tr key={r.id} className="click" onClick={() => setOpen(open === r.id ? "" : r.id)}>
                <td><b>{r.id}</b></td><td className="small">{r.receivedAt.slice(5, 10)}</td><td>{r.hotel}</td><td>{r.source}</td><td>{r.rating5 ?? "?"}/5</td>
                <td>{r.analysis?.language ?? "–"}</td><td>{r.analysis?.sentiment ?? "–"}</td>
                <td>{[...new Set(r.analysis?.issues.map((i) => short(i.category)))].join(", ") || "–"}{r.analysis?.issues.some((i) => i.safety_type !== "none") && <span className="pill alert" style={{ marginLeft: 6 }}>safety</span>}</td>
                <td><span className={`pill ${r.status === "processed" ? "ok" : r.status === "needs_review" || r.status === "error" ? "alert" : "none"}`}>{r.status.replace("_", " ")}</span>{r.duplicateOf && <span className="small"> of {r.duplicateOf}</span>}</td>
              </tr>
              {open === r.id && (
                <tr key={r.id + "x"}><td colSpan={9} style={{ background: "var(--bg)" }}>
                  <p style={{ margin: "4px 0" }}><b>{r.title}</b> – {r.text}</p>
                  {r.pii.length > 0 && <p className="small">Removed before storing and before AI: {r.pii.join(", ")}.</p>}
                  {r.analysis && <p className="small">Agent reasoning: {r.analysis.reason}</p>}
                  {r.analysis?.issues.map((i, k) => <div key={k} className="small">• {short(i.category)} · {i.urgency} · {i.summary}{i.safety_type !== "none" ? ` · SAFETY: ${i.safety_type}` : ""}</div>)}
                  {r.workOrderIds.length > 0 && <p className="small">Work orders: {r.workOrderIds.join(", ")}</p>}
                  {r.error && <p className="small" style={{ color: "var(--alert-fg)" }}>Error: {r.error}</p>}
                </td></tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Outbox({ items }: { items: State["outbox"] }) {
  const [open, setOpen] = useState("");
  return (
    <div className="card">
      <h2>Outbox (simulated)</h2>
      <div className="sub">Work-order e-mails, urgent safety alerts, approved public replies and weekly summaries. The demo does not contact real people: addresses are test addresses.</div>
      {items.length === 0 && <p className="small">Empty.</p>}
      {items.map((m) => (
        <div key={m.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0", cursor: "pointer" }} onClick={() => setOpen(open === m.id ? "" : m.id)}>
          <span className={`pill ${m.kind === "safety_escalation" ? "alert" : m.kind === "reply" ? "ok" : "none"}`}>{m.kind.replace("_", " ")}</span>{" "}
          <b>{m.subject}</b> <span className="small">→ {m.to.join(", ")} · {fmtT(m.createdAt)}</span>
          {open === m.id && <pre style={{ whiteSpace: "pre-wrap", font: "inherit", color: "var(--text-2)", margin: "8px 0 0" }}>{m.body}</pre>}
        </div>
      ))}
    </div>
  );
}

function Log({ st }: { st: State }) {
  const [q, setQ] = useState("");
  const rows = [...st.log].reverse().filter((l) => !q || (l.text + l.review + l.workOrder + l.actor).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card">
      <h2>Action log</h2>
      <div className="sub">Every decision the agent or a person made, in plain English. Nothing is hidden or edited afterwards.</div>
      <input className="ta" style={{ height: 36, marginBottom: 10 }} placeholder="Search (review id, work order, hotel, person…)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="scroll"><table><tbody>
        {rows.slice(0, 300).map((l, i) => <tr key={i}><td className="small" style={{ whiteSpace: "nowrap" }}>{fmtT(l.ts)}</td><td className="small">{l.actor === "agent" ? "🤖 agent" : "👤 " + l.actor}</td><td>{l.text}</td></tr>)}
      </tbody></table></div>
    </div>
  );
}

function Weekly({ api, act, post, setMsg }: { api: Api; act: (f: () => Promise<unknown>) => void; post: (u: string, b: unknown) => Promise<unknown>; setMsg: (m: { ok: boolean; text: string }) => void }) {
  const [week, setWeek] = useState(api.weeks[api.weeks.length - 1] ?? "");
  const rows = week ? weekly(api.state, week, Object.keys(api.routing).sort()).filter((r) => r.reviews || r.openWorkOrders) : [];
  return (
    <div className="card">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <h2>Weekly summary per hotel</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={week} onChange={(e) => setWeek(e.target.value)}>{api.weeks.map((w) => <option key={w} value={w}>Week of {w}</option>)}</select>
          <button className="btn" disabled={!week} onClick={() => act(async () => { const j = (await post("/api/weekly", { week, hotels: Object.keys(api.routing) })) as { queued: number }; setMsg({ ok: true, text: `${j.queued} weekly summaries queued to the GMs (see Outbox).` }); })}>Queue to GMs</button>
        </div>
      </div>
      {!week && <p className="small">No reviews loaded yet.</p>}
      <div className="scroll"><table>
        <thead><tr><th>Hotel</th><th className="n">Reviews</th><th className="n">Avg rating</th><th>Trend</th><th>Top issues</th><th className="n" title="All work orders that are open today, whichever week they were created">Open WOs (all weeks, now)</th><th className="n" title="Open safety cases today">Safety open (now)</th><th className="n" title="Drafted replies still waiting for approval, for this week's reviews">Replies pending (this week)</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.hotel} title={weeklyText(r, week)}>
            <td><b>{r.hotel}</b></td><td className="n">{r.reviews}</td><td className="n">{r.avgRating ?? "–"}</td>
            <td>{r.avgRating === null || r.prevAvgRating === null ? "–" : r.avgRating > r.prevAvgRating ? "▲ better" : r.avgRating < r.prevAvgRating ? "▼ worse" : "= same"} <span className="small">(prev {r.prevAvgRating ?? "–"})</span></td>
            <td>{r.topIssues.map((i) => `${short(i.category)} (${i.count})`).join(", ") || "–"}</td>
            <td className="n">{r.openWorkOrders}</td><td className="n">{r.openSafety || "–"}</td><td className="n">{r.pendingReplies}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="small"><b>Reviews, rating, trend, top issues and pending replies are for the selected week. Open work orders and safety cases are the position today (all weeks), because they stay open until someone closes them.</b> Calculated from the stored data (no AI involved, so no invented numbers). Ratings are normalised to 1–5 (Booking 1–10 ÷ 2). Hover a row for the e-mail text.</p>
    </div>
  );
}

/** Turns the markdown table written by `npm run eval` into a table with traffic-light indicators. */
function EvalTable({ lines }: { lines: string[] }) {
  const intro = lines.find((l) => !l.startsWith("|") && l.trim()) ?? "";
  const rows = lines.filter((l) => l.startsWith("|") && !/^\|[-| ]+\|$/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim())).filter((r) => r[0] !== "Metric");
  const level = (label: string, value: string): "ok" | "warn" | "alert" | "none" => {
    if (/Tokens|Work orders/.test(label)) return "none";
    if (/Safety escalation|Safety by/.test(label)) { const m = value.match(/(\d+) \/ (\d+) \/ (\d+)/); return m ? (m[2] === "0" && m[3] === "0" ? "ok" : Number(m[3]) > 0 ? "alert" : "warn") : "none"; }
    if (/Spam|duplicates/.test(label)) { const m = value.match(/(\d+) \/ (\d+) \/ (\d+)/) ?? value.match(/(\d+)\/(\d+).*false duplicates (\d+)/); return m ? ((label.startsWith("Spam") ? m[2] === "0" && m[3] === "0" : m[1] === m[2] && m[3] === "0") ? "ok" : "warn") : "none"; }
    const pct = value.match(/(\d+(?:\.\d+)?)%/);
    if (pct) { const v = Number(pct[1]); return v >= 90 ? "ok" : v >= 75 ? "warn" : "alert"; }
    const f1 = value.match(/\/ ([01]\.\d+)$/);
    if (f1) { const v = Number(f1[1]); return v >= 0.9 ? "ok" : v >= 0.75 ? "warn" : "alert"; }
    return "none";
  };
  return (
    <>
      <p className="small">{intro}</p>
      <div className="scroll"><table>
        <thead><tr><th>Metric</th><th>Result</th></tr></thead>
        <tbody>{rows.map((r, i) => { const l = level(r[0], r[1]); return (
          <tr key={i}><td>{r[0]}</td><td><span className={`pill ${l}`}>{l === "ok" ? "✓ " : l === "warn" ? "▲ " : l === "alert" ? "✕ " : ""}{r[1]}</span></td></tr>
        ); })}</tbody>
      </table></div>
      <p className="small">Green ≥ 90 % (or no safety misses / false alarms), amber 75–90 %, red below. Reference labels were written by hand, so treat them as an estimate, not a guarantee.</p>
    </>
  );
}

function Quality({ api }: { api: Api }) {
  const u = api.state.usage;
  const nRev = Object.values(api.state.reviews).filter((r) => r.analysis).length;
  const per100 = nRev ? (u.costUsd / nRev) * 100 : 0;
  return (
    <div className="grid">
      <div className="card">
        <h2>Classification quality</h2>
        <div className="sub">Measured on all 100 sample reviews against reference labels (data/gold.txt) drafted with an AI assistant and not yet reviewed by a hotel specialist. Run again with <code>npm run eval</code>.</div>
        {api.evalSummary ? <EvalTable lines={api.evalSummary.lines} /> : <p className="small">No evaluation file yet.</p>}
      </div>
      <div className="card">
        <h2>Cost (measured in this demo)</h2>
        <p>{u.calls} AI calls · {u.inTokens.toLocaleString()} tokens in · {u.outTokens.toLocaleString()} out · <b>${u.costUsd.toFixed(3)}</b> · {u.failures} failures{per100 ? ` · ≈ $${per100.toFixed(3)} per 100 reviews` : ""}</p>
        <p className="small">Model {api.price.model}, assumed price ${api.price.usdPerMIn}/M input and ${api.price.usdPerMOut}/M output tokens (check current OpenAI pricing).</p>
      </div>
    </div>
  );
}
