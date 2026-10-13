import { analyseQueue, applyResults, collect, loadState, readBundled, withState } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Collect (optionally from a named batch) and process queued reviews. Safe to call repeatedly: known review ids are skipped.
 * The slow part (AI calls) runs on a snapshot; the result is then applied to the freshest state under optimistic locking,
 * so an approval made in the meantime is never overwritten.
 */
export async function POST(req: Request) {
  try {
    const { batch } = (await req.json().catch(() => ({}))) as { batch?: string };
    let collected = null;
    if (batch) {
      const csv = await readBundled(batch);
      collected = await withState((st) => collect(st, csv, batch));
    }
    const results = await analyseQueue(await loadState(), 40, 8);
    const processed = await withState((st) => applyResults(st, results));
    return Response.json({ collected, processed });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
