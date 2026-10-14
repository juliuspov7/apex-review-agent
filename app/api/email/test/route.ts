import { loadState, withState } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

const MAX_PER_HOUR = 10;
const MARK = "TEST E-MAIL";
const STALE_MS = 2 * 60_000; // a "sending" entry older than this is treated as a crashed attempt

/** Recipients allowed for test sends (comma separated env; "*" = any single valid address). */
const allowed = () => (process.env.TEST_EMAIL_ALLOWLIST ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Demo only: sends ONE outbox message to a test address through Resend. The real recipients (GM, engineer, guest)
 * are never contacted. Guards: allow-list, only messages already in the outbox (a reply gets there only after the GM
 * approved it), a rate limit and a duplicate check. The rate limit and the duplicate check are reserved atomically in
 * the saved state (withState) BEFORE sending, so parallel requests cannot all pass; Resend also gets an idempotency key.
 */
export async function POST(req: Request) {
  const { id, to } = (await req.json()) as { id?: string; to?: string };
  const key = process.env.RESEND_API_KEY;
  if (!key) return Response.json({ error: "E-mail sending is not configured (RESEND_API_KEY)." }, { status: 503 });
  const rcpt = (to ?? "").trim().toLowerCase();
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(rcpt)) return Response.json({ error: "Enter one valid e-mail address." }, { status: 400 });
  if (!allowed().includes("*") && !allowed().includes(rcpt)) return Response.json({ error: "This address is not on the list of allowed test recipients." }, { status: 403 });

  const st0 = await loadState();
  const m = st0.outbox.find((o) => o.id === id);
  if (!m) return Response.json({ error: "Message not found." }, { status: 404 });

  const tag = `${m.id} to ${rcpt}`;
  const attempt = Date.now(); // unique per send, so the idempotency key is not reused after a demo reset
  const reserved = await withState((st) => {
    const msg = st.outbox.find((o) => o.id === id);
    if (!msg) return { error: "Message not found.", status: 404 };
    if (msg.kind === "reply" && !Object.values(st.reviews).some((r) => r.draft?.status === "approved" && r.draft.publishedAs === msg.id)) return { error: "Only replies approved by a GM can be sent.", status: 409 };
    const now = Date.now();
    const mine = st.log.filter((l) => l.text.startsWith(MARK));
    if (mine.filter((l) => l.text.startsWith(`${MARK} sending`) && Date.parse(l.ts) > now - 3600_000).length >= MAX_PER_HOUR) return { error: "Too many test e-mails in the last hour. Try again later.", status: 429 };
    const last = [...mine].reverse().find((l) => l.text.endsWith(tag) || l.text.includes(`${tag} `));
    if (last) {
      const sent = last.text.startsWith(`${MARK} sent`);
      const inFlight = last.text.startsWith(`${MARK} sending`) && Date.parse(last.ts) > now - STALE_MS;
      if (sent || inFlight) return { error: sent ? `Already sent: ${msg.id} was e-mailed to ${rcpt}.` : "This e-mail is being sent right now.", status: 409 };
    }
    st.log.push({ ts: new Date().toISOString(), actor: "hq", text: `${MARK} sending: ${tag}` });
    return { msg };
  });
  if ("error" in reserved) return Response.json({ error: reserved.error }, { status: reserved.status });

  const note = `[TEST – demo of the Apex review agent. Intended recipients: ${m.to.join(", ")}. Nobody else was contacted.]\n\n`;
  let ok = false;
  let detail = "";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `apex-test-${m.id}-${rcpt}-${attempt}` },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ from: process.env.RESEND_FROM || "Apex review agent (demo) <onboarding@resend.dev>", to: [rcpt], subject: `[TEST] ${m.subject}`, text: note + m.body }),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    ok = res.ok;
    detail = ok ? "" : ` – ${j.message ?? res.status}`;
  } catch (e) {
    detail = ` – ${(e as Error).message}`;
  }
  await withState((s) => {
    s.log.push({ ts: new Date().toISOString(), actor: "hq", text: `${MARK} ${ok ? "sent" : "failed"}: ${tag}${detail}` });
  });
  if (!ok) return Response.json({ error: `Sending failed${detail}` }, { status: 502 });
  return Response.json({ ok: true });
}
