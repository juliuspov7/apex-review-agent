"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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

async function logout() {
  await fetch("/api/logout", { method: "POST" }).catch(() => null);
  window.location.href = "/login";
}

export default function Agent() {
  const [api, setApi] = useState<Api | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [actor, setActor] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hotel, setHotel] = useState("All");

  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (!r.ok) throw new Error(`The server answered ${r.status}`);
      setApi(await r.json());
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message || "Network error");
    }
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
    setSaving(true);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); window.scrollTo({ top: 0, behavior: "smooth" }); }
    await load();
    setSaving(false);
  }

  const st = api?.state;
  const me = api?.actors.find((a) => a.email === actor);
  const reviews = useMemo(() => Object.values(st?.reviews ?? {}).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)), [st]);
  const orders = useMemo(() => Object.values(st?.workOrders ?? {}).sort((a, b) => (a.priority === "P1 safety" ? -1 : 0) - (b.priority === "P1 safety" ? -1 : 0) || b.updatedAt.localeCompare(a.updatedAt)), [st]);
  const hotels = useMemo(() => Object.keys(api?.routing ?? {}).sort(), [api]);
  const inScope = (h: string) => (hotel === "All" || h === hotel) && (!me || me.hotel === h || false);
  const visHotel = (h: string) => (me ? me.hotel === h : hotel === "All" || hotel === h);

  if (!api || !st) return <Skeleton failed={loadError || undefined} retry={() => { setLoadError(""); load(); }} />;

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
          <div className="hdr-left">
            <img src="/apex-logo.svg" alt="Apex Alliance" className="logo" />
            <h1>Guest review agent</h1>
          </div>
          <div className="chips">
            <span className="chip2"><i className="dot ok" />AI: {api.model}</span>
            <span className="chip2">Cost so far ${st.usage.costUsd.toFixed(3)} ({st.usage.calls} calls)</span>
            {saving && <span className="chip2 saving"><Spinner small /> Saving…</span>}
          </div>
          <div className="hdr-actions">
            <label>
              <span>Acting as<small>demo simulation, no real sign-in</small></span>
              <select value={actor} onChange={(e) => setActor(e.target.value)} style={{ color: "var(--text)" }}>
                <option value="">HQ – read only</option>
                {api.actors.map((a) => <option key={a.email} value={a.email}>{a.hotel} · {a.role} · {a.email}</option>)}
              </select>
            </label>
            <button className="btn" onClick={logout} title="End this session">Log out</button>
          </div>
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
                {busy === b ? <><Spinner small /> Processing…</> : info ? `Re-check ${b} (loaded: ${info.newRows} new)` : `Load ${b}`}
              </button>
            );
          })}
          <button className="btn" disabled={!!busy || counts.queued === 0} onClick={() => run()}>
            {busy === "queue" ? <><Spinner small /> Processing…</> : `Process queue (${counts.queued})`}
          </button>
          <label className="btn" style={{ cursor: "pointer" }}>
            Upload CSV
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
          }}>Reset demo</button>
          <span className="small">Only review ids not seen before are analysed – re-loading a file never creates double work.</span>
        </div>}
        {busy && (
          <div className="progress" role="status">
            <Spinner small /> <b>{busy === "queue" ? "Processing the queue" : `Loading ${busy}`}</b> – the AI is reading the reviews, removing personal data and creating work orders. This takes about 10–40 seconds; the page updates by itself.
            <span className="progress-bar" />
          </div>
        )}

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
          {tab === "overview" && <Overview counts={counts} pending={pending.length} openOrders={openOrders.length} openSafety={openSafety} st={stS} reviews={rv} orders={ord} setTab={setTab} empty={rv.length === 0 && counts.queued === 0} />}
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

function Spinner({ small }: { small?: boolean }) {
  return <span className={`spinner${small ? " sm" : ""}`} role="status" aria-label="Loading" />;
}

function Empty({ title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {hint && <span>{hint}</span>}
    </div>
  );
}

function Skeleton({ failed, retry }: { failed?: string; retry?: () => void }) {
  if (failed) {
    return (
      <div className="wrap" style={{ marginTop: 40 }}>
        <Empty title="The agent could not load" hint={failed} />
        {retry && <p style={{ textAlign: "center", marginTop: 12 }}><button className="btn" onClick={retry}>Try again</button></p>}
      </div>
    );
  }
  return (
    <div className="wrap" style={{ marginTop: 24 }} aria-busy="true">
      <div className="skel" style={{ height: 70, marginBottom: 14 }} />
      <div className="skel" style={{ height: 44, width: 520, marginBottom: 14 }} />
      <div className="grid tiles">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 96 }} />)}</div>
      <div className="skel" style={{ height: 260, marginTop: 12 }} />
      <p className="small" style={{ textAlign: "center", marginTop: 14 }}><Spinner small /> Loading the agent…</p>
    </div>
  );
}

const CAT_ICON: Record<string, string> = {};
const SENT_DOT: Record<string, string> = { positive: "ok", negative: "alert", mixed: "warn", neutral: "none" };

function Chip({ children, tone = "none" }: { children: React.ReactNode; tone?: "none" | "ok" | "warn" | "alert" }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

function Overview({ counts, pending, openOrders, openSafety, st, reviews, orders, setTab, empty }: { counts: Record<string, number>; pending: number; openOrders: number; openSafety: WorkOrder[]; st: State; reviews: Review[]; orders: WorkOrder[]; setTab: (t: Tab) => void; empty: boolean }) {
  const tile = (label: string, val: string | number, meta: string, tab?: Tab, cls = "") => (
    <div className={`card tile ${cls}`} style={{ cursor: tab ? "pointer" : "default" }} onClick={() => tab && setTab(tab)}>
      <div className="lbl">{label}</div><div className="val">{val}</div><div className="meta">{meta}</div>
    </div>
  );
  const last = st.log.slice(-6).reverse();
  if (empty) return <Empty title="No reviews yet" hint="Press “Load batch_01.csv” above to collect and analyse the first reviews." />;

  // pipeline numbers
  const analysed = reviews.filter((r) => r.analysis && r.status !== "spam").length;
  const drafted = reviews.filter((r) => r.draft).length;
  const approved = reviews.filter((r) => r.draft?.status === "approved").length;
  const steps: { n: number; label: string; sub: string; tab: Tab; hot?: boolean }[] = [
    { n: counts.total, label: "Collected", sub: `${counts.dup} duplicate · ${counts.spam} spam`, tab: "reviews" },
    { n: analysed, label: "Analysed by AI", sub: `${counts.queued} waiting`, tab: "reviews" },
    { n: orders.length, label: "Work orders", sub: `${openSafety.length} safety open`, tab: "orders" },
    { n: drafted, label: "Replies drafted", sub: `${pending} waiting for GM`, tab: "approvals", hot: pending > 0 },
    { n: approved, label: "Approved & released", sub: "by the hotel GM", tab: "outbox" },
  ];

  // complaints per category (one count per review)
  const cat = new Map<string, number>();
  for (const r of reviews) for (const c of new Set(r.analysis?.issues.map((i) => i.category) ?? [])) cat.set(c, (cat.get(c) ?? 0) + 1);
  const cats = [...cat.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...cats.map((c) => c[1]));

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
        <h2>From review to action</h2>
        <div className="sub">What happened to the reviews in this view. Click a step to open it.</div>
        <div className="pipe">
          {steps.map((s, i) => (
            <div key={s.label} className="pipe-wrap">
              <button className={`pipe-step ${s.hot ? "hot" : ""}`} onClick={() => setTab(s.tab)}>
                <span className="pipe-n">{s.n}</span>
                <span className="pipe-l">{s.label}</span>
                <span className="pipe-s">{s.sub}</span>
              </button>
              {i < steps.length - 1 && <span className="pipe-arrow">→</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid twocol">
        <div className="card">
          <h2>Complaints by category</h2>
          <div className="sub">Number of reviews that mention each category.</div>
          {cats.length === 0 ? <p className="small">No complaints found yet.</p> : (
            <div className="bars">
              {cats.map(([c, n]) => (
                <div key={c} className="bar-row">
                  <span className="bar-label">{short(c)}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${(n / max) * 100}%` }} /></span>
                  <span className="bar-num">{n}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h2>What the agent did last</h2>
          <div className="sub">Plain-English action log (full list in “Action log”).</div>
          {last.length === 0 ? <p className="small">Nothing yet.</p> : last.map((l, i) => <p key={i} style={{ margin: "6px 0" }}><span className="small">{fmtT(l.ts)} · {l.actor}</span><br />{l.text}</p>)}
        </div>
      </div>
    </div>
  );
}

function Approvals({ items, actor, me, act, post, routing, done }: { items: Review[]; actor: string; me?: { role: string; hotel: string }; act: (f: () => Promise<unknown>) => void; post: (u: string, b: unknown) => Promise<unknown>; routing: Api["routing"]; done: Review[] }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  return (
    <div className="grid">
      {!actor && <div className="banner warn" style={{ margin: 0 }}>Choose a GM in “Acting as” (top right) to approve or reject replies. HQ view is read-only.</div>}
      {items.length === 0 && <Empty title="No replies waiting" hint="Every drafted reply has been approved or rejected." />}
      {items.map((r) => {
        const can = actor === routing[r.hotel].gm;
        const text = edits[r.id] ?? render(r, r.draft!.text);
        const safety = r.analysis?.issues.some((i) => i.safety_type !== "none");
        return (
          <div className={`card appr ${safety ? "is-safety" : ""}`} key={r.id}>
            <div className="appr-review">
              <div className="appr-chips">
                <b>{r.id}</b><Chip>{r.hotel}</Chip><Chip>{r.source}</Chip>
                <Chip>{r.rating5 ?? "?"}/5</Chip>
                <Chip>{(r.analysis?.language ?? "").toUpperCase()}</Chip>
                <Chip tone={r.analysis?.sentiment === "positive" ? "ok" : r.analysis?.sentiment === "negative" ? "alert" : "warn"}>{r.analysis?.sentiment}</Chip>
                {safety && <Chip tone="alert">safety</Chip>}
              </div>
              <p className="appr-title">{r.title}</p>
              <p className="appr-text">{r.text}</p>
              <div className="appr-issues">
                {r.analysis?.issues.map((i, k) => <Chip key={k} tone={i.safety_type !== "none" ? "alert" : "none"}>{short(i.category)}</Chip>)}
              </div>
            </div>
            <div className="appr-reply">
              <div className="small" style={{ marginBottom: 4 }}>Drafted reply in the guest&apos;s language · editable · approver: {routing[r.hotel].gm}</div>
              <textarea className="ta" value={text} onChange={(e) => setEdits({ ...edits, [r.id]: e.target.value })} rows={8} />
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button className="btn primary2" disabled={!can} title={can ? "" : "Only the GM of this hotel can approve"} onClick={() => act(() => post("/api/draft", { id: r.id, action: "approve", actor, text: edits[r.id] ? edits[r.id].replace(guest(r), "{{GUEST}}") : undefined }))}>Approve &amp; publish</button>
                <button className="btn" disabled={!can} onClick={() => act(() => post("/api/draft", { id: r.id, action: "reject", actor }))}>Reject</button>
                {!can && actor && <span className="small" style={{ alignSelf: "center" }}>You are {me?.role} of {me?.hotel}; this needs the GM of {r.hotel}.</span>}
              </div>
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
  const byHotel = new Map<string, WorkOrder[]>();
  for (const o of list) byHotel.set(o.hotel, [...(byHotel.get(o.hotel) ?? []), o]);
  const hotelsSorted = [...byHotel.entries()].sort((a, b) => b[1].filter((o) => o.safety).length - a[1].filter((o) => o.safety).length || a[0].localeCompare(b[0]));
  const tone = (o: WorkOrder) => (o.status === "closed" ? "closed" : o.priority === "P1 safety" ? "p1" : o.priority === "P2" ? "p2" : "p3");
  return (
    <div className="grid">
      <div className="card" style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0 }}>Work orders</h2>
            <div className="sub" style={{ margin: 0 }}>Repeated reports of the same problem at the same hotel are grouped into one work order. The agent never closes anything.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}><a className="btn" href={`/api/export?hotels=${scope.length < 12 ? scope.join(",") : ""}${show === "all" ? "&all=1" : ""}`} title="Download the list as an Excel file (open orders, or all if “All” is selected)">Export to Excel</a><div className="seg"><button className={show === "open" ? "on" : ""} onClick={() => setShow("open")}>Open</button><button className={show === "all" ? "on" : ""} onClick={() => setShow("all")}>All</button></div></div>
        </div>
      </div>
      {list.length === 0 && <Empty title={show === "open" ? "No open work orders" : "No work orders yet"} hint="Technical complaints in reviews create work orders automatically." />}
      {hotelsSorted.map(([h, os]) => (
        <section key={h}>
          <h3 className="wo-hotel">{h} <span>· {routing[h]?.country} · {os.filter((o) => o.status !== "closed").length} open{os.some((o) => o.safety && o.status !== "closed") ? " · " : ""}{os.some((o) => o.safety && o.status !== "closed") && <b className="safe">safety</b>}</span></h3>
          <div className="wo-grid">
            {os.map((o) => {
              const row = routing[o.hotel];
              const may = actor && (actor === row.gm || actor === row.engineer || actor === row.housekeeping);
              return (
                <div key={o.id} className={`wo ${tone(o)}`}>
                  <div className="wo-head">
                    <b>{o.id}</b>
                    <span className={`pill ${o.priority === "P1 safety" ? "alert" : o.priority === "P2" ? "warn" : "none"}`}>{o.priority}</span>
                    <Chip>{short(o.category)}</Chip>
                    {o.reviewIds.length > 1 && <span className="tag hot">×{o.reviewIds.length} reports</span>}
                    <span className={`pill ${o.status === "closed" ? "ok" : "none"}`} style={{ marginLeft: "auto" }}>{o.status.replace("_", " ")}</span>
                  </div>
                  <ul className="wo-lines">{o.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  <div className="wo-foot">
                    <span className="small">{o.rooms.length ? `Rooms ${o.rooms.join(", ")} · ` : ""}{o.assignedTo.split("@")[0]}</span>
                    <span style={{ whiteSpace: "nowrap" }}>
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
                    </span>
                  </div>
                  {o.closeNote && <div className="small" style={{ marginTop: 4 }}>Closed: {o.closeNote}</div>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {!actor && list.length > 0 && <p className="small">Choose who you are (top right) to start or close work orders.</p>}
    </div>
  );
}

function Reviews({ reviews }: { reviews: Review[] }) {
  const [open, setOpen] = useState("");
  if (reviews.length === 0) return <Empty title="No reviews in this view" hint="Load a source file or choose another hotel." />;
  return (
    <div className="card scroll">
      <table>
        <thead><tr><th>ID</th><th>Date</th><th>Hotel</th><th>Source</th><th>Rating</th><th>Lang</th><th>Sentiment</th><th>Categories</th><th>Status</th></tr></thead>
        <tbody>
          {reviews.map((r) => (
            <React.Fragment key={r.id}>
              <tr className="click" onClick={() => setOpen(open === r.id ? "" : r.id)}>
                <td><b>{r.id}</b></td><td className="small">{r.receivedAt.slice(5, 10)}</td><td>{r.hotel}</td><td>{r.source}</td><td>{r.rating5 ?? "?"}/5</td>
                <td>{(r.analysis?.language ?? "–").toUpperCase()}</td>
                <td>{r.analysis ? <span className="sent"><i className={`dot ${SENT_DOT[r.analysis.sentiment]}`} />{r.analysis.sentiment}</span> : "–"}</td>
                <td>{[...new Set(r.analysis?.issues.map((i) => i.category))].map((c) => <Chip key={c}>{short(c)}</Chip>)}{!r.analysis?.issues.length && "–"}{r.analysis?.issues.some((i) => i.safety_type !== "none") && <Chip tone="alert">safety</Chip>}</td>
                <td><span className={`pill ${r.status === "processed" ? "ok" : r.status === "needs_review" || r.status === "error" ? "alert" : "none"}`}>{r.status.replace("_", " ")}</span>{r.duplicateOf && <span className="small"> of {r.duplicateOf}</span>}</td>
              </tr>
              {open === r.id && (
                <tr><td colSpan={9} style={{ background: "var(--bg)" }}>
                  <p style={{ margin: "4px 0" }}><b>{r.title}</b> – {r.text}</p>
                  {r.pii.length > 0 && <p className="small">Removed before storing and before AI: {r.pii.join(", ")}.</p>}
                  {r.analysis && <p className="small">Agent reasoning: {r.analysis.reason}</p>}
                  {r.analysis?.issues.map((i, k) => <div key={k} className="small">• {short(i.category)} · {i.urgency} · {i.summary}{i.safety_type !== "none" ? ` · SAFETY: ${i.safety_type}` : ""}</div>)}
                  {r.workOrderIds.length > 0 && <p className="small">Work orders: {r.workOrderIds.join(", ")}</p>}
                  {r.error && <p className="small" style={{ color: "var(--alert-fg)" }}>Error: {r.error}</p>}
                </td></tr>
              )}
            </React.Fragment>
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
      {items.length === 0 && <Empty title="Nothing in the outbox yet" hint="Work-order e-mails and approved replies appear here." />}
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

function logIcon(l: State["log"][number]): { icon: string; tone: string } {
  const t = l.text;
  if (/SAFETY ESCALATION|UPGRADED to a safety/.test(t)) return { icon: "!", tone: "alert" };
  if (/APPROVED/.test(t)) return { icon: "✓", tone: "ok" };
  if (/failed/.test(t)) return { icon: "!", tone: "alert" };
  if (/ADDED to/.test(t)) return { icon: "+", tone: "warn" };
  return { icon: "", tone: "none" };
}

function Log({ st }: { st: State }) {
  const [q, setQ] = useState("");
  const rows = [...st.log].reverse().filter((l) => !q || (l.text + l.review + l.workOrder + l.actor).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card">
      <h2>Action log</h2>
      <div className="sub">Every decision the agent or a person made, in plain English. Nothing is hidden or edited afterwards.</div>
      <input className="ta" style={{ height: 36, marginBottom: 12 }} placeholder="Search (review id, work order, hotel, person…)" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows.length === 0 && <Empty title={q ? "No log entries match your search" : "The log is empty"} hint={q ? "Try another word." : "Entries appear as soon as the agent processes reviews."} />}
      <ol className="timeline">
        {rows.slice(0, 300).map((l, i) => {
          const { icon, tone } = logIcon(l);
          return (
            <li key={i} className={`tli ${tone}`}>
              <span className="tli-ico">{icon}</span>
              <div className="tli-body">
                <div>{l.text}</div>
                <div className="small">{fmtT(l.ts)} · {l.actor === "agent" ? "agent" : l.actor}{l.workOrder ? ` · ${l.workOrder}` : ""}{l.review ? ` · ${l.review}` : ""}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Weekly({ api, act, post, setMsg }: { api: Api; act: (f: () => Promise<unknown>) => void; post: (u: string, b: unknown) => Promise<unknown>; setMsg: (m: { ok: boolean; text: string }) => void }) {
  const [week, setWeek] = useState(api.weeks[api.weeks.length - 1] ?? "");
  const rows = week ? weekly(api.state, week, Object.keys(api.routing).sort()).filter((r) => r.reviews || r.openWorkOrders) : [];
  const maxIssues = Math.max(1, ...rows.map((r) => r.issueCount));
  const rateTone = (v: number | null) => (v === null ? "none" : v >= 4 ? "ok" : v >= 3 ? "warn" : "alert");
  return (
    <div className="card">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <h2>Weekly summary per hotel</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={week} onChange={(e) => setWeek(e.target.value)}>{api.weeks.map((w) => <option key={w} value={w}>Week of {w}</option>)}</select>
          <button className="btn" disabled={!week} onClick={() => act(async () => { const j = (await post("/api/weekly", { week, hotels: Object.keys(api.routing) })) as { queued: number }; setMsg({ ok: true, text: `${j.queued} weekly summaries queued to the GMs (see Outbox).` }); })}>Queue to GMs</button>
        </div>
      </div>
      {!week && <Empty title="No reviews loaded yet" hint="The weekly summary appears after the first reviews are analysed." />}
      {week && rows.length === 0 && <Empty title="Nothing to report for this week" />}
      {rows.length > 0 && (
        <div className="scroll"><table>
          <thead><tr><th>Hotel</th><th className="n">Reviews</th><th style={{ width: 190 }}>Average rating</th><th>Trend</th><th style={{ width: 170 }}>Issue reports</th><th>Top issues</th><th className="n" title="All work orders that are open today, whichever week they were created">Open WOs (all weeks, now)</th><th className="n" title="Open safety cases today">Safety open (now)</th><th className="n" title="Drafted replies still waiting for approval, for this week's reviews">Replies pending (this week)</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.hotel} title={weeklyText(r, week)}>
              <td><b>{r.hotel}</b></td><td className="n">{r.reviews}</td>
              <td>{r.avgRating === null ? "–" : <span className="meter"><span className="meter-track"><span className={`meter-fill ${rateTone(r.avgRating)}`} style={{ width: `${(r.avgRating / 5) * 100}%` }} /></span><b>{r.avgRating}</b>/5</span>}</td>
              <td className={r.avgRating === null || r.prevAvgRating === null ? "" : r.avgRating > r.prevAvgRating ? "t-ok" : r.avgRating < r.prevAvgRating ? "t-bad" : ""}>{r.avgRating === null || r.prevAvgRating === null ? "–" : r.avgRating > r.prevAvgRating ? "▲ better" : r.avgRating < r.prevAvgRating ? "▼ worse" : "= same"} <span className="small">(prev {r.prevAvgRating ?? "–"})</span></td>
              <td><span className="meter"><span className="meter-track"><span className="meter-fill none" style={{ width: `${(r.issueCount / maxIssues) * 100}%` }} /></span><b>{r.issueCount}</b></span></td>
              <td>{r.topIssues.map((i) => `${short(i.category)} (${i.count})`).join(", ") || "–"}</td>
              <td className="n">{r.openWorkOrders}</td><td className="n">{r.openSafety ? <b style={{ color: "var(--alert-fg)" }}>{r.openSafety}</b> : "–"}</td><td className="n">{r.pendingReplies}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
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
      <p className="small">Green ≥ 90 % (or no safety misses / false alarms), amber 75–90 %, red below. Reference labels were drafted with an AI assistant, so treat these figures as an estimate, not a guarantee.</p>
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
