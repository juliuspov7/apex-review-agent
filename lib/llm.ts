import { CATEGORIES, SAFETY_TYPES, type Analysis, type Category, type Issue, type SafetyType, type Sentiment, type Urgency } from "./types.ts";

export const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
// USD per 1M tokens. Default = gpt-4.1-mini list price; override with LLM_PRICE_IN / LLM_PRICE_OUT when using another model.
const PRICE_IN = Number(process.env.LLM_PRICE_IN ?? 0.4);
const PRICE_OUT = Number(process.env.LLM_PRICE_OUT ?? 1.6);

const SYSTEM = `You process guest reviews for a hotel group. You receive ONE review (already stripped of contact data; room numbers appear as [ROOM]).
Return a JSON object matching the schema. Rules:

LANGUAGE: ISO 639-1 code of the review text (en, lt, lv, et, ro, pl, de, it ...).
SENTIMENT: positive | negative | neutral | mixed (praise and complaints together = mixed).
SPAM: true only for ads/promotions/links unrelated to a stay, or obviously fake content. A harsh but genuine review is NOT spam.
REFERS_TO_PAST_STAY: true ONLY if the problem described did not occur during the stay this review is about, e.g. "in January our room was cold" or "in July the AC did not work". If the guest says the problem happened (again) during this stay, or is still happening, it is false even when they also mention an earlier visit.

ISSUES: one entry per DISTINCT problem the guest complains about (suggestions and mild remarks count). Praise is not an issue. Use exactly these categories:
- "Technical – HVAC": AC, heating, ventilation, room temperature, noisy AC/ventilation, pool/spa heating
- "Technical – Water": hot water, water pressure, leaks, drains, blocked or dripping shower/toilet, sewage smell
- "Technical – Electrical / Safety": sockets, cables, lights, electric shock, burning smell, fire alarm
- "Technical – Lifts": elevator out of order, slow, stuck
- "Technical – IT / TV / Wi-Fi": Wi-Fi, TV, remote, key cards, door card readers, parking barrier
- "Technical – Building": windows, doors, locks, mold, noise from equipment or thin walls, building defects, poor insulation
- "Housekeeping": cleanliness, linen, towels, pests, smell of smoke or dirt in room
- "F&B": breakfast, restaurant, bar, coffee machine
- "Front office / Service": check-in, staff behaviour, waiting, parking price, lack of apology, no reaction to a complaint
- "Other": location, external noise (e.g. construction next door), spam, anything else
A guest who also says nobody reacted may add a "Front office / Service" issue only if the lack of service is a clear complaint of its own.
Each issue: summary = one short English sentence without personal data; urgency = low | medium | high | critical.
SAFETY_TYPE per issue (strict): "electrical" = electric shock, sparking, exposed or loose cables, burning smell from sockets; "smoke_fire" = smoke, fire, fire-alarm activation or malfunction; "lift_trapped" = people trapped, or a lift that got stuck/blocked or stopped between floors (even if the guest does not say whether anyone was inside – err on the side of escalating); "water_leak" = active water leak/flooding from ceiling, pipes or toilet; otherwise "none". A broken socket without sparks, a smell of cigarette smoke, mold, a slow drain or an out-of-order lift without trapped people are NOT safety-critical ("none"). Any safety-critical issue has urgency "critical".

DRAFT_REPLY: a reply to the guest, in the SAME language as the review, 50-110 words, warm and professional, starting with a greeting. The user message gives the guest's FIRST NAME (public on the review site). Address the guest by it in the grammatically correct form of the reply language, including case and gender agreement: e.g. Lithuanian vocative with matching gender ("Gerbiama Ieva,", "Gerbiamas Tomai,", "Gerbiama Rasa,"), Polish ("Szanowny Panie Marku,", "Szanowna Pani Katarzyno,"), Latvian/Estonian vocative or nominative as correct, Romanian ("Stimată Elena,", "Stimate Andrei,"), German ("Liebe Frau ..." is NOT allowed without a surname, use "Guten Tag Klaus,"), Italian ("Gentile Giulia,"), English ("Dear Anna,"). Lithuanian vocative endings: -as→-ai (Tomas→Tomai, Mantas→Mantai), -is→-i, -ys→-y, -us→-au (Darius→Dariau), feminine -ė→-e (Eglė→Egle, Gintarė→Gintare), feminine -a/-ia unchanged (Rasa, Ieva, Monika, Laima). If you are not sure of the gender or the correct form of the name, use a neutral greeting WITHOUT the name (Lithuanian "Sveiki,", Polish "Dzień dobry,", Romanian "Bună ziua,", German "Guten Tag,", Italian "Buongiorno,", English "Hello,"). Never use a grammatically wrong form such as a nominative name after "Gerbiamas" for a woman. Thank them; acknowledge the specific problems concretely; say the matter has been passed to the right team; for safety issues say it is being treated as an urgent priority. NEVER promise compensation, refunds or specific fix times, never admit legal liability, never include phone numbers, e-mails or booking numbers, never invent facts, never blame the guest. For positive reviews thank them and invite them back. If the review is spam, set draft_reply to null.
Use the language of the review; if you cannot write it well, use English.

REASON: 1-2 plain English sentences for a non-technical manager explaining what you decided and why.`;

const issueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["category", "summary", "urgency", "safety_type"],
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    summary: { type: "string" },
    urgency: { type: "string", enum: ["low", "medium", "high", "critical"] },
    safety_type: { type: "string", enum: [...SAFETY_TYPES] },
  },
};
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["language", "sentiment", "spam", "refers_to_past_stay", "issues", "reason", "draft_reply"],
  properties: {
    language: { type: "string" },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative", "mixed"] },
    spam: { type: "boolean" },
    refers_to_past_stay: { type: "boolean" },
    issues: { type: "array", items: issueSchema },
    reason: { type: "string" },
    draft_reply: { type: ["string", "null"] },
  },
};

export interface LlmResult {
  analysis: Omit<Analysis, "net_safety" | "needs_human_review">;
  inTokens: number;
  outTokens: number;
  costUsd: number;
}

/** Strictly validate the model output before anything acts on it. */
export function validate(x: unknown): LlmResult["analysis"] {
  const o = x as Record<string, unknown>;
  const bad = (m: string): never => { throw new Error(`invalid model output: ${m}`); };
  if (!o || typeof o !== "object") bad("not an object");
  if (typeof o.language !== "string" || !/^[a-z]{2,3}$/i.test(o.language)) bad("language");
  if (!["positive", "neutral", "negative", "mixed"].includes(o.sentiment as string)) bad("sentiment");
  if (typeof o.spam !== "boolean") bad("spam");
  if (typeof o.refers_to_past_stay !== "boolean") bad("refers_to_past_stay");
  if (!Array.isArray(o.issues)) bad("issues");
  const issues: Issue[] = (o.issues as Record<string, unknown>[]).map((i) => {
    if (!(CATEGORIES as readonly string[]).includes(i.category as string)) bad(`category ${String(i.category)}`);
    if (!["low", "medium", "high", "critical"].includes(i.urgency as string)) bad("urgency");
    if (!(SAFETY_TYPES as readonly string[]).includes(i.safety_type as string)) bad("safety_type");
    return {
      category: i.category as Category,
      summary: String(i.summary ?? "").slice(0, 300),
      urgency: i.urgency as Urgency,
      safety_type: i.safety_type as SafetyType,
    };
  });
  const draft = o.draft_reply === null || o.draft_reply === undefined ? null : String(o.draft_reply);
  if (!o.spam && !draft) bad("missing draft_reply");
  return {
    language: (o.language as string).toLowerCase(),
    sentiment: o.sentiment as Sentiment,
    spam: o.spam as boolean,
    refers_to_past_stay: o.refers_to_past_stay as boolean,
    issues,
    reason: String(o.reason ?? "").slice(0, 500),
    draft_reply: draft,
  };
}

async function call(text: string, firstName: string, extra: Record<string, unknown>) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Guest first name: ${firstName || "(unknown)"}\nReview text (title and body):\n"""\n${text}\n"""` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "review_analysis", strict: true, schema } },
      ...extra,
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${j?.error?.message ?? "error"}`.replace(/sk-[\w-]+/g, "sk-…"));
  return j;
}

/** One model call per review; one retry on invalid output or transient error. */
export async function analyse(textForModel: string, firstName = ""): Promise<LlmResult> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const extra: Record<string, unknown> = /^gpt-4/.test(MODEL) ? { temperature: 0 } : {};
  let inT = 0, outT = 0, lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await call(textForModel, firstName, extra);
      inT += j.usage?.prompt_tokens ?? 0;
      outT += j.usage?.completion_tokens ?? 0;
      const analysis = validate(JSON.parse(j.choices[0].message.content));
      return { analysis, inTokens: inT, outTokens: outT, costUsd: (inT * PRICE_IN + outT * PRICE_OUT) / 1e6 };
    } catch (e) {
      lastErr = e;
    }
  }
  const err = new Error((lastErr as Error).message) as Error & { inTokens?: number; outTokens?: number };
  err.inTokens = inT;
  err.outTokens = outT;
  throw err;
}

export const priceInfo = { model: MODEL, usdPerMIn: PRICE_IN, usdPerMOut: PRICE_OUT };
