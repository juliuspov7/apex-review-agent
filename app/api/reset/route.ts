import { timingSafeEqual } from "crypto";
import { saveState } from "@/lib/pipeline";
import { emptyState } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Demo helper: wipe all agent data so the demo can be rehearsed again. Protected by ADMIN_PASSWORD. */
export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const expected = process.env.ADMIN_PASSWORD;
  const a = Buffer.from(String(password ?? "")), b = Buffer.from(expected ?? "");
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "Wrong admin password" }, { status: 401 });
  await saveState(emptyState());
  return Response.json({ ok: true });
}
