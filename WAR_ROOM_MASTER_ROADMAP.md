# Joel's SuperCoach War Room - Master Roadmap

## Level 4 Projection Engine

Implementation status (2026-07): the live projection engine is
`ProjectionEngine` inline in `index.html` (`projectGame`/`project`/
`nextFive`). Any future work on projections must extend `ProjectionEngine`.

As of 2026-07-25, this repo had THREE non-competing-on-purpose but
overlapping projection code paths: the live `ProjectionEngine`, a
standalone `level3-projection-engine.js` file (loaded, then instantly
shadowed by inline re-definitions - never actually ran), and two further
inline re-implementations ("projection-v2"/"projection-v3", reachable only
through `window.calculateLevel3Projection`). Traced every real call site
(`proj()`, `roundProj()`'s dead fallback branch, `ensureLineup()`'s
auto-fill sort, the Player Explorer's secondary GK line) before removing
anything, verified each one either already used `ProjectionEngine` or was
rewired to, then deleted the file and ~450 dead lines. Full test suite
(65 tests, including real-browser checks) green before and after. Kept a
handful of genuinely shared helpers (`wrGoalKickerInfo` and its internal
`wrGk*` helpers, `wrClamp`/`wrNum`/`wrTruth`, `wrLineupRole`/
`wrPlayableLineupRole`) since `ProjectionEngine.goalKickingImpact` and the
Level 4 goal-kicker matchup engine genuinely depend on them.

Built and live:
- Positional Matchup Engine - `ProjectionEngine.positionalMatchupImpact`.
  Prefers real empirical data from `data/positional_matchups_v2.json`
  (built by `scripts/build-positional-matchups.mjs` from history captured
  daily by `scripts/capture-positional-history.mjs`) once a team/position
  has >= 3 independent captured rounds; falls back to the hand-seeded
  `data/opponent_difficulty.json` starter model otherwise. Adds home/away
  weighting. Strength-of-schedule surfaces on `ProjectionEngine.nextFive()`
  as `sos`/`sosLabel`.
- Teammate Synergy Engine - `ProjectionEngine.teamContextImpact` /
  `creativeHub`. Fully generic (no hardcoded players): finds each team's
  highest-season-average HFB/5-8/HOK and adjusts CTW/FLB/2RF teammates
  based on that player's real live availability and recent form.
- Goal Kicker Matchup Engine - `ProjectionEngine.goalKickerMatchupBonus`
  inside `goalKickingImpact`. Scales the existing GK boost by the same
  positional matchup signal, and cross-checks `App.teamRoles` (loaded but
  previously unused by any projection) for a confirmed-kicker signal.
- Historical Database (partial) - `data/history/positional/round_*.json`,
  real captured snapshots, growing one round at a time from 2026-07-25
  onward. Not retroactive - no historical per-round score data existed in
  this repo before that date to backfill from.

Not built - explicitly not faked:
- Aging/Development Curve Engine - `ProjectionEngine.agingCurveImpact` is a
  wired, honest no-op (`expected: 0`). No player age, debut year, or
  experience data exists anywhere in this app's pipeline. Activating this
  for real requires a new data source (age/DOB) plumbed through
  `scripts/update-players.mjs` the same way price/BE/avg already are.
- Injury Availability Engine / Origin Availability Engine / Post Injury
  Performance Engine - unchanged by this work; not in scope.

### Positional Matchup Engine
Track fantasy points conceded by opponent and position:

- HOK
- FRF
- 2RF
- HFB
- 5/8
- CTW
- FLB

Weightings:
- Season average
- Last 5 games
- Strength of schedule
- Home/Away

Future:
- Left edge concessions
- Right edge concessions
- Try assists conceded
- Goal kicker opportunities

---

### Teammate Synergy Engine

Examples:

- Latrell Mitchell playing boosts Alex Johnston
- Kalyn Ponga playing boosts Newcastle attack
- Elite halfback playing boosts edge forwards
- Goal-kicker changes impact projections

Track:

- With player
- Without player
- Try scoring changes
- Fantasy scoring changes

---

### Goal Kicker Matchup Engine

Track:

- Opponent points conceded
- Opponent tries conceded
- Conversion opportunities
- Penalty goal opportunities

Increase projection when opponent leaks points.

---

### Injury Availability Engine

Official return windows:

Example:

4-6 weeks

Weeks 1-4:
RED = OUT

Weeks 5-6:
YELLOW = MAYBE

Only confirmed players count as available.

---

### Origin Availability Engine

Categories:

- Confirmed Playing
- Origin Unavailable
- Origin Backup Risk
- Origin Rest Risk

Only confirmed players count as available.

---

### Historical Database

Store every round:

- Scores
- Prices
- Breakevens
- Ownership
- Injuries
- Suspensions
- Team Lists
- Goal Kickers
- Matchups
- Weather
- Opponent Data

Purpose:

Improve future projections.

---

### Development Curve Engine

Account for:

- Rookie improvement
- Age development
- Experience growth
- Minutes growth
- Role growth

---

### Aging Curve Engine

Account for:

- Superstar decline
- Reduced minutes
- Increased injury risk
- Rest risk
- Role changes

---

### Post Injury Performance Engine

Track:

- Pre-injury performance
- Post-injury performance
- Recovery period
- Reinjury risk
- Long-term performance impact

Some players never return to previous output.