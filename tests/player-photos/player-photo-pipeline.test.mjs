import assert from "node:assert/strict";
import test from "node:test";

import {
  photoMatchesPlayer,
  photoSlug,
  photoSourceUrls,
  reconcilePhotoRecords,
  usablePhotoRecord
} from "../../scripts/lib/player-photo-pipeline.mjs";

test("photoSourceUrls uses identity aliases", () => {
  const urls = photoSourceUrls({
    name: "Example Player",
    sourceName: "Example A Player",
    aliases: ["E Player"]
  });

  assert.deepEqual(urls, [
    "https://www.zerotackle.com/players/example-player/",
    "https://www.zerotackle.com/players/example-a-player/",
    "https://www.zerotackle.com/players/e-player/"
  ]);
});

test("photoSlug normalises accents and punctuation", () => {
  assert.equal(
    photoSlug("Joël O'Example"),
    "joel-o-example"
  );
});

test("usablePhotoRecord validates URLs", () => {
  assert.equal(
    usablePhotoRecord({
      url: "https://images.example.test/player.png"
    }),
    true
  );

  assert.equal(
    usablePhotoRecord({
      url: "not-a-url"
    }),
    false
  );
});

test("reconciliation preserves existing records", () => {
  const existingRecords = {
    "Existing Player": {
      url: "https://images.example.test/existing.png"
    },
    "Legacy Record": {
      url: "https://images.example.test/legacy.png"
    }
  };

  const result = reconcilePhotoRecords({
    players: [{ name: "Existing Player" }],
    existingRecords,
    discoveredRecords: {},
    updatedAt: "2030-01-01T00:00:00.000Z"
  });

  assert.deepEqual(result.records, existingRecords);
  assert.equal(result.audit.outputCount, 2);
});

test("valid existing photo cannot be overwritten", () => {
  const result = reconcilePhotoRecords({
    players: [{
      name: "Example Player",
      aliases: ["Example Alias"]
    }],
    existingRecords: {
      "Example Player": {
        url: "https://images.example.test/original.png"
      }
    },
    discoveredRecords: {
      "Example Alias": {
        url: "https://images.example.test/replacement.png"
      }
    },
    updatedAt: "2030-01-01T00:00:00.000Z"
  });

  assert.equal(
    result.records["Example Player"].url,
    "https://images.example.test/original.png"
  );
});

test("alias discovery is stored under canonical identity", () => {
  const result = reconcilePhotoRecords({
    players: [{
      name: "Canonical Player",
      sourceAliases: ["Source Player"]
    }],
    existingRecords: {},
    discoveredRecords: {
      "Source Player": {
        url: "https://images.example.test/new.png"
      }
    },
    updatedAt: "2030-01-01T00:00:00.000Z"
  });

  assert.equal(
    result.records["Canonical Player"].url,
    "https://images.example.test/new.png"
  );
});

test("ambiguous identities are rejected", () => {
  const result = reconcilePhotoRecords({
    players: [
      {
        name: "First Canonical",
        aliases: ["Shared Alias"]
      },
      {
        name: "Second Canonical",
        aliases: ["Shared Alias"]
      }
    ],
    existingRecords: {},
    discoveredRecords: {
      "Shared Alias": {
        url: "https://images.example.test/shared.png"
      }
    },
    updatedAt: "2030-01-01T00:00:00.000Z"
  });

  assert.deepEqual(result.records, {});
  assert.equal(result.audit.ambiguous.length, 1);
});

test("unmatched discoveries cannot create players", () => {
  const result = reconcilePhotoRecords({
    players: [{ name: "Canonical Player" }],
    existingRecords: {},
    discoveredRecords: {
      "Unknown Player": {
        url: "https://images.example.test/unknown.png"
      }
    },
    updatedAt: "2030-01-01T00:00:00.000Z"
  });

  assert.deepEqual(result.records, {});
  assert.equal(result.audit.unmatched.length, 1);
});

test("generic body-shot placeholders are rejected", () => {
  const player = {
    name: "Example Player"
  };

  assert.equal(
    photoMatchesPlayer(
      player,
      "https://source.example.test/images/body-shot.png"
    ),
    false
  );

  assert.equal(
    photoMatchesPlayer(
      player,
      "https://source.example.test/fallback/body-shot.png"
    ),
    false
  );
});

test("unrelated article images are rejected", () => {
  assert.equal(
    photoMatchesPlayer(
      {
        name: "Example Player"
      },
      "https://source.example.test/uploads/GettyImages-123456.jpg"
    ),
    false
  );
});

test("player-name evidence in the image filename is accepted", () => {
  assert.equal(
    photoMatchesPlayer(
      {
        name: "Example Player"
      },
      "https://source.example.test/assets/example-profile.png"
    ),
    true
  );
});

test("numeric-only CMS images are rejected without identity evidence", () => {
  assert.equal(
    photoMatchesPlayer(
      {
        name: "Example Player"
      },
      "https://club.example.test/img/cmsPlayer/1726.png"
    ),
    false
  );
});
