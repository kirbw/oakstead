const assert = require('node:assert/strict');
const { setupFixture } = require('../tests/helpers/setup-fixture');

const fixture=setupFixture({familyCount:400,studentCount:1200});
const normalize=html=>html.replace(/\s+/g,' ').replace(/> </g,'><').trim();
function measure(render,url) {
  render(fixture.selectedYear,'fixture',url,{role:'admin'});
  const timings=[];let stats;
  for(let i=0;i<15;i++) {
    fixture.reset();const start=performance.now();
    render(fixture.selectedYear,'fixture',url,{role:'admin'});
    timings.push(performance.now()-start);stats=fixture.stats();
  }
  timings.sort((a,b)=>a-b);
  return {queries:stats.queries,rows:stats.rows,io:{...stats.io},medianMs:Number(timings[7].toFixed(2))};
}
try {
  const results={fixture:'400 families, 1200 students; in-memory SQLite; identical stable helper/IO fixtures; 15 measured runs after warmup'};
  for(const section of ['network','settings','families']) {
    const url=new URL(`http://localhost/setup?section=${section}`);
    assert.equal(normalize(fixture.before(fixture.selectedYear,'fixture',url,{role:'admin'})),normalize(fixture.after(fixture.selectedYear,'fixture',url,{role:'admin'})));
    results[section]={before:measure(fixture.before,url),after:measure(fixture.after,url)};
  }
  console.log(JSON.stringify(results,null,2));
} finally {fixture.db.close();}
