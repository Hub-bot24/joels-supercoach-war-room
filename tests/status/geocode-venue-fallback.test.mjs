import test from "node:test";
import assert from "node:assert/strict";

import {
  geocodeVenue,
  venueMapFromJson,
  resolveFixtureVenue
} from "../../scripts/update-status.mjs";

// Real bug found via a user report: Panthers v Raiders R22 was played at Glen
// Willow Oval (Mudgee) - a real, publicly known regional venue - but it isn't
// in venues.json's static list of regular-rotation stadiums, so
// fetchOpenMeteoGameWeather had no lat/lon and weather generation failed
// entirely (weatherStatus:"source_failed") even after the venue NAME itself
// was correctly showing. Rather than hand-typing coordinates from memory
// (forbidden - no guessing at data the app displays), geocodeVenue resolves
// real coordinates via Open-Meteo's own free geocoding API, verified
// reachable and correct for Mudgee via a live diagnostic Actions run:
// {"lat":-32.59426,"lon":149.5871,"timezone":"Australia/Sydney"}.

function withMockedFetch(handler, fn){
  const original = global.fetch;
  global.fetch = handler;
  return fn().finally(() => { global.fetch = original; });
}

test("geocodeVenue parses a real Open-Meteo geocoding response into lat/lon/timezone", async () => {
  await withMockedFetch(async (url) => {
    assert.match(String(url), /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?/);
    assert.match(String(url), /name=Mudgee/);
    assert.match(String(url), /country=AU/);
    return {
      ok: true,
      text: async () => JSON.stringify({results:[{latitude:-32.59426, longitude:149.5871, timezone:"Australia/Sydney"}]})
    };
  }, async () => {
    const result = await geocodeVenue("Mudgee");
    assert.deepEqual(result, {lat:-32.59426, lon:149.5871, timezone:"Australia/Sydney"});
  });
});

test("geocodeVenue returns null when the geocoder has no match", async () => {
  await withMockedFetch(async () => ({ok:true, text: async () => JSON.stringify({results:[]})}), async () => {
    assert.equal(await geocodeVenue("Not A Real Place"), null);
  });
});

test("geocodeVenue returns null (never throws) when the request fails", async () => {
  await withMockedFetch(async () => { throw new Error("network down"); }, async () => {
    assert.equal(await geocodeVenue("Mudgee"), null);
  });
});

test("geocodeVenue returns null (never throws) on a non-ok HTTP response", async () => {
  await withMockedFetch(async () => ({ok:false, status:500, text: async () => ""}), async () => {
    assert.equal(await geocodeVenue("Mudgee"), null);
  });
});

test("geocodeVenue skips the network call entirely for an empty/missing city name", async () => {
  let called = false;
  await withMockedFetch(async () => { called = true; return {ok:true, text: async () => "{}"}; }, async () => {
    assert.equal(await geocodeVenue(""), null);
    assert.equal(await geocodeVenue(null), null);
    assert.equal(await geocodeVenue(undefined), null);
  });
  assert.equal(called, false, "geocodeVenue must not call fetch for an empty city name");
});

test("resolveFixtureVenue uses the static venues.json entry when the venue is already known", async () => {
  const venues = venueMapFromJson({venues:[{venue:"Suncorp Stadium", city:"Brisbane", lat:-27.4649, lon:153.0094, timezone:"Australia/Brisbane"}]});
  let fetchCalled = false;
  await withMockedFetch(async () => { fetchCalled = true; return {ok:true, text: async () => "{}"}; }, async () => {
    const {venue, isNew} = await resolveFixtureVenue({venue:"Suncorp Stadium", city:"Brisbane"}, venues);
    assert.equal(venue.lat, -27.4649);
    assert.equal(isNew, false);
  });
  assert.equal(fetchCalled, false, "a known venue must never trigger a geocoding lookup");
});

test("resolveFixtureVenue geocodes and marks as new when a real venue is missing from the static list", async () => {
  const venues = venueMapFromJson({venues:[]});
  await withMockedFetch(async () => ({
    ok: true,
    text: async () => JSON.stringify({results:[{latitude:-32.59426, longitude:149.5871, timezone:"Australia/Sydney"}]})
  }), async () => {
    const {venue, isNew} = await resolveFixtureVenue({venue:"Glen Willow Oval", city:"Mudgee"}, venues);
    assert.equal(isNew, true);
    assert.equal(venue.venue, "Glen Willow Oval");
    assert.equal(venue.city, "Mudgee");
    assert.equal(venue.lat, -32.59426);
    assert.equal(venue.lon, 149.5871);
    assert.equal(venue.timezone, "Australia/Sydney");
  });
  // The Map itself must also be updated so a second fixture at the same venue
  // in the same run reuses it instead of geocoding twice.
  assert.ok(venues.get("glen willow oval"));
});

test("resolveFixtureVenue does not re-geocode a fixture that already carries its own lat/lon", async () => {
  const venues = venueMapFromJson({venues:[]});
  let fetchCalled = false;
  await withMockedFetch(async () => { fetchCalled = true; return {ok:true, text: async () => "{}"}; }, async () => {
    const {venue, isNew} = await resolveFixtureVenue({venue:"Some Ground", city:"Somewhere", lat:-33.1, lon:151.2}, venues);
    assert.equal(isNew, false);
    assert.equal(venue, undefined);
  });
  assert.equal(fetchCalled, false, "a fixture that already has coordinates must not trigger a geocoding lookup");
});

test("resolveFixtureVenue leaves the venue undefined (not a thrown error) when geocoding finds nothing", async () => {
  const venues = venueMapFromJson({venues:[]});
  await withMockedFetch(async () => ({ok:true, text: async () => JSON.stringify({results:[]})}), async () => {
    const {venue, isNew} = await resolveFixtureVenue({venue:"Nowhere Oval", city:"Nowhere"}, venues);
    assert.equal(venue, undefined);
    assert.equal(isNew, false);
  });
});
