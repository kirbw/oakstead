const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createGradeFixture } = require('../tests/helpers/grade-fixture');
const { createDb } = require('../server/db');
const { loadGradeAverages } = require('../server/grades');
const { createOperationalMonitor } = require('../server/operations');

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'oakstead-metrics-benchmark-'));
const fixture=createGradeFixture();
const file=path.join(directory,'fixture.db');
fixture.db.exec(`VACUUM INTO '${file.replaceAll("'","''")}';`);
const monitor=createOperationalMonitor({log:()=>{}});
const plain=createDb({dbFile:file});
const measured=createDb({dbFile:file,onQuery:monitor.recordQuery});
try {
  const options={yearId:1,grade:'1',subjectIds:fixture.subjectIds,studentIds:fixture.studentIds,periods:fixture.periods};
  const run=db=>loadGradeAverages(db.querySql,options);
  const baseline=run(plain),instrumented=run(measured);
  assert.deepEqual(instrumented.get(1,fixture.periods[0]),baseline.get(1,fixture.periods[0]));
  const timings=[[],[]];
  for(let i=0;i<15;i++)for(const index of (i%2?[1,0]:[0,1])) {
    const start=performance.now();run(index?measured:plain);timings[index].push(performance.now()-start);
  }
  const median=values=>Number(values.sort((a,b)=>a-b)[7].toFixed(2));
  console.log(JSON.stringify({fixture:'30 students, 6 subjects, 300 assignments per subject; identical file; 15 interleaved runs',plainMedianMs:median(timings[0]),instrumentedMedianMs:median(timings[1]),measuredCalls:monitor.snapshot().database.count,expectedCalls:16*3},null,2));
} finally {plain.close();measured.close();fixture.db.close();fs.rmSync(directory,{recursive:true,force:true});}
