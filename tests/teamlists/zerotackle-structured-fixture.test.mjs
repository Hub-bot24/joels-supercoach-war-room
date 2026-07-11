import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseTeamSectionsFromPage,
  fromKnownPlayerJerseyPatterns,
  fromFetchedTeamlists,
  stripHtmlLite,
  normName,
  playerTeam,
  lineupRoleForIndex
} from '../../scripts/update-status.mjs';

const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);

const fixturePath = path.resolve(
  thisDir,
  '../fixtures/zerotackle-structured-teamlist.html'
);

const html = fs.readFileSync(fixturePath, 'utf8');

function stripHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tableBlock(className) {
  const pattern = new RegExp(
    `<div[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>` +
    `([\\s\\S]*?)</table>\\s*</div>`,
    'i'
  );

  const match = html.match(pattern);

  assert.ok(
    match,
    `Expected structured table ${className}`
  );

  return match[1];
}

function parseHomeRows(block) {
  const rows = [];

  const pattern =
    /<tr>\s*<td[^>]*>\s*(\d{1,2})\s*<\/td>\s*<td[^>]*>[\s\S]*?<span[^>]*class=["']show-mobile["'][^>]*>([\s\S]*?)<\/span>/gi;

  let match;

  while ((match = pattern.exec(block))) {
    rows.push({
      jersey: Number(match[1]),
      name: stripHtml(match[2])
    });
  }

  return rows;
}

function parseAwayRows(block) {
  const rows = [];

  const pattern =
    /<tr>\s*<td[^>]*>[\s\S]*?<span[^>]*class=["']show-mobile["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/td>\s*<td[^>]*>\s*(\d{1,2})\s*<\/td>/gi;

  let match;

  while ((match = pattern.exec(block))) {
    rows.push({
      name: stripHtml(match[1]),
      jersey: Number(match[2])
    });
  }

  return rows;
}

function withLineupPlacement(rows) {
  return rows.map((row, index) => {
    const lineupIndex = index + 1;

    let lineupRole = 'extended';

    if (lineupIndex <= 13) {
      lineupRole = 'starter';
    } else if (lineupIndex <= 17) {
      lineupRole = 'interchange';
    }

    return {
      ...row,
      lineupIndex,
      lineupRole
    };
  });
}

test('fixture contains isolated home and away tables', () => {
  assert.match(html, /teamlist-players-home/i);
  assert.match(html, /teamlist-position/i);
  assert.match(html, /teamlist-players-away/i);
});

test('home and away snapshots each contain at least 17 ordered rows', () => {
  const home = parseHomeRows(
    tableBlock('teamlist-players-home')
  );

  const away = parseAwayRows(
    tableBlock('teamlist-players-away')
  );

  assert.ok(home.length >= 17, `Home rows: ${home.length}`);
  assert.ok(away.length >= 17, `Away rows: ${away.length}`);
});

test('lineup placement is separate from jersey number', () => {
  const home = withLineupPlacement(
    parseHomeRows(tableBlock('teamlist-players-home'))
  );

  const away = withLineupPlacement(
    parseAwayRows(tableBlock('teamlist-players-away'))
  );

  const bronsonXerri = home.find(
    row => row.name === 'Bronson Xerri'
  );

  assert.deepEqual(
    bronsonXerri,
    {
      name: 'Bronson Xerri',
      jersey: 19,
      lineupIndex: 4,
      lineupRole: 'starter'
    }
  );

  const jedStuart = away.find(
    row => row.name === 'Jed Stuart'
  );

  assert.deepEqual(
    jedStuart,
    {
      name: 'Jed Stuart',
      jersey: 21,
      lineupIndex: 5,
      lineupRole: 'starter'
    }
  );
});

test('first 17 ordered rows form one complete playable snapshot', () => {
  const snapshots = [
    withLineupPlacement(
      parseHomeRows(tableBlock('teamlist-players-home'))
    ),
    withLineupPlacement(
      parseAwayRows(tableBlock('teamlist-players-away'))
    )
  ];

  for (const snapshot of snapshots) {
    const playable = snapshot.slice(0, 17);

    assert.equal(playable.length, 17);

    assert.deepEqual(
      playable.map(row => row.lineupIndex),
      Array.from({ length: 17 }, (_, index) => index + 1)
    );

    assert.equal(
      playable.filter(row => row.lineupRole === 'starter').length,
      13
    );

    assert.equal(
      playable.filter(row => row.lineupRole === 'interchange').length,
      4
    );

    assert.equal(
      new Set(playable.map(row => row.name)).size,
      17
    );
  }
});
test('production parser module imports without executing main', () => {
  assert.equal(typeof parseTeamSectionsFromPage, 'function');
  assert.equal(typeof fromKnownPlayerJerseyPatterns, 'function');
  assert.equal(typeof fromFetchedTeamlists, 'function');
  assert.equal(typeof stripHtmlLite, 'function');
  assert.equal(typeof normName, 'function');
  assert.equal(typeof playerTeam, 'function');
  assert.equal(typeof lineupRoleForIndex, 'function');
});
test('production parser preserves isolated structured snapshots', () => {
  const homeRows = withLineupPlacement(
    parseHomeRows(tableBlock('teamlist-players-home'))
  );

  const awayRows = withLineupPlacement(
    parseAwayRows(tableBlock('teamlist-players-away'))
  );

  // Fixture-only identities. These are not production overrides.
  const players = [
    ...homeRows.map(row => ({
      name: row.name,
      team: 'CANTERBURY'
    })),
    ...awayRows.map(row => ({
      name: row.name,
      team: 'CANBERRA'
    }))
  ];

  const page = {
    url: 'https://www.zerotackle.com/updated-team-lists-bulldogs-raiders-10396471-235780',
    sourceName: 'Zero Tackle',
    html,
    text: stripHtmlLite(html)
  };

  const teamlistsOut = {};

  fromFetchedTeamlists(
    players,
    [page],
    teamlistsOut
  );

  function verifySnapshot(teamCanon, expectedRows) {
    const expectedPlayable = expectedRows.slice(0, 17);

    for (const expected of expectedPlayable) {
      const actual = teamlistsOut[expected.name];

      assert.ok(
        actual,
        `${teamCanon}: missing ${expected.name}`
      );

      assert.equal(
        actual.teamCanonical,
        teamCanon,
        `${expected.name}: wrong team`
      );

      assert.equal(
        actual.jersey,
        expected.jersey,
        `${expected.name}: wrong jersey`
      );

      assert.equal(
        actual.lineupRole,
        expected.lineupRole,
        `${expected.name}: wrong lineup role`
      );

      assert.equal(
        actual.lineupIndex,
        expected.lineupIndex,
        `${expected.name}: wrong lineup position`
      );
    }
  }

  verifySnapshot('CANTERBURY', homeRows);
  verifySnapshot('CANBERRA', awayRows);
});