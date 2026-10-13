import { collect, loadState, saveState } from "@/lib/pipeline";
import { parseCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Upload a new reviews CSV (same columns as the sample files). Only unseen review ids are added. */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > 2 * 1024 * 1024) return Response.json({ error: "File too large (max 2 MB)" }, { status: 400 });
  const csv = await file.text();
  const rows = parseCsv(csv);
  const need = ["review_id", "received_at", "source", "hotel_id", "rating", "rating_scale", "title", "text"];
  const miss = need.filter((c) => !(rows[0] && c in rows[0]));
  if (!rows.length || miss.length) return Response.json({ error: `Not a valid reviews file${miss.length ? `: missing column(s) ${miss.join(", ")}` : ""}` }, { status: 422 });
  const st = await loadState();
  const collected = collect(st, csv, file.name);
  await saveState(st);
  return Response.json({ ok: true, collected });
}
