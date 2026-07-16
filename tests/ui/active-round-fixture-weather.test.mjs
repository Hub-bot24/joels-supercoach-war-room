import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync("index.html", "utf8");

function functionBlock(name,nextName){
 const start=index.indexOf(`function ${name}(`);
 const end=index.indexOf(`function ${nextName}(`,start);

 assert.notEqual(start,-1,`${name} must exist`);
 assert.notEqual(end,-1,`${nextName} must exist`);

 return index.slice(start,end);
}

test("active fixture selection follows generated App.round",()=>{
 const active=functionBlock(
  "activeFixtureForPlayer",
  "getPlayerNextWeather"
 );

 assert.match(
  active,
  /Number\(round\|\|App\.round\|\|0\)/
 );

 assert.match(active,/activeWeatherFixtureForPlayer/);

 assert.match(
  active,
  /flattenFixtures\(App\.fixtures\|\|\[\]\)/
 );

 assert.doesNotMatch(active,/Date\.now\(/);
});

test("weather remains attached to the selected active round",()=>{
 const weather=functionBlock(
  "activeWeatherFixtureForPlayer",
  "activeFixtureForPlayer"
 );

 assert.match(
  weather,
  /fixtureRoundValue\(match\)===selectedRound/
 );

 const selector=functionBlock(
  "getPlayerNextWeather",
  "weatherHours"
 );

 assert.match(
  selector,
  /activeWeatherFixtureForPlayer\(player,round\)/
 );

 assert.doesNotMatch(selector,/Date\.now\(/);
 assert.doesNotMatch(selector,/t>=now/);
});

test("projection engine uses the central fixture selector",()=>{
 assert.match(
  index,
  /fixtureForRound\(p,round=App\.round\)\{return activeFixtureForPlayer\(p,round\)\}/
 );
});

test("premium player card displays opponent venue kickoff and weather",()=>{
 assert.match(
  index,
  /function playerCardNextGameHtml\(player\)/
 );

 assert.match(index,/playerCardNextGameHtml\(p\)/);
 assert.match(index,/data-player-card-next-game="1"/);

 assert.match(
  index,
  /match\.venue\|\|\s*match\.stadium\|\|\s*match\.ground/
 );

 assert.match(
  index,
  /weatherIconFromMatch\(weatherMatch\)/
 );

 assert.match(index,/tempSummary\(weatherMatch\)/);
 assert.match(index,/rainSummary\(weatherMatch\)/);
 assert.match(index,/windSummary\(weatherMatch\)/);
});

test("current-round selectors never advance from wall-clock time",()=>{
 const start=index.indexOf("function fixtureRoundValue");
 const end=index.indexOf("function weatherHours",start);

 assert.notEqual(start,-1);
 assert.notEqual(end,-1);

 const block=index.slice(start,end);

 assert.doesNotMatch(block,/Date\.now\(/);
 assert.doesNotMatch(block,/t\s*>=\s*now/);
});

test("player card markup contains no replacement placeholders",()=>{
 const start=index.indexOf(
  "window.openPlayerCard = function"
 );

 const end=index.indexOf(
  "function filterTradeOptions",
  start
 );

 assert.notEqual(start,-1);
 assert.notEqual(end,-1);

 const card=index.slice(start,end);

 assert.doesNotMatch(card,/\$1|\$2/);

 assert.match(
  card,
  /\$\{stat\("Season", pr\.seasonAvg \|\| avg \|\| "-"\)\}/
 );

 assert.match(
  card,
  /\$\{playerCardNextGameHtml\(p\)\}/
 );

 assert.match(
  card,
  /padding:11px 13px;color:#e5edf8/
 );
});
