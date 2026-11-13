const { test } = require('node:test');
const assert = require('node:assert/strict');
const { average, numericValue } = require('../server/averages');
const { schoolFixture } = require('./helpers/school');

test('averages exclude missing values before conversion and preserve legitimate zeroes', () => {
  assert.equal(average([90,null,null,null,null,null]),90);
  assert.equal(average([90,0]),45);
  assert.equal(average([null,undefined,'',' ',NaN,Infinity,-Infinity,'bad']),null);
  assert.equal(average(['90','0']),45);
  assert.equal(average([0,null]),0);
  assert.equal(numericValue(null),null);
});

test('staff and parent graphs agree with report cards and do not plot ungraded zeroes', async (t) => {
  const app=await schoolFixture(t);
  const read=async (url,role='admin')=>{
    const response=await app.request(url,{headers:{Cookie:app.cookie(role)}});
    assert.equal(response.status,200);return response.text();
  };
  app.withDb(db=>db.exec('INSERT INTO os_scores (assignment_id,student_id,score) VALUES (101,101,90)'));
  for(const [url,role] of [
    ['/reports?report=grade-graph&yearId=1&grade=1&scope=student&studentId=101','admin'],
    ['/parent?yearId=1&studentId=101','parent']
  ]) {
    const html=await read(url,role);
    assert.match(html,/Final Average 90\.0%/);
    assert.doesNotMatch(html,/Final Average 15\.0%/);
    const math=html.match(/<h3>Math<\/h3>[\s\S]*?<\/section>/)[0];
    assert.equal((math.match(/<circle /g)||[]).length,1,'only the graded period is plotted');
  }
  const card=await read('/report-cards?yearId=1&grade=1&studentId=101&markingPeriodId=1');
  assert.match(card,/<tr><td>90<\/td>(?:<td><\/td>){5}<td class="average-col">90<\/td><\/tr>/);
  app.withDb(db=>db.exec('UPDATE os_scores SET score=0 WHERE assignment_id=101'));
  assert.match(await read('/parent?yearId=1&studentId=101','parent'),/Final Average 0\.0%/);
  app.withDb(db=>db.exec('DELETE FROM os_scores'));
  const empty=await read('/parent?yearId=1&studentId=101','parent');
  assert.match(empty,/Final Average &mdash;/);
  assert.doesNotMatch(empty,/Final Average 0\.0%/);
});
