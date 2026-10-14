import { decideDraft, withState } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { id, action, actor, text } = (await req.json()) as { id: string; action: "approve" | "reject"; actor: string; text?: string };
  try {
    await withState((st) => decideDraft(st, id, action, actor, text));
    return Response.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    return Response.json({ error: msg }, { status: /busy/.test(msg) ? 503 : 403 });
  }
}
