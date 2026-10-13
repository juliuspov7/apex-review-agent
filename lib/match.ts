import { MODEL, priceInfo } from "./llm.ts";

/**
 * Grouping helper: is this complaint the SAME concrete problem as one of the already open work orders
 * (same hotel, same category)? Returns the matching work-order id or null.
 * Any failure = null, i.e. a separate work order (the safe default: nothing gets hidden inside another order).
 */
export async function matchWorkOrder(
  summary: string,
  candidates: { id: string; lines: string[] }[],
): Promise<{ id: string | null; inTokens: number; outTokens: number; costUsd: number }> {
  const none = { id: null, inTokens: 0, outTokens: 0, costUsd: 0 };
  if (!candidates.length || !process.env.OPENAI_API_KEY) return none;
  const ids = candidates.map((c) => c.id);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: MODEL,
        ...(/^gpt-4/.test(MODEL) ? { temperature: 0 } : {}),
        messages: [
          {
            role: "system",
            content:
              "You group maintenance complaints. Decide whether a NEW guest complaint describes the SAME concrete fault (same equipment or same kind of failure, e.g. another guest reporting the same broken lift, or no hot water again) as one of the OPEN work orders of the same hotel. Different faults in the same area (e.g. a cold radiator vs. noisy ventilation, or weak Wi-Fi vs. a broken TV remote) are DIFFERENT. Answer with the work-order id or null.",
          },
          { role: "user", content: `NEW complaint: ${summary}\n\nOPEN work orders:\n${candidates.map((c) => `${c.id}: ${c.lines.join(" | ")}`).join("\n")}` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "match",
            strict: true,
            schema: { type: "object", additionalProperties: false, required: ["match"], properties: { match: { anyOf: [{ type: "string", enum: ids }, { type: "null" }] } } },
          },
        },
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message ?? "error");
    const m = JSON.parse(j.choices[0].message.content).match;
    const inT = j.usage?.prompt_tokens ?? 0;
    const outT = j.usage?.completion_tokens ?? 0;
    return { id: ids.includes(m) ? m : null, inTokens: inT, outTokens: outT, costUsd: (inT * priceInfo.usdPerMIn + outT * priceInfo.usdPerMOut) / 1e6 };
  } catch {
    return none;
  }
}
