/**
 * Personal-data handling, done in plain code BEFORE any text reaches the model or is stored:
 *  - phone numbers, e-mail addresses, booking numbers/references are removed from the stored text and from model input
 *  - room numbers are extracted (needed by the engineer) and replaced by [ROOM] in model input
 *  - only the reviewer's FIRST name (public on the review site) is sent to the model, so the greeting is grammatically correct (e.g. Lithuanian vocative)
 */
export interface Scrubbed {
  stored: string; // contact data removed, room numbers kept (shown to GM / engineer)
  forModel: string; // additionally room numbers masked
  rooms: string[];
  removed: string[];
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<![\w])(?:\+|00)?\d[\d\s().-]{7,}\d(?![\w])/g;
const BOOKING = /(?:booking\s*(?:ref(?:erence)?|no\.?|number|nr\.?|id)?|ref(?:erence)?|reservation|rezerv\w*|buchung\w*|prenotazione)\s*[:#.]?\s*[A-Z0-9][A-Z0-9-]{5,}/gi;
const URL = /(?:https?:\/\/|www\.)\S+/gi;
const ROOM = /(?:room|camer[aă]|zimmer|pok[oó]j|kambar\w*|stanza|numer)\s*(?:no\.?|nr\.?|#)?\s*(\d{2,4})/gi;

export function scrub(text: string): Scrubbed {
  const removed = new Set<string>();
  let t = text;
  t = t.replace(EMAIL, () => (removed.add("email"), "[email removed]"));
  t = t.replace(BOOKING, () => (removed.add("booking number"), "[booking ref removed]"));
  t = t.replace(PHONE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return m;
    removed.add("phone");
    return "[phone removed]";
  });
  const rooms = new Set<string>();
  for (const m of t.matchAll(ROOM)) rooms.add(m[1]);
  return {
    stored: t,
    forModel: t.replace(URL, "[link]").replace(ROOM, (m, n) => m.replace(n, "[ROOM]")),
    rooms: [...rooms],
    removed: [...removed],
  };
}
