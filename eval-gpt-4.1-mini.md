# Evaluation – model gpt-4.1-mini
Reviews: 100 total, 99 analysed by the model, 1 duplicate, errors: 0. Run time 35 s.

| Metric | Result |
|---|---|
| Language | 100.0% (99/99) |
| Sentiment exact | 93.9% (93/99) |
| Sentiment, no positive<->negative flips | 100.0% (99/99) |
| Category sets exactly right | 86.9% (86/99) |
| …ignoring “Front office / Service” and “Other” (the technical, housekeeping and F&B routing) | 99.0% (98/99) |
| Category precision / recall / F1 | 0.902 / 0.954 / 0.927 |
| Technical-or-housekeeping routing correct (work order needed yes/no) | 100.0% (99/99) |
| Safety escalation (model OR keyword net): TP / FP / FN | 11 / 0 / 0  (recall 1.00, precision 1.00) |
| Safety by model alone: TP / FP / FN | 11 / 0 / 0 |
| Safety by keyword net alone: TP / FP / FN | 11 / 0 / 0 |
| Spam: TP / FP / FN | 1 / 0 / 0 |
| Cross-posted duplicates found | 1/1, false duplicates 0 |
| Work orders created | 66 (from 73 issue reports, 6 grouped, 11 safety) |
| Tokens in / out, cost | 157543 / 20943, $0.0965 for 120 calls (≈ $0.098 per 100 reviews) |

## Disagreements with the reference labels
- RV-0001 categories: got [Technical – HVAC], expected [Technical – HVAC; Front office / Service]
- RV-0005 sentiment: got mixed, expected positive
- RV-0011 categories: got [Technical – IT / TV / Wi-Fi], expected [Technical – IT / TV / Wi-Fi; Front office / Service]
- RV-0012 categories: got [Technical – Water; Front office / Service], expected [Technical – Water]
- RV-0033 categories: got [Housekeeping; Front office / Service], expected [Housekeeping]
- RV-0041 sentiment: got mixed, expected positive
- RV-0046 categories: got [Technical – Water; Front office / Service], expected [Technical – Water]
- RV-0055 categories: got [Technical – Lifts; Technical – HVAC; Front office / Service], expected [Technical – Lifts; Technical – HVAC]
- RV-0071 sentiment: got negative, expected mixed
- RV-0071 categories: got [Technical – Building; Front office / Service], expected [Technical – Building]
- RV-0077 categories: got [Technical – Electrical / Safety; Front office / Service], expected [Technical – Electrical / Safety]
- RV-0078 categories: got [Technical – Water; Technical – Building], expected [Technical – Water]
- RV-0081 categories: got [Technical – Lifts; Front office / Service], expected [Technical – Lifts]
- RV-0084 categories: got [Technical – IT / TV / Wi-Fi], expected [Technical – IT / TV / Wi-Fi; Front office / Service]
- RV-0091 sentiment: got mixed, expected positive
- RV-0093 sentiment: got negative, expected mixed
- RV-0093 categories: got [Other; Technical – Building], expected [Technical – Building]
- RV-0098 sentiment: got neutral, expected negative
- RV-0098 categories: got [], expected [Other]