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

## NON-NEGOTIABLE DEBUGGING RULE: SOURCE CONTRACT FIRST

Before suggesting or editing any code that changes generated data, the AI must first identify and document the full source contract:

1. What is the upstream truth source?
2. Which script imports it?
3. Which generated file does that script write?
4. Which downstream script consumes that generated file?
5. Which UI/app logic consumes the final generated file?
6. What exact evidence proves the source contains the expected data?
7. What exact evidence proves the importer currently loses, changes, or fails to match that data?

The AI must not suggest:
- manual player fixes,
- position_overrides player patches,
- index.html UI patches,
- one-player corrections,
- parser rewrites,
- generated JSON edits,

until the source contract has been proven.

If the bug involves generated data, the AI must classify the failure as one of:

- SOURCE MISSING
- SOURCE FORMAT MISREAD
- IMPORTER PARSE FAILURE
- NAME MATCH FAILURE
- MERGE FAILURE
- DOWNSTREAM GENERATOR FAILURE
- UI DISPLAY FAILURE

The AI must state this classification before proposing a fix.

If the AI cannot prove the source contract, it must stop and ask for inspection commands only.

---

# GOLDEN RULES — NEVER BREAK THESE

These rules govern the app end to end, day to day, week to week, season to season. They are the highest-priority rules in this file. If anything above conflicts with a Golden Rule, the Golden Rule wins.

## 1. One source of truth

Every part of the app must use the same central truth for:

- Active round
- Team-list status
- Opponent
- Venue
- Kickoff
- Fixture selection
- Weather
- Player position
- Bye rounds
- Projections

Never create a second competing calculation, fallback system, renderer-specific truth, or data pipeline.

## 2. Never hardcode live football information

Never hardcode:

- Players
- Player statuses
- Injuries
- Return dates
- Positions or DPP
- Teams
- Opponents
- Rounds
- Seasons
- Dates
- Fixtures
- Venues
- Kickoff times
- Bye rounds
- Weather

A player-specific manual patch is not a fix. It is trash that hides the real pipeline failure.
Fix the source, parser, generator, or central helper that caused the incorrect result.

## 3. Current-round truth changes only after Tuesday team lists

The app must continue showing the active round's:

- Opponent
- Venue
- Kickoff
- Match information
- Weather
- Player status

until the Tuesday team-list pipeline officially advances the app's active-round truth.
A match finishing does not automatically make the next fixture the active one.
After the Tuesday update advances the round, every affected view must switch to the next fixture and its weather.

## 4. The rollover rule applies everywhere

The Tuesday rollover rule is global, not just for player cards. It applies anywhere the app displays or uses:

- Opponent
- Next game
- Venue or stadium
- Kickoff
- Fixture context
- Weather
- Weather risk
- Current-round game information
- Upcoming-match projections

Every view must use the same active-round fixture helper.

## 5. Weather follows the selected active fixture

Weather must:

- Stay attached to the centrally selected active-round fixture
- Continue refreshing until kickoff
- Not jump to the following round merely because the current game finished
- Switch only when the Tuesday team-list process advances the round
- Match the active round, venue, and kickoff

Do not add another weather fetch, timer, or polling loop merely to fix one screen. Use the existing weather refresh pipeline.

## 6. Team-list status truth

When a trusted club team list has loaded:

- Named 1–17 = green / named
- Named in the extended squad, generally 18–25 = yellow / extended
- Absent from the trusted loaded list = grey / not named

When no trusted club list has loaded:

- Status must be yellow / source missing or expected
- It must not become grey / not named

Missing data is not evidence that a player was dropped.

## 7. Incomplete team-list coverage cannot create status truth

Partial or unreliable team-list data must not:

- Write false `NOT_NAMED` states
- Produce fake grey statuses
- Hide genuinely named players
- Be treated as complete league coverage
- Confirm green states through weak fallback inference

The updater must know which clubs were reliably loaded before it makes absence-based decisions.

## 8. Generated JSON is output, not the repair location

Do not manually repair:

- `status_truth.json`
- `teamlists.json`
- `official_teamlists.json`
- `fixtures.json`
- `dual_positions.json`
- `position_master.json`
- Other generated data files

Fix the source-layer code, parser, or generator. GitHub Actions should regenerate the output files.

## 9. DPP and positions must remain source-driven

Do not manually add or remove a player's position. The pipeline must preserve all valid positions returned by trusted sources.
When DPP is wrong, inspect:

- Source extraction
- Player matching
- Override matching
- Array handling
- Later overwrite logic
- Generator output

Do not patch the individual player.

## 10. Bye truth must come from actual fixture data

The Bye Planner must use each player's genuine bye rounds. Current-round status such as `BYE` must not leak into future non-bye rounds.
Never infer a future bye merely because the player's current status is `BYE`.

## 11. Player cards must remain accurate while open

A player card must update correctly even when the user already has it open. Refresh through the existing:

- Data cycle
- Status truth
- Active-round helper
- Renderer cycle
- Weather refresh

Do not introduce:

- A second timer
- A new polling loop
- Another weather request
- Duplicate state
- A separate player-card pipeline

Where practical, preserve:

- The open player card
- The expanded or collapsed Details state
- Scroll position

## 12. One player-card system

All player taps must open the same War Room detail-card system. Do not build competing cards for different screens. The app must avoid:

- Duplicate player cards
- Multiple popup implementations
- Conflicting status renderers
- Different truth logic between My Team, reserves, and other player lists

## 13. Player-card layout rules

The card must retain:

- The exact blue current-round game block
- The grey team-list/status explanation block
- Both inside one collapsed Details section
- Trade visible outside Details
- Move / Swap visible outside Details
- Player photo
- Correct status dot and label
- Current-round truth
- Valid recent-form statistics
- Correct stat labels
- Only one projected-score display

Do not remove current game details merely to make the card smaller.

## 14. Projections must reflect real availability

A projected score of zero must mean something real and explainable. Projection logic should use:

- Current round metadata
- Team-list truth
- Line-up role
- Availability
- Fixture context
- Relevant form and scoring data

Do not silently produce zero because a source failed, a player could not be matched, or the wrong round was selected.
Unknown data and confirmed non-selection are not the same thing.

## 15. Preserve the team structure

The app must preserve:

- 14 on-field players
- 12 reserves
- The established empty-reserve fix

A renderer rebuild must not damage the team structure or make empty reserve slots disappear incorrectly.

## 16. Protect performance architecture

Do not undo the established performance fixes, including:

- Level 3 speed improvements
- Explorer debounce
- Duplicate-renderer cleanup
- Single boot
- Single tab wiring
- Fast tab switching

A visual or data fix must not restore an older, slower `index.html` or reintroduce duplicate work.

## 17. No blind CSS stacking

Do not keep adding overrides on top of overrides. Before changing styling:

- Identify the active rule
- Remove or replace the faulty rule cleanly
- Avoid duplicate selectors
- Avoid `!important` wars
- Confirm the change does not alter unrelated cards or screens

A CSS pile-up is not a sustainable fix.

## 18. Classify every change

Every proposed action should be identified as one of:

- CORE FIX
- DATA PIPELINE FIX
- ROLLBACK
- TEST ONLY
- TEMP PATCH

Temporary patches must be clearly identified and should not become permanent architecture. Manual player fixes do not qualify as core fixes.

## 19. Inspect before editing

Before changing code:

- Inspect the current file
- Inspect Git history
- Identify the last known-good behaviour
- Identify the exact commit involved
- Understand the active pipeline
- Confirm whether the fault is data, generator, renderer, or CSS

Do not start with random edits.

## 20. Do not use destructive Git commands blindly

Do not run the following until the exact situation is understood:

- `git pull`
- `git reset`
- `git revert`
- `git checkout`
- Merge resolution
- Force push

Never accept "incoming" or "outgoing" changes blindly. Preserve correct local work before resolving conflicts.

## 21. Keep code fixes separate from live generated data

A small architecture or parser fix must not drag a massive batch of unrelated generated-data changes into the same commit.

Preferred sequence:

1. Preserve the intended code fix.
2. Rebase the clean code commit onto current `origin/main`.
3. Push only the code change.
4. Let GitHub Actions regenerate live data.
5. Pull the generated truth back down.
6. Verify the affected players, teams, and rounds.

Do not create a dirty merge commit containing unrelated live data.

## 22. Never fake status truth to make the UI look correct

Do not alter data simply so a card turns green, yellow, or grey. The colour must be the result of correct source truth.
The UI must display the pipeline's truth; it must not manufacture it.

## 23. Do not fix pipeline failures in the renderer

The renderer should not compensate for:

- Missing team lists
- Broken player matching
- Bad fixture selection
- Incorrect DPP
- Stale status data
- Missing source coverage
- Wrong round metadata

Fix those failures upstream. The UI may clearly display "source missing," but it must not invent the missing truth.

## 24. Changes should be tightly scoped

Only modify files directly required for the proven fault. Do not touch fixture, DPP, status, workflow, or player pipelines unless evidence shows their contract is wrong.

A player-card adjustment should not casually modify:

- Fixture generation
- Position generation
- Team-list scraping
- Workflows
- Weather architecture
- Projection architecture

## 25. Verify the entire contract, not one screenshot

A fix is not complete because one player looks right. Test:

- Named player
- Extended-squad player
- Not-named player
- Club with missing source data
- Bye player
- Injured or unavailable player
- Player with multiple positions
- Open player card during refresh
- Current round before Tuesday rollover
- Next round after Tuesday rollover
- Weather before kickoff
- My Team and reserves
- Desktop and another device after deployment

## 26. Main deployment must be the actual saved truth

Changes made only in a browser, local temporary session, or uncommitted file will not sync to other devices. For a change to carry across devices, it must be:

- Saved in the correct project
- Committed
- Pushed to the deployed branch
- Successfully deployed
- Loaded without stale browser cache

Do not claim a fix is live merely because it works on one laptop.

## The two highest-level rules

**Golden Rule 1** — No hardcoded or manual player fixes. Fix the real source, parser, generator, or central architecture.

**Golden Rule 2** — Protect the single core truth architecture. Never create duplicate pipelines or let different parts of the app calculate their own version of reality.
