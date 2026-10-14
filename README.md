# Apex guest review agent (Task 3)

> Recruitment assignment prototype, independently developed for Apex Alliance Hotel Management. Not an official company system. Demo data only.

A web application that reads guest reviews, understands them with an AI model, creates work orders for technical problems, drafts replies in the guest's language, and releases a reply only after the hotel's general manager (GM) approves it.

- **Live:** https://apex-review-agent.vercel.app (view password is sent separately)
- The data is synthetic assignment data. Keep this repository private.
- E-mails, Teams messages and public replies are **simulated** in this demo (see the Outbox tab). Nothing is sent to real people.

## How it works

The steps are always the same, so the order, permissions and safety rules are plain code. The AI model is used only for language work: classifying a review, drafting the reply, and deciding whether two complaints describe the same fault. Every model answer is checked against a strict format before anything acts on it. The model cannot send, close or delete anything.

```
CSV file ──► collect (only review ids not seen before; cross-posted duplicates are linked)
         ──► remove contact data from the text
         ──► AI: language, sentiment, categories, urgency, safety type, reply draft
         ──► keyword safety check (runs separately, can only add an escalation)
         ──► work order created, or added to an open one for the same fault; routed to the right person
         ──► safety case? priority P1 and an urgent alert to chief engineer and GM
         ──► reply draft waits in the GM's list ──► GM approves, edits or rejects ──► released
every step is written to the action log in plain English
```

## Who may do what

- A reply is released only when **the GM of that hotel** approves it. The server checks this against the routing table.
- A safety work order can be closed only by the GM, and only with a note of what was checked or repaired.
- The agent never closes anything.
- **The identity in this demo is simulated.** The “Acting as” selector sends the e-mail address from the browser, so it shows the permission model but is not real sign-in. In production the identity would come from Microsoft Entra ID, verified on the server.
- A hotel user sees only that hotel's reviews, work orders, replies, outbox and log. HQ sees all hotels.

## Personal data

| Data | Sent to the AI | In work orders | Stored |
|---|---|---|---|
| Phone, e-mail, booking number | Never (removed first) | No | Removed before storing |
| Room number | Hidden as `[ROOM]` | Yes (engineers need it) | Yes |
| Reviewer first name | Yes, so the greeting has the correct grammar (for example the Lithuanian vocative) | No | Yes |
| Review text | After the removals above | A one-line summary | Yes |

Proposed retention: review text 90 days; the log longer. The OpenAI key stays on the server.

## Safety escalation

A case is escalated if **either the model or the keyword check** reports electrical danger, smoke or a fire-alarm problem, a person trapped or a lift stuck, or a water leak or flooding. The keyword check works in several languages and can only add escalations, never remove them. A smell of cigarette smoke, mold, a broken socket without sparks or a lift that is merely out of order are not escalated. The alerts say “possible …” because the guest report is not verified.

## Where things are

| File | What it does |
|---|---|
| `app/Agent.tsx` | The whole screen: Overview, Approvals, Work orders, Reviews, Outbox, Action log, Weekly, Quality & cost. |
| `app/page.tsx`, `app/layout.tsx`, `app/globals.css` | Page shell and styling. |
| `app/login/page.tsx`, `app/api/login/route.ts`, `proxy.ts`, `lib/gate.ts` | The password gate. |
| `app/api/state/route.ts` | Returns everything the screen needs. |
| `app/api/run/route.ts` | Loads a batch file and processes the queue. |
| `app/api/upload/route.ts` | Accepts a new reviews CSV. |
| `app/api/draft/route.ts` | A GM approves or rejects a reply. |
| `app/api/wo/route.ts` | Start or close a work order. |
| `app/api/weekly/route.ts` | Queues the weekly summaries for the GMs. |
| `app/api/export/route.ts` | Downloads the work orders as an Excel file. |
| `app/api/reset/route.ts` | Demo helper: deletes all agent data. Needs `ADMIN_PASSWORD`. |
| `lib/pipeline.ts` | **The workflow:** collecting, analysis results, work orders and grouping, escalation, approvals, closing rules, safe saving of the state. |
| `lib/llm.ts` | The AI request: instructions, the required answer format, and the check of the answer. |
| `lib/match.ts` | The AI question “is this the same fault as an open work order?”. |
| `lib/safety.ts` | The keyword safety check. |
| `lib/pii.ts` | Removal of personal data before storing and before the AI. |
| `lib/csv.ts` | Reads the reviews CSV. |
| `lib/weekly.ts` | Weekly summary figures (calculated, not written by AI). |
| `lib/store.ts` | Storage: private Vercel Blob, or a local folder. Writes are checked so two actions at the same time do not overwrite each other. |
| `lib/types.ts` | Shared types and the category list. |
| `data/batch_01.csv`, `data/batch_02.csv` | The sample reviews (80 and 20). |
| `data/routing.json` | Who is GM, chief engineer and housekeeping for each hotel (from the Routing sheet). |
| `data/gold.txt` | Reference labels for measuring quality. Drafted with an AI assistant, **not yet reviewed by a hotel specialist**. |
| `data/eval.json`, `eval-gpt-4.1-mini.md` | The latest quality results, shown in the app and as a full report. |
| `scripts/eval.ts` | Runs all sample reviews and compares them with the reference labels (`npm run eval`). |
| `scripts/greetings.ts` | Prints the greeting line of every drafted reply, to check name grammar by eye. |
| `scripts/smoke.ts` | Quick run on a few reviews. |
| `tests/pipeline.test.ts`, `tests/concurrency.test.ts` | Unit tests: personal data, safety, approval rights, grouping, duplicates, and parallel actions. |
| `.github/workflows/test.yml` | Type check and tests on every push. |

## Quality and cost

`npm run eval` processes the 100 sample reviews and compares them with the reference labels. Latest run (`eval-gpt-4.1-mini.md`): language 100 %, sentiment about 93–95 % exactly right (no positive/negative flips), category sets about 86–87 % exactly right (98–99 % if the vague “Front office / Service” and “Other” categories are ignored, i.e. the technical, housekeeping and F&B routing), safety cases 11 of 11 found with no false alarms, spam and the cross-posted duplicate found. Four runs of the same prompt varied by about one or two reviews.

Caveats: the reference labels were drafted with an AI assistant. The prompt was clarified (definition of “mixed” sentiment, noise from room units versus building equipment, when “Front office / Service” applies) after looking at the disagreements on these same 100 reviews, and the lift rule was tightened the same way, so the figures are optimistic and would need a fresh set to confirm. Before the clarifications the figures were sentiment 88 %, category sets 83 %. “Front office / Service” is the least consistent category, also in the reference labels.

Cost: about **$0.10 per 100 reviews** with gpt-4.1-mini (assumed price $0.40 / $1.60 per million tokens; check current pricing). For 18 hotels with an assumed 60 reviews per hotel per month, about $1 per month. Hosting is free at demo size.

## Settings (environment variables)

| Name | Purpose |
|---|---|
| `OPENAI_API_KEY` | Access to the AI model. |
| `OPENAI_MODEL`, `LLM_PRICE_IN`, `LLM_PRICE_OUT` | Optional: another model and its price per million tokens. |
| `DASH_PASSWORD` | Password to open the app. Not set = no password (local use). |
| `ADMIN_PASSWORD` | Password for the Reset button. |
| `BLOB_READ_WRITE_TOKEN` | Set by connecting a **private** Vercel Blob store. Without it, data is kept in `.local-store/`. |

## Run it yourself

```
npm install
# create .env.local with OPENAI_API_KEY=...  and  ADMIN_PASSWORD=...
npm run dev        # http://localhost:3000
npm test           # unit tests, no network needed
npm run eval       # quality and cost on the 100 sample reviews (needs the key)
```

## Demo steps

1. Press **Reset demo** (admin password), then **Load batch_01.csv**. About 80 reviews are analysed in under a minute.
2. Look at Overview, Approvals and Work orders: safety cases, grouped work orders, drafts in six languages.
3. Choose “Acting as” a GM (for example `gm.h01@apex-test.example`) and approve a reply. It appears in the Outbox.
4. Press **Load batch_02.csv**. Only the 20 new reviews are processed: one duplicate, one spam, repeat reports added to existing work orders, new safety cases escalated.
5. Open Weekly, Action log and Quality & cost.

## Limitations

- E-mails, Teams and public replies are simulated. Connecting Microsoft Graph, SMTP or the review platforms' APIs is the next step.
- The identity is simulated (see above).
- Reviews are loaded from files. A scheduled import from Booking, Google and TripAdvisor is not built.
- All data is one JSON file in storage. Every change reads the file, applies the change and saves it only if the file is unchanged since it was read (version check). If someone else saved first, the change is applied again to the newest data, with short random delays. So one save cannot silently overwrite another. Measured on the live site: 10 simultaneous updates all succeeded; with 30 simultaneous updates 26 succeeded and 4 were refused with a “busy” message, and the saved changes matched the successful ones exactly. There are no multi-record transactions. This is fine for hundreds of reviews and a few approvers; PostgreSQL would be the next step for thousands of reviews and many approvers.
- Replies in less common languages should be checked by the GM; the fallback is English. Greetings have not been checked by native speakers.
- If a guest mentions an earlier stay, the work order gets a “please verify” note. It is never suppressed.
