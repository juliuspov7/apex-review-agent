import { loadState, saveState, updateWorkOrder } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { id, action, actor, note } = (await req.json()) as { id: string; action: "start" | "close"; actor: string; note?: string };
  try {
    const st = await loadState();
    await updateWorkOrder(st, id, action, actor, note);
    await saveState(st);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }
}
