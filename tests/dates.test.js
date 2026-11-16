const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { cleanDate, addDays, daysBetween, schoolDateRange } = require('../server/dates');
const { schoolFixture } = require('./helpers/school');
const { recentSchoolDays } = require('../server/dates');

test('dashboard school-day labels retain UTC ordering across weekends and year boundaries', () => {
  for (const now of ['2026-01-01T00:30:00Z','2026-11-15T23:30:00Z','2026-03-09T01:30:00Z']) {
    const days = recentSchoolDays(7, new Date(now));
    assert.equal(days.length, 7);
    assert.deepEqual(days.map(d=>d.key), days.map(d=>d.key).sort());
    for (const day of days) {
      const date = new Date(day.key+'T00:00:00Z');
      assert.notEqual(date.getUTCDay(), 0);assert.notEqual(date.getUTCDay(), 6);
      assert.equal(day.label, date.toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'}));
    }
  }
});

test('date-only validation and inclusive arithmetic handle leap/year/DST boundaries', () => {
  for(const value of ['2026-02-29','2026-02-30','2026-13-01','2026-00-01','0000-01-01','2026-01-01x','bad']) assert.equal(cleanDate(value),'',value);
  assert.equal(cleanDate('2024-02-29'),'2024-02-29');
  assert.equal(addDays('2024-02-28',1),'2024-02-29');
  assert.equal(addDays('2024-02-29',1),'2024-03-01');
  assert.equal(addDays('2026-12-31',1),'2027-01-01');
  assert.equal(addDays('2026-01-01',-1),'2025-12-31');
  assert.equal(addDays('2026-08-15',0),'2026-08-15');
  assert.equal(daysBetween('2026-03-07','2026-03-09'),3);
  assert.equal(daysBetween('2026-10-31','2026-11-02'),3);
  assert.equal(daysBetween('2026-01-01','2026-01-01'),1);
  assert.equal(daysBetween('2026-01-02','2026-01-01'),0);
  assert.deepEqual(schoolDateRange('',''),{startDate:'',endDate:''});
  assert.throws(()=>schoolDateRange('2026-02-30',''),{statusCode:400});
  assert.throws(()=>schoolDateRange('2026-08-15','2026-06-01'),{statusCode:400});
});

test('date calculations return identical results in all supported timezone fixtures', () => {
  const source=`const {addDays,daysBetween}=require('./server/dates'); console.log(JSON.stringify([
    addDays('2026-08-15',0),addDays('2026-03-07',2),addDays('2026-09-26',2),
    addDays('2026-12-31',1),daysBetween('2026-03-07','2026-03-09'),daysBetween('2026-09-26','2026-09-28')
  ]));`;
  const outputs=['UTC','America/New_York','Pacific/Auckland'].map(TZ=>{
    const result=spawnSync(process.execPath,['-e',source],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,TZ},encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  });
  for(const output of outputs) assert.deepEqual(output,['2026-08-15','2026-03-09','2026-09-28','2027-01-01',3,3]);
});

test('invalid year dates reject before activation, enrollment, period or assignment changes', async (t) => {
  const app=await schoolFixture(t);
  const snapshot=()=>app.withDb(db=>({
    years:db.prepare('SELECT * FROM os_school_years ORDER BY id').all(),
    periods:db.prepare('SELECT * FROM os_marking_periods ORDER BY id').all(),
    enrollments:db.prepare('SELECT * FROM os_student_years ORDER BY id').all(),
    assignments:db.prepare('SELECT * FROM os_assignments ORDER BY id').all()
  }));
  const before=snapshot();
  for(const url of ['/school-years','/promote-year','/marking-periods']) {
    for(const dates of [{startDate:'2026-02-30',endDate:'2026-06-01'},{startDate:'2026-08-15',endDate:'2026-06-01'}]) {
      const response=await app.post(url,{yearId:'1',fromYearId:'1',name:'Invalid',makeActive:'1',periodCount:'6',...dates},'admin');
      assert.equal(response.status,400,url);
      assert.deepEqual(snapshot(),before);
    }
  }
  const saved=await app.post('/marking-periods',{periodCount:'6',schoolDays:'180',startDate:'2025-08-15',endDate:'2026-05-31'},'admin');
  assert.equal(saved.status,302);
  assert.deepEqual(snapshot().periods,before.periods);
  assert.deepEqual(snapshot().assignments,before.assignments);
});
