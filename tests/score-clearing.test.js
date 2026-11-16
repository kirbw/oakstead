const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseScoreInput } = require('../server/input');
const { schoolFixture } = require('./helpers/school');

test('score parsing distinguishes omitted, blank, invalid and legitimate zero', () => {
  assert.deepEqual(parseScoreInput(undefined, 'percent', 50), { kind: 'unchanged' });
  for (const value of ['', '  ', null]) assert.deepEqual(parseScoreInput(value, 'percent', 50), { kind: 'delete' });
  for (const value of ['bad','NaN','Infinity']) assert.deepEqual(parseScoreInput(value,'percent',50), {kind:'invalid'});
  assert.deepEqual(parseScoreInput('0','percent',50), {kind:'score',score:0});
  assert.deepEqual(parseScoreInput('0','wrong',50), {kind:'score',score:50});
  assert.deepEqual(parseScoreInput('200','percent',50), {kind:'score',score:50});
  assert.deepEqual(parseScoreInput('2','wrong',50), {kind:'score',score:48});
});

test('all score forms consistently set, omit, replace and clear scores', async (t) => {
  const app = await schoolFixture(t);
  const score = () => app.withDb(db => db.prepare('SELECT score FROM os_scores WHERE assignment_id=101 AND student_id=101').get()?.score);
  const paths = [
    { url:'/assignments',fields:{action:'scores'},key:'score_101' },
    { url:'/gradebook',fields:{},key:'score_101' },
    { url:'/gradebook',fields:{action:'grid-scores'},key:'gridscore_101_101' },
    { url:'/gradebook',fields:{action:'grid-score',studentId:'101'},key:'scoreValue' }
  ];
  for (const path of paths) {
    const post = (value, omitted=false) => app.post(path.url,{assignmentId:'101',...path.fields,...(omitted ? {} : {[path.key]:value})});
    const expected = path.fields.action === 'grid-score' ? 200 : 302;
    assert.equal((await post('90')).status, expected);
    assert.equal(score(),90);
    assert.equal((await post(undefined,true)).status,expected);
    assert.equal(score(),90);
    assert.equal((await post('0')).status,expected);
    assert.equal(score(),0);
    assert.equal((await post('bad')).status,400);
    assert.equal(score(),0);
    const cleared = await post('');
    assert.equal(cleared.status,expected);
    assert.equal(score(),undefined);
    if(expected===200) {
      const result=await cleared.json();
      assert.equal(result.percent,null);
      assert.equal(result.letter,'');
      assert.ok(Object.values(result.display).every(value=>value==='&mdash;'));
    }
  }
});

test('invalid mixed scores reject whole bulk and conventional submissions before writes', async (t) => {
  const app=await schoolFixture(t);
  app.withDb(db=>db.exec('INSERT INTO os_scores(assignment_id,student_id,score) VALUES(101,101,90),(101,103,80);'));
  const snapshot=()=>app.withDb(db=>db.prepare('SELECT assignment_id,student_id,score FROM os_scores ORDER BY assignment_id,student_id').all());
  const before=snapshot();
  for(const [url,fields] of [
    ['/gradebook',{action:'grid-scores',gridscore_101_101:'',gridscore_101_103:'bad'}],
    ['/gradebook',{assignmentId:'101',score_101:'',score_103:'bad'}],
    ['/assignments',{action:'scores',assignmentId:'101',score_101:'',score_103:'bad'}]
  ]) {
    assert.equal((await app.post(url,fields,'admin')).status,400);
    assert.deepEqual(snapshot(),before);
  }
  const count=()=>app.withDb(db=>db.prepare('SELECT COUNT(*) AS c FROM os_assignments').get().c);
  const previous=count();
  assert.equal((await app.post('/gradebook',{title:'Must not be created',maxScore:'100',score_101:'90',score_103:'invalid'},'admin')).status,400);
  assert.equal(count(),previous);
  assert.deepEqual(snapshot(),before);
});
