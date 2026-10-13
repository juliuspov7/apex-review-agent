# Evaluation – model gpt-4.1-mini
Reviews: 100 total, 99 analysed by the model, 1 duplicate, errors: 0. Run time 40 s.

| Metric | Result |
|---|---|
| Language | 100.0% (99/99) |
| Sentiment exact | 87.9% (87/99) |
| Sentiment, no positive<->negative flips | 100.0% (99/99) |
| Category sets exactly right | 79.8% (79/99) |
| Category precision / recall / F1 | 0.814 / 0.908 / 0.859 |
| Technical-or-housekeeping routing correct (work order needed yes/no) | 99.0% (98/99) |
| Safety escalation (model OR keyword net): TP / FP / FN | 11 / 0 / 0  (recall 1.00, precision 1.00) |
| Safety by model alone: TP / FP / FN | 11 / 0 / 0 |
| Safety by keyword net alone: TP / FP / FN | 11 / 0 / 0 |
| Spam: TP / FP / FN | 1 / 0 / 0 |
| Cross-posted duplicates found | 1/1, false duplicates 0 |
| Work orders created | 64 (from 73 issue reports, 8 grouped, 11 safety) |
| Tokens in / out, cost | 147866 / 20466, $0.0919 for 120 calls (≈ $0.093 per 100 reviews) |

## Disagreements with the reference labels
- RV-0001 categories: got [Technical – HVAC], expected [Technical – HVAC; Front office / Service]
- RV-0002 categories: got [Technical – HVAC; Front office / Service], expected [Technical – HVAC]
- RV-0004 categories: got [Technical – Water; Front office / Service], expected [Technical – Water]
- RV-0005 sentiment: got mixed, expected positive
- RV-0010 sentiment: got negative, expected mixed
- RV-0011 categories: got [Technical – IT / TV / Wi-Fi], expected [Technical – IT / TV / Wi-Fi; Front office / Service]
- RV-0012 categories: got [Technical – Water; Front office / Service], expected [Technical – Water]
- RV-0015 categories: got [Technical – HVAC; Housekeeping], expected [Technical – HVAC]
- RV-0027 categories: got [Technical – HVAC], expected [Technical – Building]
- RV-0033 categories: got [Housekeeping; Front office / Service], expected [Housekeeping]
- RV-0045 categories: got [Technical – HVAC], expected [Technical – Building]
- RV-0046 categories: got [Technical – Water; Front office / Service], expected [Technical – Water]
- RV-0055 sentiment: got negative, expected mixed
- RV-0055 categories: got [Technical – Lifts; Technical – HVAC; Front office / Service], expected [Technical – Lifts; Technical – HVAC]
- RV-0056 sentiment: got positive, expected mixed
- RV-0058 sentiment: got positive, expected mixed
- RV-0067 categories: got [Technical – HVAC; Housekeeping; Front office / Service], expected [Technical – HVAC; Housekeeping]
- RV-0071 sentiment: got negative, expected mixed
- RV-0071 categories: got [Technical – HVAC; Front office / Service], expected [Technical – Building]
- RV-0077 categories: got [Technical – Electrical / Safety; Front office / Service], expected [Technical – Electrical / Safety]
- RV-0078 sentiment: got neutral, expected mixed
- RV-0078 categories: got [Technical – Water; Technical – Building], expected [Technical – Water]
- RV-0079 sentiment: got negative, expected mixed
- RV-0081 sentiment: got negative, expected mixed
- RV-0081 categories: got [Technical – Lifts; Front office / Service], expected [Technical – Lifts]
- RV-0082 categories: got [Technical – Water; Front office / Service], expected [Technical – Water]
- RV-0084 categories: got [Technical – IT / TV / Wi-Fi], expected [Technical – IT / TV / Wi-Fi; Front office / Service]
- RV-0091 sentiment: got mixed, expected positive
- RV-0093 sentiment: got negative, expected mixed
- RV-0093 categories: got [Front office / Service; Other], expected [Technical – Building]
- RV-0098 sentiment: got neutral, expected negative
- RV-0098 categories: got [], expected [Other]