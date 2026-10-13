export const CATEGORIES = [
  "Technical – HVAC",
  "Technical – Water",
  "Technical – Electrical / Safety",
  "Technical – Lifts",
  "Technical – IT / TV / Wi-Fi",
  "Technical – Building",
  "Housekeeping",
  "F&B",
  "Front office / Service",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const isTechnical = (c: string) => c.startsWith("Technical");

export const SAFETY_TYPES = ["electrical", "smoke_fire", "lift_trapped", "water_leak", "none"] as const;
export type SafetyType = (typeof SAFETY_TYPES)[number];

export type Urgency = "low" | "medium" | "high" | "critical";
export type Sentiment = "positive" | "neutral" | "negative" | "mixed";

export interface Issue {
  category: Category;
  summary: string; // one sentence, English, no personal data
  urgency: Urgency;
  safety_type: SafetyType; // != "none" => safety-critical
}

export interface Analysis {
  language: string; // ISO 639-1
  sentiment: Sentiment;
  spam: boolean;
  refers_to_past_stay: boolean; // the problem described happened on an earlier stay, not the current/recent one
  issues: Issue[];
  reason: string; // plain-English explanation for the action log
  draft_reply: string | null; // in the review language, {{GUEST}} placeholder for the name
  /** safety flag raised by the keyword safety net (independent of the model) */
  net_safety: SafetyType | null;
  needs_human_review: boolean;
}

export interface Review {
  id: string;
  receivedAt: string;
  source: string;
  hotel: string;
  rating5: number | null; // normalised to 1-5
  ratingRaw: string;
  reviewer: string;
  title: string;
  text: string; // stored with contact data removed
  rooms: string[];
  pii: string[]; // what was removed, e.g. ["phone","email"]
  batch: string;
  status: "queued" | "processed" | "duplicate" | "spam" | "needs_review" | "error";
  attempts?: number;
  duplicateOf?: string;
  analysis?: Analysis;
  error?: string;
  workOrderIds: string[];
  draft?: Draft;
  processedAt: string;
}

export interface Draft {
  language: string;
  text: string; // with {{GUEST}} placeholder
  status: "pending" | "approved" | "rejected";
  editedText?: string;
  decidedBy?: string;
  decidedAt?: string;
  publishedAs?: string; // outbox id
}

export interface WorkOrder {
  id: string;
  hotel: string;
  category: Category;
  priority: "P1 safety" | "P2" | "P3";
  title: string;
  summary: string[]; // one line per reported occurrence
  rooms: string[];
  reviewIds: string[];
  assignedTo: string;
  safety: boolean;
  safetyType: SafetyType;
  status: "open" | "in_progress" | "closed";
  createdAt: string;
  updatedAt: string;
  closedBy?: string;
  closeNote?: string;
}

export interface OutboxItem {
  id: string;
  kind: "work_order" | "safety_escalation" | "reply" | "weekly";
  to: string[];
  subject: string;
  body: string;
  createdAt: string;
  related?: string;
}

export interface LogEntry {
  ts: string;
  actor: string; // "agent" or an e-mail
  review?: string;
  workOrder?: string;
  text: string; // plain English
}

export interface State {
  reviews: Record<string, Review>;
  workOrders: Record<string, WorkOrder>;
  outbox: OutboxItem[];
  log: LogEntry[];
  counters: { wo: number; msg: number };
  usage: { calls: number; inTokens: number; outTokens: number; costUsd: number; failures: number };
  batches: Record<string, { loadedAt: string; rows: number; newRows: number }>;
}

export const emptyState = (): State => ({
  reviews: {},
  workOrders: {},
  outbox: [],
  log: [],
  counters: { wo: 0, msg: 0 },
  usage: { calls: 0, inTokens: 0, outTokens: 0, costUsd: 0, failures: 0 },
  batches: {},
});
