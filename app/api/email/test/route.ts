import { loadState, withState } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

const MAX_PER_HOUR = 10;
const MARK = "TEST E-MAIL";

/** Recipients allowed for test sends (comma separated env; "*" = any single valid address). Resend's sandbox sender only delivers to the account owner anyway. */
const allowed = () => (process.env.TEST_EMAIL_ALLOWLIST ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Demo only: sends ONE outbox message to a test address through Resend. The real recipients (GM, engineer, guest)
 * are never contacted. Guards: allow-list of test recipients, rate limit, and only messages that are already in the
 * outbox (a reply gets there only after the GM approved it).
 */
export async function POST(req: Request) {
  const { id, to } = (await req.json()) as { id?: string; to?: string };
  const key = process.env.RESEND_API_KEY;
  if (!key) return Response.json({ error: "E-mail sending is not configured (RESEND_API_KEY)." }, { status: 503 });
  const rcpt = (to ?? "").trim().toLowerCase();
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(rcpt)) return Response.json({ error: "Enter one valid e-mail address." }, { status: 400 });
  if (!allowed().includes("*") && !allowed().includes(rcpt)) return Response.json({ error: "This address is not on the list of allowed test recipients." }, { status: 403 });

  const st = await loadState();
  const m = st.outbox.find((o) => o.id === id);
  if (!m) return Response.json({ error: "Message not found." }, { status: 404 });
  if (m.kind === "reply" && !Object.values(st.reviews).some((r) => r.draft?.status === "approved" && r.draft.publishedAs === m.id)) return Response.json({ error: "Only replies approved by a GM can be sent." }, { status: 409 });
  const hourAgo = Date.now() - 3600_000;
  if (st.log.filter((l) => l.text.startsWith(MARK) && Date.parse(l.ts) > hourAgo).length >= MAX_PER_HOUR) return Response.json({ error: "Too many test e-mails in the last hour. Try again later." }, { status: 429 });

  const note = `[TEST – demo of the Apex review agent. Intended recipients: ${m.to.join(", ")}. Nobody else was contacted.]\n\n`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ from: process.env.RESEND_FROM || "Apex review agent (demo) <onboarding@resend.dev>", to: [rcpt], subject: `[TEST] ${m.subject}`, text: note + m.body }),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  const ok = res.ok;
  await withState((s) => {
    s.log.push({ ts: new Date().toISOString(), actor: "hq", text: `${MARK} ${ok ? "sent" : "failed"}: ${m.id} (${m.kind}) to ${rcpt}${ok ? "" : ` – ${j.message ?? res.status}`}` });
  });
  if (!ok) return Response.json({ error: `Resend refused the message: ${j.message ?? res.status}` }, { status: 502 });
  return Response.json({ ok: true, id: j.id });
}
