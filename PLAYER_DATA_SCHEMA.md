# players.json schema

The app reads `players.json` from the repo root.

Required fields:
- name
- pos
- team
- price
- proj
- avg
- ownership
- bye
- cPct
- vcPct
- risk
- injuryStatus
- expectedReturnRound
- playProbability
- injuryNote

Example:
```json
{
  "name": "Nathan Cleary",
  "pos": "HFB",
  "team": "PEN",
  "price": 950000,
  "proj": 82,
  "avg": 78,
  "ownership": 32,
  "bye": [13],
  "cPct": 22,
  "vcPct": 38,
  "risk": 18,
  "injuryStatus": "fit",
  "expectedReturnRound": 1,
  "playProbability": 100,
  "injuryNote": "Available"
}
```

Important:
This file is currently starter data. Real automation needs an allowed data source.
Do not scrape paid/member-only tools without permission.