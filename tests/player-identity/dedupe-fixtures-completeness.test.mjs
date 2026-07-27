import test from "node:test";
import assert from "node:assert/strict";

import { dedupeFixtures } from "../../scripts/update-fixtures.mjs";

// Real bug found via a screenshot: Panthers v Raiders (R22) showed "Venue
// TBC" and "Weather unavailable" on the player card while every other R22
// fixture had a real venue. update-fixtures.mjs pulls from two source URLs
// (drawV2.php and draw.php) and used to dedupe same-fixture rows by keeping
// whichever was seen first, with no regard for which one actually had a
// venue. If one source is missing a venue for a match the other source has
// it for, that used to silently ship the worse copy.

test("dedupeFixtures keeps the first-seen entry when there is no duplicate", () => {
  const fixtures = [
    { round: 22, homeTeam: "PEN", awayTeam: "CBR", venue: "BlueBet Stadium", kickoffLocal: "2026-08-01T17:30:00" }
  ];
  const result = dedupeFixtures(fixtures);
  assert.equal(result.length, 1);
  assert.equal(result[0].venue, "BlueBet Stadium");
});

test("dedupeFixtures prefers a duplicate with a venue over an earlier duplicate missing one", () => {
  const fixtures = [
    { round: 22, homeTeam: "PEN", awayTeam: "CBR", venue: "", kickoffLocal: "2026-08-01T17:30:00" },
    { round: 22, homeTeam: "PEN", awayTeam: "CBR", venue: "BlueBet Stadium", kickoffLocal: "2026-08-01T17:30:00" }
  ];
  const result = dedupeFixtures(fixtures);
  assert.equal(result.length, 1);
  assert.equal(result[0].venue, "BlueBet Stadium");
});

test("dedupeFixtures keeps an already-complete first entry over a later, less complete duplicate", () => {
  const fixtures = [
    { round: 22, homeTeam: "PEN", awayTeam: "CBR", venue: "BlueBet Stadium", kickoffLocal: "2026-08-01T17:30:00" },
    { round: 22, homeTeam: "PEN", awayTeam: "CBR", venue: "", kickoffLocal: "" }
  ];
  const result = dedupeFixtures(fixtures);
  assert.equal(result.length, 1);
  assert.equal(result[0].venue, "BlueBet Stadium");
});

test("dedupeFixtures does not merge fixtures from different rounds even with the same teams", () => {
  const fixtures = [
    { round: 5, homeTeam: "PEN", awayTeam: "CBR", venue: "BlueBet Stadium", kickoffLocal: "2026-04-01T17:30:00" },
    { round: 22, homeTeam: "PEN", awayTeam: "CBR", venue: "", kickoffLocal: "2026-08-01T17:30:00" }
  ];
  const result = dedupeFixtures(fixtures);
  assert.equal(result.length, 2);
});

test("dedupeFixtures treats home/away order as the same real fixture", () => {
  const fixtures = [
    { round: 22, homeTeam: "PEN", awayTeam: "CBR", venue: "", kickoffLocal: "" },
    { round: 22, homeTeam: "CBR", awayTeam: "PEN", venue: "BlueBet Stadium", kickoffLocal: "2026-08-01T17:30:00" }
  ];
  const result = dedupeFixtures(fixtures);
  assert.equal(result.length, 1);
  assert.equal(result[0].venue, "BlueBet Stadium");
});
