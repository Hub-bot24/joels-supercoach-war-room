import test from "node:test";
import assert from "node:assert/strict";

import {
  extractRows,
  extractFromMatrixTable,
  mergeWithPrevious
} from "../../scripts/update-fixtures.mjs";

// Real bug found on nrlsupercoachstats.com's draw page: the scraper was
// returning 0 fixtures from BOTH source URLs despite valid 200 responses
// with real content, silently leaving fixtures.json stuck on weeks-old
// data. Two separate structural bugs compounded:
//
// 1. The page has a stray empty <tr> immediately followed by a complete
//    <tr>...</tr> before the real header row's own closing tag. A naive
//    non-greedy "<tr...>...</tr>" regex match paired the first <tr> with
//    the wrong </tr>, silently skipping the entire Rd1..Rd27 header row.
//
// 2. Once row extraction was fixed, the header's "Team" cell turned out to
//    use colspan=2 (one <th> spanning both the code and logo columns)
//    while every data row spells that same span out as two separate
//    cells - shifting every round's data into the wrong column (round N
//    read round N-1's real opponent).
//
// This minimal synthetic table reproduces both real structural quirks
// (verified against the live captured HTML) without embedding scraped
// site content in the test suite.

// The real header-row detector requires seeing both "Rd1" and "Rd27"
// (nrlsupercoachstats.com's page is always a 27-round matrix), so the
// synthetic table below carries all 27 round columns even though only the
// first 3 columns' data actually varies per team - the rest are held on
// each team's earlier real opponent to keep the fixture minimal.
function roundHeaderCells() {
  return Array.from({ length: 27 }, (_, i) => `<th>Rd${i + 1}</th>`).join("\n");
}

function teamRowCells(code, opponents) {
  const cells = Array.from({ length: 27 }, (_, i) => `<td>${opponents[i] || "BYE"}</td>`).join("");
  return `<tr><td>${code}</td><td><img src="logo.png"></img></td>${cells}<td>${code}</td></tr>`;
}

const MATRIX_TABLE_HTML = `
<table>
<tr>
<tr><td colspan=100>Strength of Schedule</td></tr>
<th colspan=2>Team</th>
${roundHeaderCells()}
</tr>${teamRowCells("BRO", ["PTH 287", "PAR 333", "MEL(A) 281"])}
${teamRowCells("PTH", ["BRO 287", "NEW 200", "PAR(A) 150"])}
</table>
`;

test("extractRows recovers the header row despite a stray leading <tr> before a complete one", () => {
  const rows = extractRows(MATRIX_TABLE_HTML);
  const joined = rows.map(r => r.replace(/\s+/g, " ").trim());
  const headerRow = joined.find(r => r.includes("Rd1") && r.includes("Rd3"));
  assert.ok(headerRow, "expected a row containing the Rd1..Rd3 header cells");
  assert.ok(headerRow.includes("Team"), "header row should also contain the Team cell");
});

test("extractFromMatrixTable reads each round's real opponent, not the neighbouring round's", () => {
  const fixtures = extractFromMatrixTable(MATRIX_TABLE_HTML);
  const byRound = {};
  for (const f of fixtures) {
    byRound[f.round] = byRound[f.round] || [];
    byRound[f.round].push([f.homeTeam, f.awayTeam].sort().join("-"));
  }

  // Round 1: BRO v PTH (Penrith's draw code). Round 2: BRO v NEW/PAR mix per team row.
  assert.ok(byRound[1]?.includes(["BRO", "PEN"].sort().join("-")), "round 1 should pair BRO with PEN (PTH draw code)");
  assert.ok(byRound[2]?.includes(["BRO", "PAR"].sort().join("-")), "round 2 should pair BRO with PAR");
  assert.ok(!byRound[1]?.includes(["BRO", "PAR"].sort().join("-")), "round 1 must not pick up round 2's opponent");
});

test("mergeWithPrevious carries over venue/kickoff when the fresh scrape has none", () => {
  const fresh = [
    { round: 22, match: "Panthers v Raiders", homeTeam: "PEN", awayTeam: "CBR", venue: "", kickoffLocal: "", city: "", lat: null, lon: null }
  ];
  const previous = [
    { round: 22, match: "Panthers v Raiders", homeTeam: "PEN", awayTeam: "CBR", venue: "BlueBet Stadium", kickoffLocal: "2026-08-01T17:30:00", city: "Penrith", lat: -33.75, lon: 150.68, timezone: "Australia/Sydney" }
  ];

  const { fixtures, carriedOver } = mergeWithPrevious(fresh, previous);
  assert.equal(fixtures[0].venue, "BlueBet Stadium");
  assert.equal(fixtures[0].kickoffLocal, "2026-08-01T17:30:00");
  assert.equal(carriedOver.length, 1);
});

test("mergeWithPrevious does not overwrite a fresh venue with an older one", () => {
  const fresh = [
    { round: 22, match: "Panthers v Raiders", homeTeam: "PEN", awayTeam: "CBR", venue: "New Real Venue", kickoffLocal: "2026-08-01T17:30:00", city: "", lat: null, lon: null }
  ];
  const previous = [
    { round: 22, match: "Panthers v Raiders", homeTeam: "PEN", awayTeam: "CBR", venue: "Old Venue", kickoffLocal: "2026-08-01T17:30:00", city: "Old City", lat: 1, lon: 2 }
  ];

  const { fixtures, carriedOver } = mergeWithPrevious(fresh, previous);
  assert.equal(fixtures[0].venue, "New Real Venue");
  assert.equal(carriedOver.length, 0);
});

test("mergeWithPrevious leaves a fixture honestly empty when neither source nor previous file has a venue", () => {
  const fresh = [
    { round: 22, match: "Panthers v Raiders", homeTeam: "PEN", awayTeam: "CBR", venue: "", kickoffLocal: "", city: "", lat: null, lon: null }
  ];
  const previous = [
    { round: 22, match: "Panthers v Raiders", homeTeam: "PEN", awayTeam: "CBR", venue: "", kickoffLocal: "", city: "", lat: null, lon: null }
  ];

  const { fixtures, carriedOver } = mergeWithPrevious(fresh, previous);
  assert.equal(fixtures[0].venue, "");
  assert.equal(carriedOver.length, 0);
});

test("mergeWithPrevious passes fresh fixtures through untouched when there is no previous file", () => {
  const fresh = [
    { round: 1, match: "A v B", homeTeam: "A", awayTeam: "B", venue: "", kickoffLocal: "" }
  ];
  const { fixtures, carriedOver } = mergeWithPrevious(fresh, []);
  assert.deepEqual(fixtures, fresh);
  assert.equal(carriedOver.length, 0);
});
