// Measures classification quality against the hand-labelled set in data/gold.txt.
// Usage: node --env-file=.env.local scripts/eval.ts            (OPENAI_MODEL=... to compare models)
import { readFileSync, writeFileSync } from "node:fs";
import { collect, processQueued } from "../lib/pipeline.ts";
import { MODEL } from "../lib/llm.ts";
import { emptyState } from "../lib/types.ts";

const CODE: Record<string, string> = {
  HVAC: "Technical – HVAC", WATER: "Technical – Water", ELEC: "Technical – Electrical / Safety", LIFT: "Technical – Lifts",
  IT: "Technical – IT / TV / Wi-Fi", BLDG: "Technical – Building", HK: "Housekeeping", FB: "F&B", SVC: "Front office / Service", OTH: "Other",
};
interface Gold { lang: string; sent: string; cats: Set<string>; safety: boolean; spam: boolean; dup: string }
const gold = new Map<string, Gold>();
for (const line of readFileSync("data/gold.txt", "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [id, lang, sent, cats, safety, spam, dup] = line.split("|");
  gold.set(id, { lang, sent, cats: new Set(cats ? cats.split(",").map((c) => CODE[c]) : []), safety: safety === "1", spam: spam === "1", dup: dup ?? "" });
}

const st = emptyState();
collect(st, readFileSync("data/batch_01.csv", "utf8"), "batch_01.csv");
collect(st, readFileSync("data/batch_02.csv", "utf8"), "batch_02.csv");
const t0 = Date.now();
let rounds = 0;
while (rounds++ < 10) {
  const r = await processQueued(st, 100, 8);
  if (!r.remaining) break;
}
const secs = (Date.now() - t0) / 1000;

const rows = Object.values(st.reviews);
const analysed = rows.filter((r) => r.analysis && r.status !== "duplicate");
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}% (${a}/${b})` : "n/a");
const miss: string[] = [];

let lang = 0, sent = 0, polarity = 0, exact = 0, tp = 0, fp = 0, fn = 0, techOk = 0;
let sTP = 0, sFP = 0, sFN = 0, mTP = 0, mFP = 0, mFN = 0, nTP = 0, nFP = 0, nFN = 0;
let spTP = 0, spFP = 0, spFN = 0;
const isTech = (c: string) => c.startsWith("Technical") || c === "Housekeeping";
for (const r of analysed) {
  const g = gold.get(r.id)!;
  const a = r.analysis!;
  if (a.language === g.lang) lang++; else miss.push(`${r.id} language: got ${a.language}, expected ${g.lang}`);
  if (a.sentiment === g.sent) sent++; else miss.push(`${r.id} sentiment: got ${a.sentiment}, expected ${g.sent}`);
  const pol = (s: string) => (s === "positive" ? 1 : s === "negative" ? -1 : 0);
  if (!(pol(a.sentiment) * pol(g.sent) < 0)) polarity++;
  const got = new Set(a.issues.map((i) => i.category));
  const inter = [...got].filter((c) => g.cats.has(c)).length;
  tp += inter; fp += got.size - inter; fn += g.cats.size - inter;
  const same = got.size === g.cats.size && inter === got.size;
  if (same) exact++; else miss.push(`${r.id} categories: got [${[...got].join("; ")}], expected [${[...g.cats].join("; ")}]`);
  if ([...got].some(isTech) === [...g.cats].some(isTech)) techOk++;
  // safety: final decision = model OR net
  const modelSafe = a.issues.some((i) => i.safety_type !== "none");
  const netSafe = !!a.net_safety;
  const finalSafe = modelSafe || netSafe;
  const cnt = (pred: boolean, tpv: () => void, fpv: () => void, fnv: () => void) => { if (pred && g.safety) tpv(); else if (pred) fpv(); else if (g.safety) fnv(); };
  cnt(finalSafe, () => sTP++, () => sFP++, () => sFN++);
  cnt(modelSafe, () => mTP++, () => mFP++, () => mFN++);
  cnt(netSafe, () => nTP++, () => nFP++, () => nFN++);
  if (finalSafe !== g.safety) miss.push(`${r.id} SAFETY: escalated=${finalSafe} (model=${modelSafe}, net=${a.net_safety ?? "-"}), expected ${g.safety}`);
  if (a.spam && g.spam) spTP++; else if (a.spam) spFP++; else if (g.spam) spFN++;
}
const dupGold = [...gold.entries()].filter(([, g]) => g.dup);
const dupOk = dupGold.filter(([id, g]) => st.reviews[id]?.duplicateOf === g.dup).length;
const falseDup = rows.filter((r) => r.status === "duplicate" && !gold.get(r.id)?.dup).length;
const f1 = (p: number, r: number) => (p + r ? ((2 * p * r) / (p + r)).toFixed(3) : "n/a");
const P = (a: number, b: number) => (a + b ? a / (a + b) : 0);

const woOpen = Object.values(st.workOrders);
const lines = [
  `# Evaluation – model ${MODEL}`,
  `Reviews: ${rows.length} total, ${analysed.length} analysed by the model, ${rows.filter((r) => r.status === "duplicate").length} duplicate, errors: ${rows.filter((r) => r.status === "error").length}. Run time ${secs.toFixed(0)} s.`,
  ``,
  `| Metric | Result |`,
  `|---|---|`,
  `| Language | ${pct(lang, analysed.length)} |`,
  `| Sentiment exact | ${pct(sent, analysed.length)} |`,
  `| Sentiment, no positive<->negative flips | ${pct(polarity, analysed.length)} |`,
  `| Category sets exactly right | ${pct(exact, analysed.length)} |`,
  `| Category precision / recall / F1 | ${P(tp, fp).toFixed(3)} / ${P(tp, fn).toFixed(3)} / ${f1(P(tp, fp), P(tp, fn))} |`,
  `| Technical-or-housekeeping routing correct (work order needed yes/no) | ${pct(techOk, analysed.length)} |`,
  `| Safety escalation (model OR keyword net): TP / FP / FN | ${sTP} / ${sFP} / ${sFN}  (recall ${P(sTP, sFN).toFixed(2)}, precision ${P(sTP, sFP).toFixed(2)}) |`,
  `| Safety by model alone: TP / FP / FN | ${mTP} / ${mFP} / ${mFN} |`,
  `| Safety by keyword net alone: TP / FP / FN | ${nTP} / ${nFP} / ${nFN} |`,
  `| Spam: TP / FP / FN | ${spTP} / ${spFP} / ${spFN} |`,
  `| Cross-posted duplicates found | ${dupOk}/${dupGold.length}, false duplicates ${falseDup} |`,
  `| Work orders created | ${woOpen.length} (from ${woOpen.reduce((s, w) => s + w.reviewIds.length, 0)} issue reports, ${woOpen.filter((w) => w.reviewIds.length > 1).length} grouped, ${woOpen.filter((w) => w.safety).length} safety) |`,
  `| Tokens in / out, cost | ${st.usage.inTokens} / ${st.usage.outTokens}, $${st.usage.costUsd.toFixed(4)} for ${st.usage.calls} calls (≈ $${((st.usage.costUsd / Math.max(1, analysed.length)) * 100).toFixed(3)} per 100 reviews) |`,
  ``,
  `## Disagreements with the reference labels`,
  ...miss.map((m) => `- ${m}`),
];
writeFileSync(`eval-${MODEL}.md`, lines.join("\n"));
console.log(lines.join("\n"));
if (!process.env.NO_SUMMARY) writeFileSync("data/eval.json", JSON.stringify({ model: MODEL, lines: lines.slice(1, lines.indexOf("## Disagreements with the reference labels") - 1) }, null, 1));
