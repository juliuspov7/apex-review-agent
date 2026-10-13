# Apex guest review agent (Task 3)

Collects guest reviews, classifies them with an AI model, turns technical complaints into routed work orders, drafts replies in the guest's language and releases them only after the hotel GM approves. Anonymised / synthetic assignment data: keep this repository private.

Live demo: https://apex-review-agent.vercel.app (view password supplied separately).

## Design choice: fixed workflow with AI steps, not a free-roaming agent
The steps are always the same, so the order, the permissions and the safety rules live in plain code. The model is used only where language understanding is needed (classify + draft reply, and "is this the same fault as an open work order?"). Every model answer is validated against a strict schema before anything acts on it. The model cannot send, close or delete anything.

```
CSV batch → collect (only unseen review ids; cross-posts linked) → remove contact data
  → AI: language, sentiment, categories, urgency, safety type, reply draft (one call per review)
  → keyword safety net (runs in parallel, can only ADD an escalation)
  → work order created or ADDED to an open one (AI-assisted matching), routed from the Routing sheet
  → safety? P1 + urgent alert to chief engineer and GM (simulated outbox in this demo)
  → reply draft waits in the GM queue → GM approves / edits / rejects → released (simulated outbox)
  → weekly summary per hotel (plain calculation, no AI)
  every step → action log in plain English
```

## Human in the loop
- No reply is released without the approval of **that hotel's GM**. The server checks the approver against the Routing sheet, but in this demo the identity itself is **simulated**: the "Acting as" selector sends the e-mail from the browser, so anyone who can reach the app could claim to be a GM. It is a demonstration of the permission model, not authentication.
- Safety work orders can only be closed by the GM and need a note. The agent never closes anything.
- In a real roll-out the identity comes from Microsoft Entra sign-in and is read from the verified token on the server (groups: GM per hotel, chief engineer per hotel, HQ read-only); the client never states who it is.

## Personal data
| Data | Model | Work order | Stored |
|---|---|---|---|
| Phone, e-mail, booking number | never sent (removed first) | no | removed before storing |
| Room number | masked as `[ROOM]` | yes (engineer needs it) | yes |
| Reviewer name | first name only (public on the review site), so the greeting is grammatically correct (e.g. Lithuanian vocative) | no | yes |
| Review text | yes, after removal | summary only | yes |
Retention proposal: 90 days for review text, work orders and log kept longer. The API key stays on the server.

## Safety escalation
Escalate if the model **or** a multilingual keyword check says: electrical hazard, smoke / fire alarm, person trapped or lift stuck, water leak / flooding. Cigarette-smoke smell, mold, a broken socket without sparks or a lift merely out of order are not escalated.

## Quality, measured
`npm run eval` runs all 100 sample reviews and compares them with labels I wrote by hand (`data/gold.txt`). Results and the full list of disagreements are in `eval-gpt-4.1-mini.md`. Honest caveats: the reference labels are mine (should be reviewed by hotel operations), the safety rules for "lift stuck" were tightened after the first run on the same data, and "Front office / Service" is the least consistent category in both the labels and the model.

## Cost
Measured: about **$0.08 per 100 reviews** with gpt-4.1-mini (assumed price $0.40 / $1.60 per million tokens; check current pricing, change with `OPENAI_MODEL`, `LLM_PRICE_IN`, `LLM_PRICE_OUT`). For 18 hotels, assuming about 60 reviews per hotel per month (~1,100 reviews): roughly **$1 per month** AI cost; Vercel and Blob are within free tiers at this size.

## Run
```
npm install
# .env.local: OPENAI_API_KEY=...  ADMIN_PASSWORD=...  (DASH_PASSWORD optional: view gate)
npm run dev        # http://localhost:3000
npm test           # unit tests, no network
npm run eval       # quality + cost on the 100 sample reviews (needs the API key)
```
Env vars on Vercel: `OPENAI_API_KEY`, `DASH_PASSWORD`, `ADMIN_PASSWORD` (reset button), `BLOB_READ_WRITE_TOKEN` (private Blob store holds `agent/state.json`).

## Demo script
1. Reset (admin password), load `batch_01.csv` → 80 reviews analysed in about 25 s.
2. Overview / Approvals / Work orders: safety banner, grouped work orders, drafts in six languages.
3. Acting as `gm.h01@apex-test.example` → approve a reply → Outbox shows the released text.
4. Load `batch_02.csv` → only the 20 new reviews are processed; one duplicate, one spam, repeat lift reports are added to existing work orders, new safety cases escalate.
5. Quality & cost tab, Action log, Weekly tab.

## Known limitations
- E-mails, Teams and public replies are simulated (outbox); connecting Graph / SMTP / platform APIs is the next step.
- State is one JSON document in Blob. Writes use an ETag check (optimistic locking) and are retried on conflict, so an approval made while a batch is being processed is not lost. This is fine for hundreds of reviews; a database (Postgres) is the next step for thousands and for several simultaneous approvers.
- Reviews are loaded from files; a scheduled import from the platforms' APIs is not built.
- Language support depends on the model; replies in rarer languages should be checked by the GM (fallback English).
- If a guest mentions an earlier stay, the work order gets a "please verify" note; it is never suppressed.
