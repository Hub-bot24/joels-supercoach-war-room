import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeHtmlEntities,
  extractJsonObjectsWithMarker,
  applyNrlVenues
} from "../../scripts/update-fixtures.mjs";

// Real gap found via a screenshot + a Google search the user did themselves:
// nrlsupercoachstats.com's round-by-opponent matrix has no venue column at
// all - it never has - so Panthers v Raiders (R22) showed "Venue TBC" even
// though the real venue (Glen Willow Oval, Mudgee) is publicly known and
// published on the official NRL draw pages. Those pages embed each match as
// an HTML-entity-encoded JSON object (not a __NEXT_DATA__ script tag) -
// verified against the live page via a diagnostic Actions run. These tests
// use a minimal synthetic reconstruction of that real structure, not
// embedded scraped site content.

test("decodeHtmlEntities turns the real encoding nrl.com uses back into valid JSON syntax", () => {
  const encoded = '{&quot;venue&quot;:&quot;Glen Willow Oval&quot;,&quot;team&quot;:&quot;Cowboys &amp; Co&quot;}';
  const decoded = decodeHtmlEntities(encoded);
  assert.equal(decoded, '{"venue":"Glen Willow Oval","team":"Cowboys & Co"}');
  assert.doesNotThrow(() => JSON.parse(decoded));
});

test("extractJsonObjectsWithMarker finds match objects without needing to know their container tag", () => {
  const encoded = `<div data-widget-props="{&quot;matches&quot;:[{&quot;isCurrentRound&quot;:true,&quot;roundTitle&quot;:&quot;Round 22&quot;,&quot;type&quot;:&quot;Match&quot;,&quot;venue&quot;:&quot;Cbus Super Stadium&quot;,&quot;venueCity&quot;:&quot;Gold Coast&quot;,&quot;homeTeam&quot;:{&quot;nickName&quot;:&quot;Titans&quot;},&quot;awayTeam&quot;:{&quot;nickName&quot;:&quot;Warriors&quot;}},{&quot;isCurrentRound&quot;:true,&quot;roundTitle&quot;:&quot;Round 22&quot;,&quot;type&quot;:&quot;Match&quot;,&quot;venue&quot;:&quot;Glen Willow Oval&quot;,&quot;venueCity&quot;:&quot;Mudgee&quot;,&quot;homeTeam&quot;:{&quot;nickName&quot;:&quot;Panthers&quot;},&quot;awayTeam&quot;:{&quot;nickName&quot;:&quot;Raiders&quot;}}]}"></div>`;

  const decoded = decodeHtmlEntities(encoded);
  const objs = extractJsonObjectsWithMarker(decoded, '"type":"Match"');

  assert.equal(objs.length, 2);
  assert.equal(objs[0].homeTeam.nickName, "Titans");
  assert.equal(objs[0].venue, "Cbus Super Stadium");
  assert.equal(objs[1].homeTeam.nickName, "Panthers");
  assert.equal(objs[1].awayTeam.nickName, "Raiders");
  assert.equal(objs[1].venue, "Glen Willow Oval");
  assert.equal(objs[1].venueCity, "Mudgee");
});

test("extractJsonObjectsWithMarker returns nothing when the marker never appears", () => {
  const decoded = '{"matches":[{"type":"ByeRound","roundTitle":"Round 12"}]}';
  const objs = extractJsonObjectsWithMarker(decoded, '"type":"Match"');
  assert.equal(objs.length, 0);
});

test("applyNrlVenues fills a fixture's venue/city only when it's currently missing", () => {
  const fixtures = [
    { round: 22, homeTeam: "PEN", awayTeam: "CBR", venue: "", city: "" },
    { round: 22, homeTeam: "BRO", awayTeam: "NEW", venue: "Suncorp Stadium", city: "Brisbane" }
  ];
  const nrlVenuesByKey = new Map([
    ["22|CBR-PEN", { round: 22, homeTeam: "PEN", awayTeam: "CBR", venue: "Glen Willow Oval", venueCity: "Mudgee" }],
    ["22|BRO-NEW", { round: 22, homeTeam: "BRO", awayTeam: "NEW", venue: "Some Other Venue", venueCity: "Somewhere" }]
  ]);

  const { fixtures: result, filled } = applyNrlVenues(fixtures, nrlVenuesByKey);

  assert.equal(filled, 1);
  assert.equal(result[0].venue, "Glen Willow Oval");
  assert.equal(result[0].city, "Mudgee");
  // Already had a real venue - must not be overwritten by the NRL lookup.
  assert.equal(result[1].venue, "Suncorp Stadium");
  assert.equal(result[1].city, "Brisbane");
});

test("applyNrlVenues leaves a fixture alone when NRL has no matching round+pairing either", () => {
  const fixtures = [{ round: 22, homeTeam: "PEN", awayTeam: "CBR", venue: "", city: "" }];
  const { fixtures: result, filled } = applyNrlVenues(fixtures, new Map());
  assert.equal(filled, 0);
  assert.equal(result[0].venue, "");
});

test("applyNrlVenues matches home/away in either order for the same real fixture", () => {
  const fixtures = [{ round: 22, homeTeam: "CBR", awayTeam: "PEN", venue: "", city: "" }];
  const nrlVenuesByKey = new Map([
    ["22|CBR-PEN", { round: 22, homeTeam: "PEN", awayTeam: "CBR", venue: "Glen Willow Oval", venueCity: "Mudgee" }]
  ]);
  const { fixtures: result, filled } = applyNrlVenues(fixtures, nrlVenuesByKey);
  assert.equal(filled, 1);
  assert.equal(result[0].venue, "Glen Willow Oval");
});
