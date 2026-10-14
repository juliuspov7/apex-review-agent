import { updateWorkOrder, withState } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { id, action, actor, note } = (await req.json()) as { id: string; action: "start" | "close"; actor: string; note?: string };
  try {
    await withState((st) => updateWorkOrder(st, id, action, actor, note));
    return Response.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    return Response.json({ error: msg }, { status: /busy/.test(msg) ? 503 : 403 });
  }
}
