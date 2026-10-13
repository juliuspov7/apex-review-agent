import { collect, loadState, processQueued, readBundled, saveState } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Collect (optionally from a named batch) and process queued reviews. Safe to call repeatedly: known review ids are skipped. */
export async function POST(req: Request) {
  try {
    const { batch } = (await req.json().catch(() => ({}))) as { batch?: string };
    const st = await loadState();
    let collected = null;
    if (batch) collected = collect(st, await readBundled(batch), batch);
    const processed = await processQueued(st, 40, 8);
    await saveState(st);
    return Response.json({ collected, processed });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
