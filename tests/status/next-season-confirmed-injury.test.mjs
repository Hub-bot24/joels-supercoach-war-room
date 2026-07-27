import test from "node:test";
import assert from "node:assert/strict";

import {
  fromFetchedInjuries,
  hasConfirmedInjuryPhrase
} from "../../scripts/update-status.mjs";

// Real bug found via a live-data comparison across two players named in the exact same confirmed
// injury article ("Knights confirm season-ending injuries for two stars"): one player's paragraph
// said "ruled out for the season" and was correctly promoted to strong/confirmed evidence, but the
// other player's paragraph said "next season" instead and stayed a weak local-context match -
// same article, same confirmation, different (very common) NRL reporting phrasing. The confirmed-
// phrase list was missing "next season" even though injuryReturnMetaFromRecord already treats it as
// a specific, meaningful signal elsewhere (see next-season-return-text.test.mjs). This is a generic
// phrase-coverage gap, not a per-player fix: no names/clubs are hardcoded, and the fix benefits
// every player whose confirmed article uses this phrasing.

const ARTICLE_URL = "https://www.zerotackle.com/knights-confirm-season-ending-injuries-for-two-stars-236256/";

const ROSTER = [
  { name: "Test Player Alpha", team: "NEW", pos: "2RF" },
  { name: "Test Player Beta", team: "NEW", pos: "HFB" }
];

test("hasConfirmedInjuryPhrase recognizes 'next season' as confirmed, not just 'season-ending'", () => {
  assert.equal(hasConfirmedInjuryPhrase("has been ruled out for the season with a hamstring injury"), true);
  assert.equal(hasConfirmedInjuryPhrase("will need surgery on his knee and is unlikely to play again until next season"), true);
});

test("two players in the same confirmed article both get promoted, even with different confirmed phrasing", () => {
  const page = {
    url: ARTICLE_URL,
    sourceName: "Zero Tackle",
    text:
      "Knights confirm season-ending injuries for two stars. " +
      "Test Player Alpha has been ruled out for the season with a serious hamstring tear. " +
      "Test Player Beta will need knee surgery and is not expected to play again until next season."
  };
  const injuriesOut = {};
  fromFetchedInjuries(ROSTER, [page], injuriesOut);

  const alpha = injuriesOut["Test Player Alpha"];
  assert.ok(alpha, "expected a record for Test Player Alpha");
  assert.equal(alpha.injuryStatus, "injury_confirmed_article_match");

  const beta = injuriesOut["Test Player Beta"];
  assert.ok(beta, "expected a record for Test Player Beta");
  assert.equal(beta.injuryStatus, "injury_confirmed_article_match");
  assert.equal(beta.expectedReturnText, "Next season");
});
