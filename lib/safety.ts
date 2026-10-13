import type { SafetyType } from "./types.ts";

/**
 * Safety net: deterministic multilingual keyword check that runs next to the model.
 * A case is escalated if EITHER the model OR this net says "safety". It only adds escalations, never removes them.
 * Deliberately NOT matching plain "smell of smoke" (cigarette smoke in a non-smoking room is a housekeeping issue).
 */
const RULES: [SafetyType, RegExp][] = [
  ["electrical", /(electric(al)? shock|șoc electric|curent electric|stromschlag|elektroschock|iskrz|sparking|sparks?\b|funken|scosse? elettric|loses? kabel|exposed (wire|cable)|lebensgefähr|spalenizn|burnt plastic|plastic ars|brandgeruch|burning smell|odore di bruciato)/i],
  ["smoke_fire", /(fire alarm|smoke alarm|smoke detector|incendiu|brandmelder|feueralarm|pożar|gaisro signaliz|allarme antincendio)/i],
  ["lift_trapped", /((lift|elevator|liftul|aufzug|ascensore|liftas)\W[^.]{0,30}(got stuck|is stuck|was stuck|s-a blocat|blocat din nou|steckengeblieben|si è bloccato|sustojo)|trapped in (the )?(lift|elevator)|stuck (in|between) (the )?(lift|elevator|floors)|įstrig|blocați în lift|între etaje|tra i piani|between floors|zwischen den (etagen|stockwerken))/i],
  ["water_leak", /(water (from|through|coming|dripping)[^.]{0,20}(ceiling|roof)|apă din tavan|a curs apă|infiltra[tț]ii|woda z sufitu|z sufitu|flood(ed|ing)?\b|inundați|überschwemm|allagat)/i],
];

export function safetyNet(text: string): SafetyType | null {
  for (const [type, re] of RULES) if (re.test(text)) return type;
  return null;
}
