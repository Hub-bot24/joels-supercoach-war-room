import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index=fs.readFileSync("index.html","utf8");

function activeRenderer(){
 const start=index.lastIndexOf("function renderBye(){");
 const end=index.indexOf(
  "function explorerStatusCategory(",
  start
 );

 assert.notEqual(start,-1);
 assert.ok(end>start);

 return index.slice(start,end);
}

test("premium Bye Planner styles are scoped",()=>{
 assert.match(index,/id="premium-bye-planner-styles"/);
 assert.match(index,/#bye \.bye-planner-shell/);
 assert.match(index,/#bye \.bye-round-card/);
 assert.match(index,/#bye \.bye-action/);
});

test("Bye Planner uses premium decision cards",()=>{
 const renderer=activeRenderer();

 assert.match(renderer,/class="bye-planner-shell"/);
 assert.match(renderer,/class="bye-round-grid"/);
 assert.match(renderer,/class="bye-round-card/);
 assert.match(renderer,/class="bye-score-ring"/);
 assert.match(renderer,/class="bye-stat-grid"/);
 assert.match(renderer,/class="bye-action/);
});

test("Bye Planner keeps legal squad calculations",()=>{
 const renderer=activeRenderer();

 assert.match(
  renderer,
  /legalStarterCover\(playable\)/
 );

 assert.match(
  renderer,
  /Math\.min\(4,remaining\.length\)/
 );

 assert.match(
  renderer,
  /const target=major\?13:18/
 );

 assert.match(
  renderer,
  /legal\.missing\.length\+\s*reserveShort/
 );
});

test("Bye Planner preserves true-bye isolation",()=>{
 const renderer=activeRenderer();

 assert.match(
  renderer,
  /playerByeRounds\.includes\(Number\(r\)\)/
 );

 assert.match(
  renderer,
  /if\(k==='bye'&&!trueBye\)/
 );

 assert.match(renderer,/\.\.\.buckets\.available/);
 assert.match(renderer,/\.\.\.buckets\.risk/);
});

test("Bye Planner shows decision information",()=>{
 const renderer=activeRenderer();

 assert.match(renderer,/Legal coverage/);
 assert.match(renderer,/Recommended action/);
 assert.match(renderer,/Playable/);
 assert.match(renderer,/Unavailable/);
 assert.match(renderer,/Selection risk/);
});

test("Bye Planner includes responsive layouts",()=>{
 assert.match(index,/@media\(max-width:1050px\)/);
 assert.match(index,/@media\(max-width:680px\)/);
});

test("old generic active Bye Planner cards are removed",()=>{
 const renderer=activeRenderer();

 assert.doesNotMatch(
  renderer,
  /<div class="result" style="margin-bottom:14px"/
 );

 assert.doesNotMatch(
  renderer,
  /<div class="metric \$\{shortfall/
 );
});


test("active Bye Planner contains valid template delimiters",()=>{
 const renderer=activeRenderer();

 assert.doesNotMatch(renderer,/\\`/);
 assert.doesNotMatch(renderer,/\\\$\{/);

 assert.match(
  renderer,
  /const pill=\(item,cls\)=>`/
 );

 assert.match(
  renderer,
  /\$\('bye'\)\.innerHTML=`/
 );
});
