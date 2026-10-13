# Evaluation – model gpt-4.1-mini
Reviews: 100 total, 99 analysed by the model, 1 duplicate, errors: 0. Run time 42 s.

| Metric | Result |
|---|---|
| Language | 100.0% (99/99) |
| Sentiment exact | 88.9% (88/99) |
| Sentiment, no positive<->negative flips | 100.0% (99/99) |
| Category sets exactly right | 81.8% (81/99) |
| Category precision / recall / F1 | 0.840 / 0.908 / 0.873 |
| Technical-or-housekeeping routing correct (work order needed yes/no) | 100.0% (99/99) |
| Safety escalation (model OR keyword net): TP / FP / FN | 11 / 0 / 0  (recall 1.00, precision 1.00) |
| Safety by model alone: TP / FP / FN | 11 / 0 / 0 |
| Safety by keyword net alone: TP / FP / FN | 11 / 0 / 0 |
| Spam: TP / FP / FN | 1 / 0 / 0 |
| Cross-posted duplicates found | 1/1, false duplicates 0 |
| Work orders created | 64 (from 74 issue reports, 9 grouped, 11 safety) |
| Tokens in / out, cost | 115409 / 20324, $0.0787 for 120 calls (≈ $0.079 per 100 reviews) |

## Disagreements with the reference labels
- RV-0001 categories: got [Technical – HVAC], expected [Technical – HVAC; Front office / Service]
- RV-0004 categories: got [Technical – Water; Front office / Service], expected [Technical – Water]
- RV-0005 sentiment: got mixed, expected positive
- RV-0011 categories: got [Technical – IT / TV / Wi-Fi], expected [Technical – IT / TV / Wi-Fi; Front office / Service]
- RV-0012 categories: got [Technical – Water; Front office / Service], expected [Technical – Water]
- RV-0015 categories: got [Technical – HVAC; Housekeeping], expected [Technical – HVAC]
- RV-0027 categories: got [Technical – HVAC], expected [Technical – Building]
- RV-0033 categories: got [Housekeeping; Front office / Service], expected [Housekeeping]
- RV-0045 categories: got [Technical – HVAC], expected [Technical – Building]
- RV-0049 sentiment: got negative, expected mixed
- RV-0055 sentiment: got negative, expected mixed
- RV-0055 categories: got [Technical – Lifts; Technical – HVAC; Front office / Service], expected [Technical – Lifts; Technical – HVAC]
- RV-0058 sentiment: got positive, expected mixed
- RV-0071 sentiment: got negative, expected mixed
- RV-0071 categories: got [Technical – HVAC; Front office / Service], expected [Technical – Building]
- RV-0073 categories: got [Housekeeping], expected [Technical – Building]
- RV-0077 categories: got [Technical – Electrical / Safety; Front office / Service], expected [Technical – Electrical / Safety]
- RV-0078 sentiment: got negative, expected mixed
- RV-0078 categories: got [Technical – Water; Technical – Building], expected [Technical – Water]
- RV-0079 sentiment: got negative, expected mixed
- RV-0081 sentiment: got negative, expected mixed
- RV-0081 categories: got [Technical – Lifts; Front office / Service], expected [Technical – Lifts]
- RV-0082 categories: got [Technical – Water; Front office / Service], expected [Technical – Water]
- RV-0084 categories: got [Technical – IT / TV / Wi-Fi], expected [Technical – IT / TV / Wi-Fi; Front office / Service]
- RV-0091 sentiment: got mixed, expected positive
- RV-0093 sentiment: got negative, expected mixed
- RV-0093 categories: got [Other; Technical – Building], expected [Technical – Building]
- RV-0098 sentiment: got neutral, expected negative
- RV-0098 categories: got [], expected [Other]