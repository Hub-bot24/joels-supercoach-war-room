# SuperCoach War Room — Mandatory AI Rules

These rules are mandatory for any AI assistant or developer working on this repo.

This repo must be treated like a production-grade platform, not a playground.

The goal is a world-class SuperCoach War Room app that is accurate, reliable, fast, cloud-first, and season-to-season durable.

---

## Rule 1 — World-class reliability first

Reliability, accuracy, speed, and architecture come before “just making it pass”.

If a fix fails twice, or generated data quality is wrong, stop patching.

Do not keep layering fixes onto a bad approach.

Correct response:

1. Protect the repo.
2. Inspect the current state.
3. Identify the real truth source.
4. Redesign the core fix.
5. Validate through GitHub Actions and generated reports.

Bad response:

1. Guess.
2. Patch.
3. Patch again.
4. Accept a green workflow even when the data is wrong.

---

## Rule 2 — No Python for this project

Do not suggest, write, run, migrate to, or depend on Python for this repo.

Allowed tools:

- Node
- JavaScript / `.mjs`
- GitHub Actions
- PowerShell
- VS Code
- browser DevTools
- GitHub logs
- generated JSON reports

Forbidden tools:

- Python
- pip
- pandas
- local Python scripts
- Python-based validation
- Python workflow migrations

If an old Python file exists, it may be inspected as historical reference only. Do not build new project workflows around Python.

---

## Rule 3 — No hardcoded real fixes

Do not hardcode:

- player-specific fixes
- season/year fixes
- round fixes
- club-specific exceptions
- manual fixture corrections
- one-off status patches
- UI hacks that force a result

Temporary diagnostics must be clearly marked `TEST ONLY` and removed before commit.

A real fix must solve the pipeline, not one player, one round, or one season.

---

## Rule 4 — Preserve truth-source architecture

Correct architecture:

```text
SOURCE → SCRIPT → VALIDATED JSON → APP LOGIC → UI