import test from "node:test";
import assert from "node:assert/strict";

import {
  combineTruth,
  fromFetchedInjuries,
  isSpecificArticleUrl,
  hasConfirmedInjuryPhrase
} from "../../scripts/update-status.mjs";

// Real bug found via a user report: a player suffered a confirmed season-ending injury
// (reported by name on a dedicated news article, e.g. "Knights confirm season-ending
// injuries for two stars"), but the card kept showing EXPECTED/yellow. The injury *was*
// captured into data/injuries.json, but fromFetchedInjuries tags every name-proximity match
// from any injury page - hub/index or dedicated article alike - as "injury_local_context_match",
// and combineTruth() unconditionally treats that tag as weak evidence and discards it (`i = null`),
// falling through to the generic "no current team-list truth" EXPECTED default. A dedicated
// article using confirmed, finality language ("ruled out for the season") near the player's name
// is materially stronger evidence than a bare mention on a broad casualty-ward listing page and
// must not be discarded the same way. This is a generic pipeline fix - no player names, clubs,
// or seasons are hardcoded; it is driven purely by URL shape (dedicated article vs. hub page)
// and reported language (confirmed finality phrases).

const HUB_URL = "https://www.zerotackle.com/nrl/injuries-suspensions/";
const ARTICLE_URL = "https://www.zerotackle.com/knights-confirm-season-ending-injury-for-test-player-236256/";

const PLAYERS = [{ name: "Test Player", team: "NEW", pos: "2RF", bye: [] }];

test("isSpecificArticleUrl distinguishes a dedicated article from the standing hub/index page", () => {
  assert.equal(isSpecificArticleUrl(ARTICLE_URL), true);
  assert.equal(isSpecificArticleUrl(HUB_URL), false);
});

test("hasConfirmedInjuryPhrase requires real finality language, not just a body-part word", () => {
  assert.equal(hasConfirmedInjuryPhrase("has been ruled out for the season with a hamstring injury"), true);
  assert.equal(hasConfirmedInjuryPhrase("is a test/monitor case with a minor hamstring niggle"), false);
});

test("a dedicated confirmed-injury article produces strong evidence, not a weak local-context match", () => {
  const page = {
    url: ARTICLE_URL,
    sourceName: "Zero Tackle",
    text: "Newcastle Knights confirm Test Player has been ruled out for the season after scans confirmed a serious hamstring injury, ending his 2026 campaign early."
  };
  const injuriesOut = {};
  fromFetchedInjuries(PLAYERS, [page], injuriesOut);
  const rec = injuriesOut["Test Player"];
  assert.ok(rec, "expected an injury record to be created");
  assert.equal(rec.displayStatus, "INJURED");
  assert.equal(rec.injuryStatus, "injury_confirmed_article_match");
  assert.equal(rec.sourcePriority, 2);
});

test("a bare mention on the broad casualty-ward hub page stays a weak local-context match", () => {
  const page = {
    url: HUB_URL,
    sourceName: "Zero Tackle",
    text: "Test Player (hamstring) is a test case this week and will be assessed at training."
  };
  const injuriesOut = {};
  fromFetchedInjuries(PLAYERS, [page], injuriesOut);
  const rec = injuriesOut["Test Player"];
  assert.ok(rec, "expected an injury record to be created");
  assert.equal(rec.injuryStatus, "injury_local_context_match");
  assert.equal(rec.sourcePriority, 1);
});

test("confirmed article evidence wins the merge over a same-run weak hub mention, regardless of fetch order", () => {
  const hubPage = {
    url: HUB_URL,
    sourceName: "Zero Tackle",
    text: "Test Player (hamstring) is a test case this week and will be assessed at training."
  };
  const articlePage = {
    url: ARTICLE_URL,
    sourceName: "Zero Tackle",
    text: "Newcastle Knights confirm Test Player has been ruled out for the season after scans confirmed a serious hamstring injury."
  };

  const hubFirst = {};
  fromFetchedInjuries(PLAYERS, [hubPage, articlePage], hubFirst);
  assert.equal(hubFirst["Test Player"].injuryStatus, "injury_confirmed_article_match");

  const articleFirst = {};
  fromFetchedInjuries(PLAYERS, [articlePage, hubPage], articleFirst);
  assert.equal(articleFirst["Test Player"].injuryStatus, "injury_confirmed_article_match");
});

test("combineTruth publishes INJURED for confirmed article evidence when no current team-list truth exists", () => {
  const injuries = {
    "Test Player": {
      displayStatus: "INJURED",
      colour: "red",
      available: false,
      reason: "Hamstring confirmed near player on injury article (Zero Tackle): Season.",
      confidence: "high",
      sources: [{ type: "injury", name: "Zero Tackle", url: ARTICLE_URL, updatedAt: new Date().toISOString() }],
      injuryStatus: "injury_confirmed_article_match",
      injuryType: "Hamstring",
      expectedReturnText: "Season",
      team: "NEW",
      teamCanonical: "NEWCASTLE",
      sourcePriority: 2
    }
  };
  const { playersOut } = combineTruth(PLAYERS, 22, {}, injuries, {}, {}, {});
  assert.equal(playersOut["Test Player"].displayStatus, "INJURED");
  assert.equal(playersOut["Test Player"].available, false);
});

test("combineTruth still discards a weak local-context-only match (no regression)", () => {
  const injuries = {
    "Test Player": {
      displayStatus: "INJURED",
      colour: "red",
      available: false,
      reason: "Hamstring context found near player on injury/casualty source page (Zero Tackle).",
      confidence: "high",
      sources: [{ type: "injury", name: "Zero Tackle", url: HUB_URL, updatedAt: new Date().toISOString() }],
      injuryStatus: "injury_local_context_match",
      injuryType: "Hamstring",
      team: "NEW",
      teamCanonical: "NEWCASTLE",
      sourcePriority: 1
    }
  };
  const { playersOut } = combineTruth(PLAYERS, 22, {}, injuries, {}, {}, {});
  assert.equal(playersOut["Test Player"].displayStatus, "EXPECTED");
  assert.equal(playersOut["Test Player"].available, true);
});
