import test from "node:test";
import assert from "node:assert/strict";

import {
  fromFetchedInjuries,
  localWindowAroundNameScoped
} from "../../scripts/update-status.mjs";

// Real bug found while verifying the confirmed-article-evidence fix in production: a "club
// confirms season-ending injuries for two stars"-style article names two different injured
// players close together. The evidence window used to be a fixed radius around a player's name
// with no idea that a second real player's paragraph sat right next to it, so one player's body
// part, confirmation language, and return timeline could bleed into the other player's record -
// observed live as a player's injuryType flip-flopping between "Hamstring" and "Ankle" across two
// runs of the exact same article. The fix scopes each player's evidence window to stop at the
// nearest mention of any other real player (from the full roster), so paragraphs never mix. This
// is generic - roster-driven, not any specific player's name.

const ARTICLE_TEXT =
  "Knights confirm season-ending injuries for two stars. " +
  "Test Player One has been ruled out for the season with a serious hamstring tear suffered at " +
  "training on Monday afternoon following a routine fitness session. " +
  "Test Player Two will miss two weeks with a minor ankle sprain and is expected to return in " +
  "round 24 for the finals push.";

const ROSTER = [
  { name: "Test Player One", team: "NEW", pos: "2RF" },
  { name: "Test Player Two", team: "NEW", pos: "CTR" }
];

test("a player's evidence window stops at the next real player's name and does not include their paragraph", () => {
  const windowOne = localWindowAroundNameScoped(ARTICLE_TEXT, "Test Player One", ROSTER);
  assert.match(windowOne, /hamstring/i);
  assert.match(windowOne, /ruled out for the season/i);
  assert.doesNotMatch(windowOne, /ankle sprain/i);
  assert.doesNotMatch(windowOne, /two weeks/i);

  const windowTwo = localWindowAroundNameScoped(ARTICLE_TEXT, "Test Player Two", ROSTER);
  assert.match(windowTwo, /ankle sprain/i);
  assert.doesNotMatch(windowTwo, /hamstring/i);
  assert.doesNotMatch(windowTwo, /ruled out for the season/i);
});

test("fromFetchedInjuries attributes the right body part and confirmation status to each player in a shared article", () => {
  const page = {
    url: "https://www.zerotackle.com/knights-confirm-season-ending-injuries-for-two-stars-236256/",
    sourceName: "Zero Tackle",
    text: ARTICLE_TEXT
  };
  const injuriesOut = {};
  fromFetchedInjuries(ROSTER, [page], injuriesOut);

  const one = injuriesOut["Test Player One"];
  assert.ok(one, "expected a record for Test Player One");
  assert.equal(one.injuryType, "Hamstring");
  assert.equal(one.injuryStatus, "injury_confirmed_article_match");

  const two = injuriesOut["Test Player Two"];
  assert.ok(two, "expected a record for Test Player Two");
  assert.equal(two.injuryType, "Ankle");
  // Player Two has no season-ending language in their own paragraph, so this must stay a
  // weak/local-context match, not get promoted to confirmed just because the shared article
  // uses season-ending language for the other player.
  assert.equal(two.injuryStatus, "injury_local_context_match");
});
