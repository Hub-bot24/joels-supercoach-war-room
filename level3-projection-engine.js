/* ==========================================================
   JOEL SUPERCOACH WAR ROOM
   LEVEL 3 PROJECTION ENGINE - FINAL SAFE VERSION

   FILE NAME TO USE IN GITHUB:
   level3-projection-engine.js

   WHAT THIS FIXES:
   - One projected score everywhere.
   - Realistic Projection Layer is no longer a separate rogue formula.
   - Missing data lowers confidence AND caps upside.
   - 5-game projection uses the same Level 3 formula.
   - Player Explorer is NOT removed.
   - 5-year predicted score is NOT removed.
   - Existing tabs/cards are NOT overwritten.

   MAIN FUNCTIONS:
   getProjectedScore(player)
   calculateLevel3Projection(player, options)
   calculateFiveGameProjection(player, options)
   getFiveGameProjectedScore(player, options)
   realisticProjectionLayer(player, options)

   ========================================================== */

(function () {
  "use strict";

  /* =========================
     HELPERS
     ========================= */

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function txt(value) {
    return String(value ?? "").trim();
  }

  function lower(value) {
    return txt(value).toLowerCase();
  }

  function upper(value) {
    return txt(value).toUpperCase();
  }

  function firstPositiveNumber(player, keys) {
    for (const key of keys) {
      if (!player) continue;
      const value = player[key];
      if (value === undefined || value === null || value === "") continue;
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  }

  function firstNumberAllowZero(player, keys) {
    for (const key of keys) {
      if (!player) continue;
      const value = player[key];
      if (value === undefined || value === null || value === "") continue;
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  function normalisePosition(pos) {
    return upper(pos)
      .replaceAll("FIVE-EIGHTH", "5/8")
      .replaceAll("FIVE EIGHTH", "5/8")
      .replaceAll("FIVEEIGHTH", "5/8")
      .replaceAll("HALF BACK", "HFB")
      .replaceAll("HALFBACK", "HFB")
      .replaceAll("HOOKER", "HOK")
      .replaceAll("FULLBACK", "FLB")
      .replaceAll("FRONT ROW", "FRF")
      .replaceAll("SECOND ROW", "2RF")
      .replaceAll("CENTRE", "CTW")
      .replaceAll("WING", "CTW")
      .replace(/\s+/g, "")
      .trim();
  }

  function playerName(player) {
    return txt(player?.name || player?.player || player?.fullName);
  }

  function playerTeam(player) {
    return upper(player?.team || player?.club || player?.squad);
  }

  function playerPosition(player) {
    return normalisePosition(player?.pos || player?.position || player?.positions);
  }

  function currentRound() {
    const domRound = document.getElementById("currentRound")?.value;
    return num(domRound, num(window.currentRound, 0));
  }

  /* =========================
     DATA GETTERS
     ========================= */

  function seasonAverage(player) {
    return firstPositiveNumber(player, [
      "avg",
      "average",
      "seasonAvg",
      "seasonAverage",
      "scAverage",
      "supercoachAvg"
    ]);
  }

  function last3Average(player) {
    return firstPositiveNumber(player, [
      "last3Avg",
      "threeRoundAvg",
      "last3",
      "avg3",
      "l3",
      "recent3"
    ]);
  }

  function last5Average(player) {
    return firstPositiveNumber(player, [
      "last5Avg",
      "fiveRoundAvg",
      "last5",
      "avg5",
      "l5",
      "recent5"
    ]);
  }

  function manualProjection(player) {
    return firstPositiveNumber(player, [
      "level3Proj",
      "trueProjection",
      "finalProj",
      "proj",
      "projected",
      "projection",
      "expected",
      "nextProj"
    ]);
  }

  function minutes(player) {
    return firstPositiveNumber(player, [
      "projectedMinutes",
      "avgMinutes",
      "minutes",
      "mins",
      "expectedMinutes"
    ]);
  }

  function ownership(player) {
    return firstNumberAllowZero(player, [
      "own",
      "ownership",
      "ownershipPercent",
      "selectedBy"
    ]);
  }

  function breakeven(player) {
    return firstNumberAllowZero(player, [
      "be",
      "breakeven",
      "breakEven"
    ]);
  }

  function price(player) {
    return firstNumberAllowZero(player, [
      "price",
      "cost",
      "value"
    ]);
  }

  function highScore(player) {
    return firstPositiveNumber(player, [
      "ceiling",
      "highScore",
      "bestScore",
      "seasonHigh",
      "maxScore"
    ]);
  }

  function byeRounds(player) {
    const raw = player?.byeRounds || player?.byes || player?.bye || player?.byeRound;

    if (Array.isArray(raw)) {
      return raw.map(Number).filter(Number.isFinite);
    }

    if (typeof raw === "string") {
      return raw
        .split(/[,\s/|]+/)
        .map(Number)
        .filter(Number.isFinite);
    }

    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? [n] : [];
  }

  /* =========================
     FUTURE FIXTURE SUPPORT
     ========================= */

  function getFutureFixture(player, roundNumber, gameIndex) {
    const fixtureMap = player?.fixture || player?.fixturesByRound || player?.drawByRound;

    if (fixtureMap && typeof fixtureMap === "object" && !Array.isArray(fixtureMap)) {
      const f = fixtureMap[String(roundNumber)] || fixtureMap[roundNumber];
      if (f) return f;
    }

    const fixtureArray = Array.isArray(player?.fixtures)
      ? player.fixtures
      : Array.isArray(player?.draw)
        ? player.draw
        : Array.isArray(player?.next5)
          ? player.next5
          : [];

    const byRound = fixtureArray.find((f) => num(f.round, 0) === roundNumber);
    if (byRound) return byRound;

    const byIndex = fixtureArray[gameIndex];
    if (byIndex) return byIndex;

    return null;
  }

  function getFutureManualProjection(player, roundNumber, gameIndex) {
    const maps = [
      player?.futureProj,
      player?.futureProjection,
      player?.futureProjections,
      player?.roundProj,
      player?.roundProjection,
      player?.roundProjections
    ];

    for (const map of maps) {
      if (map && typeof map === "object" && !Array.isArray(map)) {
        const value = map[String(roundNumber)] ?? map[roundNumber];
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }

    const arrays = [
      player?.next5Proj,
      player?.nextFiveProj,
      player?.fiveGameProj,
      player?.fiveRoundProj
    ];

    for (const arr of arrays) {
      if (Array.isArray(arr)) {
        const n = Number(arr[gameIndex]);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }

    return 0;
  }

  /* =========================
     AVAILABILITY
     ========================= */

  function injuryStatus(player) {
    return lower(player?.injuryStatus || player?.status || player?.availability || "");
  }

  function playProbability(player) {
    const p = firstNumberAllowZero(player, [
      "playProbability",
      "playProb",
      "probability",
      "chanceToPlay"
    ]);

    return p > 0 ? p : 100;
  }

  function availability(player, options = {}) {
    const status = injuryStatus(player);
    const prob = playProbability(player);
    const round = num(options.round, currentRound());
    const byes = byeRounds(player);

    if (round && byes.includes(round)) {
      return {
        hardOut: true,
        adjustment: -999,
        label: "BYE",
        reason: `Player is on bye in round ${round}`
      };
    }

    if (
      status.includes("out") ||
      status.includes("suspended") ||
      status.includes("season") ||
      status.includes("ruled")
    ) {
      return {
        hardOut: true,
        adjustment: -999,
        label: "OUT",
        reason: "Player unavailable"
      };
    }

    if (prob <= 0) {
      return {
        hardOut: true,
        adjustment: -999,
        label: "OUT",
        reason: "Play probability is 0%"
      };
    }

    if (status.includes("doubtful")) {
      return {
        hardOut: false,
        adjustment: -18,
        label: "DOUBTFUL",
        reason: "Doubtful injury status"
      };
    }

    if (status.includes("chance") || status.includes("test") || status.includes("monitor")) {
      return {
        hardOut: false,
        adjustment: -8,
        label: "CHANCE",
        reason: "Chance/test injury status"
      };
    }

    if (prob < 60) {
      return {
        hardOut: false,
        adjustment: -14,
        label: "RISK",
        reason: "Low play probability"
      };
    }

    if (prob < 80) {
      return {
        hardOut: false,
        adjustment: -6,
        label: "SOME RISK",
        reason: "Reduced play probability"
      };
    }

    return {
      hardOut: false,
      adjustment: 0,
      label: "AVAILABLE",
      reason: "No major availability issue"
    };
  }

  /* =========================
     FORM BASE
     ========================= */

  function formBase(player, options = {}) {
    const avg = seasonAverage(player);
    const l3 = last3Average(player);
    const l5 = last5Average(player);

    const futureManual = options.round
      ? getFutureManualProjection(player, options.round, num(options.gameIndex, 0))
      : 0;

    const manual = futureManual || manualProjection(player);

    let form = 0;
    let formReason = "";

    if (avg && l3 && l5) {
      form = avg * 0.45 + l3 * 0.35 + l5 * 0.20;
      formReason = "season average + last 3 + last 5";
    } else if (avg && l3) {
      form = avg * 0.60 + l3 * 0.40;
      formReason = "season average + last 3";
    } else if (avg && l5) {
      form = avg * 0.65 + l5 * 0.35;
      formReason = "season average + last 5";
    } else if (avg) {
      form = avg;
      formReason = "season average only";
    } else if (l3) {
      form = l3;
      formReason = "last 3 only";
    } else if (l5) {
      form = l5;
      formReason = "last 5 only";
    }

    let base = 0;
    let baseReason = "";

    if (manual && form) {
      base = manual * 0.55 + form * 0.45;
      baseReason = futureManual
        ? "future round projection blended with form"
        : "projection blended with form";
    } else if (manual) {
      base = manual;
      baseReason = futureManual
        ? "future round projection only"
        : "projection only";
    } else if (form) {
      base = form;
      baseReason = formReason;
    } else {
      base = 0;
      baseReason = "missing projection and average data";
    }

    return {
      base,
      form,
      manual,
      avg,
      last3: l3,
      last5: l5,
      futureManual,
      baseReason
    };
  }

  /* =========================
     ROLE / GOAL / UPSIDE
     ========================= */

  function isGoalKicker(player) {
    const raw =
      player?.goalKicker ??
      player?.kickingGoals ??
      player?.isGoalKicker ??
      player?.kicksGoals;

    if (typeof raw === "boolean") return raw;

    const value = lower(raw);
    return (
      value === "yes" ||
      value === "true" ||
      value === "1" ||
      value.includes("goal")
    );
  }

  function isDominantHalf(player) {
    const raw =
      player?.dominantHalf ??
      player?.primaryPlaymaker ??
      player?.mainPlaymaker;

    if (typeof raw === "boolean") return raw;

    const value = lower(raw);
    return (
      value === "yes" ||
      value === "true" ||
      value === "1" ||
      value.includes("dominant") ||
      value.includes("primary")
    );
  }

  function roleAdjustment(player) {
    const pos = playerPosition(player);
    const role = lower(player?.role || player?.roleSecurity || player?.notes || "");
    const mins = minutes(player);

    let adjustment = 0;
    const notes = [];

    const isForward =
      pos.includes("FRF") ||
      pos.includes("2RF") ||
      pos.includes("HOK") ||
      pos.includes("LOCK");

    const isHalf =
      pos.includes("HFB") ||
      pos.includes("5/8");

    const isOutsideBack =
      pos.includes("FLB") ||
      pos.includes("CTW");

    if (mins) {
      if (mins >= 75 && isForward) {
        adjustment += 5;
        notes.push("big-minute forward");
      } else if (mins >= 70 && isForward) {
        adjustment += 4;
        notes.push("strong-minute forward");
      } else if (mins < 45) {
        adjustment -= 8;
        notes.push("low minutes");
      } else if (mins < 55 && isForward) {
        adjustment -= 6;
        notes.push("forward minute risk");
      }
    }

    if (isGoalKicker(player)) {
      adjustment += 4;
      notes.push("goal-kicking upside");
    }

    if (isDominantHalf(player) && isHalf) {
      adjustment += 4;
      notes.push("dominant playmaker");
    }

    if (role.includes("bench")) {
      adjustment -= 10;
      notes.push("bench role");
    }

    if (role.includes("edge")) {
      adjustment += 2;
      notes.push("edge role");
    }

    if (role.includes("lock")) {
      adjustment += 2;
      notes.push("lock role");
    }

    if (role.includes("utility")) {
      adjustment -= 5;
      notes.push("utility role risk");
    }

    if (role.includes("80") || role.includes("eighty")) {
      adjustment += 3;
      notes.push("80-minute role");
    }

    if (isOutsideBack && role.includes("elite")) {
      adjustment += 3;
      notes.push("elite outside-back upside");
    }

    return {
      adjustment,
      notes
    };
  }

  function ceilingAdjustment(player) {
    const avg = seasonAverage(player);
    const high = highScore(player);

    if (!avg || !high) {
      return {
        adjustment: 0,
        note: "no ceiling data"
      };
    }

    const gap = high - avg;

    if (gap >= 50) return { adjustment: 6, note: "monster ceiling" };
    if (gap >= 40) return { adjustment: 5, note: "high ceiling" };
    if (gap >= 30) return { adjustment: 3, note: "some ceiling" };
    if (gap <= 10) return { adjustment: -2, note: "limited ceiling" };

    return {
      adjustment: 0,
      note: "normal ceiling"
    };
  }

  /* =========================
     OPPONENT / WEATHER / VALUE
     ========================= */

  function opponentAdjustment(player, options = {}) {
    const pos = playerPosition(player);
    const opponent = upper(options.opponent || player?.opponent || player?.opp || player?.vs);

    if (!opponent || !pos) {
      return {
        adjustment: 0,
        note: "no opponent data"
      };
    }

    try {
      if (
        window.OPP_POS_V2 &&
        window.OPP_POS_V2[opponent] &&
        window.OPP_POS_V2[opponent][pos] !== undefined
      ) {
        return {
          adjustment: num(window.OPP_POS_V2[opponent][pos], 0),
          note: `opponent positional data vs ${opponent}`
        };
      }

      if (
        window.forceOppAdj &&
        window.forceOppAdj[opponent] &&
        window.forceOppAdj[opponent][pos] !== undefined
      ) {
        return {
          adjustment: num(window.forceOppAdj[opponent][pos], 0),
          note: `opponent force adjustment vs ${opponent}`
        };
      }
    } catch (error) {}

    return {
      adjustment: 0,
      note: opponent ? `no opponent data for ${opponent}` : "no opponent data"
    };
  }

  function weatherAdjustment(player, options = {}) {
    if (options.disableWeather) {
      return {
        adjustment: 0,
        note: "future weather neutral"
      };
    }

    try {
      if (
        typeof window.findWeatherMatchForTeam === "function" &&
        typeof window.numericWeatherAdjustment === "function"
      ) {
        const match = window.findWeatherMatchForTeam(playerTeam(player));
        if (match) {
          const weather = window.numericWeatherAdjustment(player, match);
          return {
            adjustment: num(weather?.score, 0),
            note: weather?.note || "weather data applied"
          };
        }
      }
    } catch (error) {}

    return {
      adjustment: 0,
      note: "no weather adjustment"
    };
  }

  function valueAdjustment(player) {
    const p = price(player);
    const be = breakeven(player);
    const avg = seasonAverage(player);

    let adjustment = 0;
    const notes = [];

    if (be && avg) {
      if (be <= avg - 20) {
        adjustment += 2;
        notes.push("price rise profile");
      } else if (be >= avg + 20) {
        adjustment -= 2;
        notes.push("price fall risk");
      }
    }

    if (p && avg) {
      const valuePerPoint = p / avg;

      if (valuePerPoint < 7000) {
        adjustment += 2;
        notes.push("strong value");
      } else if (valuePerPoint > 9500) {
        adjustment -= 1;
        notes.push("expensive for output");
      }
    }

    return {
      adjustment,
      note: notes.join(", ") || "no value adjustment"
    };
  }

  /* =========================
     MISSING DATA + UPSIDE CAP
     ========================= */

  function missingData(player, options = {}) {
    const missing = [];

    if (!seasonAverage(player)) missing.push("season average");
    if (!last3Average(player)) missing.push("last 3");
    if (!last5Average(player)) missing.push("last 5");

    if (
      !manualProjection(player) &&
      !getFutureManualProjection(player, options.round, num(options.gameIndex, 0))
    ) {
      missing.push("manual/current projection");
    }

    if (!playerTeam(player)) missing.push("team");
    if (!playerPosition(player)) missing.push("position");
    if (!minutes(player)) missing.push("minutes");
    if (!ownership(player)) missing.push("ownership");
    if (!breakeven(player)) missing.push("breakeven");

    if (options.isFuture && !options.opponent) {
      missing.push("future opponent");
    }

    return missing;
  }

  function calculateAllowedUpsideCap(player, missing, options = {}) {
    /*
      This is the important fix.

      Old bad behaviour:
      Base 60 + Goal/Ceiling +22 = 82
      even while season average, last 3, last 5 and opponent were missing.

      New behaviour:
      Missing data does not just lower confidence.
      It also limits how much upside the model is allowed to add.
    */

    const avg = seasonAverage(player);
    const l3 = last3Average(player);
    const l5 = last5Average(player);
    const oppMissing = missing.includes("future opponent") || missing.includes("opponent");
    const formMissing = !avg && !l3 && !l5;

    let cap = 22;

    if (formMissing) cap = Math.min(cap, 10);
    else if (!l3 && !l5) cap = Math.min(cap, 12);
    else if (!l3 || !l5) cap = Math.min(cap, 16);

    if (oppMissing || (options.isFuture && !options.opponent)) {
      cap = Math.min(cap, 14);
    }

    if (missing.length >= 6) cap = Math.min(cap, 10);
    else if (missing.length >= 4) cap = Math.min(cap, 14);
    else if (missing.length >= 2) cap = Math.min(cap, 18);

    if (options.isFuture) {
      const gameIndex = num(options.gameIndex, 0);
      if (gameIndex >= 4) cap = Math.min(cap, 12);
      else if (gameIndex >= 2) cap = Math.min(cap, 14);
    }

    return cap;
  }

  function applyUpsideCap(base, rawBeforeCap, allowedCap) {
    const rawUpside = rawBeforeCap - base;

    if (rawUpside <= allowedCap) {
      return {
        score: rawBeforeCap,
        rawUpside,
        cappedUpside: rawUpside,
        capApplied: false,
        allowedCap
      };
    }

    return {
      score: base + allowedCap,
      rawUpside,
      cappedUpside: allowedCap,
      capApplied: true,
      allowedCap
    };
  }

  /* =========================
     CONFIDENCE + RAILS
     ========================= */

  function confidence(player, missing, avail, options = {}) {
    let score = 92;

    score -= missing.length * 5;

    if (avail.adjustment < 0 && avail.adjustment > -999) {
      score -= 8;
    }

    if (!manualProjection(player) && !seasonAverage(player)) {
      score -= 18;
    }

    if (!last3Average(player) && !last5Average(player)) {
      score -= 10;
    }

    if (options.isFuture) {
      score -= num(options.gameIndex, 0) * 4;
      if (!options.opponent) score -= 6;
      if (options.disableWeather) score -= 3;
    }

    score = clamp(score, 35, 95);

    let label = "Low";
    if (score >= 75) label = "High";
    else if (score >= 58) label = "Medium";

    return {
      score,
      label
    };
  }

  function futureRoundDriftAdjustment(gameIndex) {
    const i = num(gameIndex, 0);
    if (i <= 0) return 0;
    if (i === 1) return -1;
    if (i === 2) return -2;
    if (i === 3) return -3;
    return -4;
  }

  function sanityRails(player, rawScore) {
    const avg = seasonAverage(player);
    const l3 = last3Average(player);
    const manual = manualProjection(player);

    let score = rawScore;
    const notes = [];

    if (avg >= 75 && score < avg - 10) {
      score = avg - 10;
      notes.push("elite average floor rail");
    }

    if (avg >= 70 && score < 62) {
      score = 62;
      notes.push("gun minimum rail");
    }

    if (avg >= 60 && score < 52) {
      score = 52;
      notes.push("keeper minimum rail");
    }

    if (l3 >= 75 && score < 62) {
      score = 62;
      notes.push("hot form rail");
    }

    if (manual >= 75 && score < 62) {
      score = 62;
      notes.push("manual projection rail");
    }

    score = clamp(score, 0, 105);

    return {
      score,
      notes
    };
  }

  /* =========================
     MASTER LEVEL 3
     ========================= */

  function calculateLevel3Projection(player, options = {}) {
    if (!player) {
      return {
        expected: 0,
        projection: 0,
        realisticExpected: 0,
        finalExpected: 0,
        score: 0,
        floor: 0,
        ceiling: 0,
        confidence: "Low",
        confidenceScore: 0,
        base: 0,
        raw: 0,
        adjustments: {},
        reason: ["No player supplied"],
        missing: ["player"]
      };
    }

    const round = num(options.round, currentRound());
    const gameIndex = num(options.gameIndex, 0);
    const fixture = options.fixture || getFutureFixture(player, round, gameIndex);
    const opponent = upper(options.opponent || fixture?.opponent || fixture?.opp || fixture?.vs);

    const calcOptions = {
      ...options,
      round,
      gameIndex,
      opponent,
      isFuture: !!options.isFuture,
      disableWeather: options.disableWeather ?? (!!options.isFuture && gameIndex > 0)
    };

    const avail = availability(player, calcOptions);

    if (avail.hardOut) {
      return {
        player: playerName(player),
        pos: playerPosition(player),
        team: playerTeam(player),
        round,
        opponent,
        expected: 0,
        projection: 0,
        realisticExpected: 0,
        finalExpected: 0,
        score: 0,
        floor: 0,
        ceiling: 0,
        confidence: "High",
        confidenceScore: 95,
        base: 0,
        raw: 0,
        rawUpside: 0,
        cappedUpside: 0,
        allowedUpsideCap: 0,
        capApplied: false,
        adjustments: {
          availability: avail.label
        },
        reason: [avail.reason],
        missing: []
      };
    }

    const form = formBase(player, calcOptions);
    const role = roleAdjustment(player);
    const opp = opponentAdjustment(player, calcOptions);
    const weather = weatherAdjustment(player, calcOptions);
    const ceil = ceilingAdjustment(player);
    const value = valueAdjustment(player);
    const drift = calcOptions.isFuture ? futureRoundDriftAdjustment(gameIndex) : 0;

    const miss = missingData(player, calcOptions);
    const allowedCap = calculateAllowedUpsideCap(player, miss, calcOptions);

    const rawBeforeCap =
      form.base +
      role.adjustment +
      opp.adjustment +
      weather.adjustment +
      ceil.adjustment +
      value.adjustment +
      avail.adjustment +
      drift;

    const capped = applyUpsideCap(form.base, rawBeforeCap, allowedCap);
    const rail = sanityRails(player, capped.score);
    const expected = Math.round(rail.score);

    const high = highScore(player);

    const floor = Math.round(clamp(expected - 22, 0, expected));
    const projectedCeiling = high
      ? Math.round(clamp(expected * 0.65 + high * 0.35, expected, 135))
      : Math.round(clamp(expected + 28 + Math.max(0, ceil.adjustment), expected, 135));

    const conf = confidence(player, miss, avail, calcOptions);

    const reason = [
      `Round ${round || "current"}${opponent ? ` vs ${opponent}` : ""}`,
      `Base ${Math.round(form.base)} from ${form.baseReason}`,
      role.notes.length
        ? `Role ${role.adjustment >= 0 ? "+" : ""}${role.adjustment}: ${role.notes.join(", ")}`
        : "Role +0: no strong role adjustment",
      `Opponent ${opp.adjustment >= 0 ? "+" : ""}${opp.adjustment}: ${opp.note}`,
      `Weather ${weather.adjustment >= 0 ? "+" : ""}${weather.adjustment}: ${weather.note}`,
      `Ceiling ${ceil.adjustment >= 0 ? "+" : ""}${ceil.adjustment}: ${ceil.note}`,
      `Value ${value.adjustment >= 0 ? "+" : ""}${value.adjustment}: ${value.note}`,
      `Availability ${avail.adjustment >= 0 ? "+" : ""}${avail.adjustment}: ${avail.reason}`,
      `Upside cap: raw ${Math.round(capped.rawUpside)} capped to ${Math.round(capped.cappedUpside)} / max ${allowedCap}`
    ];

    if (calcOptions.isFuture) {
      reason.push(`Future uncertainty drift ${drift >= 0 ? "+" : ""}${drift}`);
    }

    if (capped.capApplied) {
      reason.push("Upside cap applied because missing data makes the full boost unreliable");
    }

    if (rail.notes.length) {
      reason.push(`Sanity rail applied: ${rail.notes.join(", ")}`);
    }

    return {
      player: playerName(player),
      pos: playerPosition(player),
      team: playerTeam(player),
      round,
      opponent,
      expected,
      projection: expected,
      realisticExpected: expected,
      finalExpected: expected,
      score: expected,
      floor,
      ceiling: projectedCeiling,
      confidence: conf.label,
      confidenceScore: conf.score,
      base: Math.round(form.base),
      raw: Math.round(rawBeforeCap),
      rawUpside: Math.round(capped.rawUpside),
      cappedUpside: Math.round(capped.cappedUpside),
      allowedUpsideCap: allowedCap,
      capApplied: capped.capApplied,
      adjustments: {
        role: role.adjustment,
        opponent: opp.adjustment,
        weather: weather.adjustment,
        ceiling: ceil.adjustment,
        value: value.adjustment,
        availability: avail.adjustment,
        futureDrift: drift
      },
      reason,
      missing: miss
    };
  }

  /* =========================
     FIVE GAME FORECAST
     ========================= */

  function calculateFiveGameProjection(player, options = {}) {
    const startRound = num(options.startRound, currentRound() || 1);
    const games = num(options.games, 5);
    const results = [];

    for (let i = 0; i < games; i++) {
      const round = startRound + i;
      const fixture = getFutureFixture(player, round, i);
      const opponent = upper(
        options.opponents?.[i] ||
        fixture?.opponent ||
        fixture?.opp ||
        fixture?.vs
      );

      const result = calculateLevel3Projection(player, {
        ...options,
        round,
        gameIndex: i,
        fixture,
        opponent,
        isFuture: true,
        disableWeather: i > 0
      });

      results.push(result);
    }

    const total = results.reduce((sum, row) => sum + num(row.expected, 0), 0);
    const average = games ? Math.round(total / games) : 0;
    const confidenceScore = results.length
      ? Math.round(results.reduce((sum, row) => sum + num(row.confidenceScore, 0), 0) / results.length)
      : 0;

    let confidence = "Low";
    if (confidenceScore >= 75) confidence = "High";
    else if (confidenceScore >= 58) confidence = "Medium";

    return {
      player: playerName(player),
      total,
      average,
      expected: average,
      projection: average,
      fiveGameProjectedScore: average,
      confidence,
      confidenceScore,
      games: results,
      missing: Array.from(new Set(results.flatMap((row) => row.missing || [])))
    };
  }

  /* =========================
     PUBLIC API
     ========================= */

  window.calculateLevel3Projection = calculateLevel3Projection;

  window.getProjectedScore = function (player, options = {}) {
    return calculateLevel3Projection(player, options).expected;
  };

  window.calculateFiveGameProjection = calculateFiveGameProjection;

  window.getFiveGameProjectedScore = function (player, options = {}) {
    return calculateFiveGameProjection(player, options).average;
  };

  /*
    Backwards compatibility.
    These old names can stay in your app, but they now point to the same brain.
  */
  window.calculateLevel3SourceOfTruth = calculateLevel3Projection;
  window.calculateUniversalLevel3 = calculateLevel3Projection;
  window.level3Projection = calculateLevel3Projection;

  window.currentProjected = window.getProjectedScore;
  window.currentProjectionV2 = window.getProjectedScore;
  window.baseExpectedForNext = window.getProjectedScore;

  /*
    This keeps the Realistic Projection Layer display alive,
    but makes it read from Level 3 instead of creating a rogue number.
  */
  window.realisticProjectionLayer = function (player, options = {}) {
    const result = calculateLevel3Projection(player, options);

    return {
      ...result,
      baseExpected: result.base,
      realisticExpected: result.expected,
      finalRealisticExpected: result.expected,
      cappedBonus: result.cappedUpside,
      rawBonus: result.rawUpside,
      allowedUpsideCap: result.allowedUpsideCap,
      capApplied: result.capApplied,
      confidenceLabel: result.confidence,
      parts: [
        {
          label: "Base projection",
          value: result.base,
          note: "Level 3 base before controlled upside"
        },
        {
          label: "Role / goal / ceiling / matchup",
          value: result.rawUpside,
          note: "Raw upside before missing-data cap"
        },
        {
          label: "Capped upside adjustment",
          value: result.cappedUpside,
          note: result.capApplied
            ? "Capped because missing data makes full boost unreliable"
            : "No cap needed"
        },
        {
          label: "Final Level 3 expected",
          value: result.expected,
          note: "Same projected score used everywhere"
        }
      ]
    };
  };

  /*
    5-game compatibility names.
  */
  window.fiveGameProjection = calculateFiveGameProjection;
  window.calculateFiveGameProjectedScore = calculateFiveGameProjection;
  window.calculateNextFiveProjection = calculateFiveGameProjection;
  window.getNextFiveProjectedScore = window.getFiveGameProjectedScore;

  /*
    Team helpers.
    These do not change your UI.
  */
  window.getBest17Level3 = function (players) {
    const list = Array.isArray(players)
      ? players
      : Array.isArray(window.myTeam)
        ? window.myTeam
        : [];

    return list
      .filter(Boolean)
      .map((player) => ({
        player,
        projection: window.getProjectedScore(player)
      }))
      .sort((a, b) => b.projection - a.projection)
      .slice(0, 17);
  };

  window.getTeamLevel3Projection = function (players) {
    return window.getBest17Level3(players)
      .reduce((total, row) => total + row.projection, 0);
  };

  console.log("✅ FINAL Level 3 engine loaded: one projection everywhere, 5-game forecast included, upside capped by missing data.");
})();
