import { actors, BUNDLED_BATCHES, loadState, routing } from "@/lib/pipeline";
import { MODEL, priceInfo } from "@/lib/llm";
import { weeksIn } from "@/lib/weekly";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const st = await loadState();
  const evalSummary = await fs.readFile(path.join(process.cwd(), "data", "eval.json"), "utf8").then(JSON.parse).catch(() => null);
  return Response.json(
    { state: st, routing: await routing(), actors: await actors(), bundled: BUNDLED_BATCHES, weeks: weeksIn(st), model: MODEL, price: priceInfo, evalSummary },
    { headers: { "Cache-Control": "no-store" } },
  );
}
