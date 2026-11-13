const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backupDue, createBackupScheduler } = require('../server/backups');
const { schoolFixture } = require('./helpers/school');

test('backup due boundaries preserve daily, weekly, monthly and manual semantics', () => {
  const now=new Date('2026-11-13T12:00:00Z');
  for(const [frequency,days] of [['daily',1],['weekly',7],['monthly',30]]) {
    assert.equal(backupDue(frequency,'',now),true);
    assert.equal(backupDue(frequency,'invalid',now),true);
    assert.equal(backupDue(frequency,new Date(+now-days*86400000+1).toISOString(),now),false);
    assert.equal(backupDue(frequency,new Date(+now-days*86400000).toISOString(),now),true);
    assert.equal(backupDue(frequency,new Date(+now+86400000).toISOString(),now),false);
  }
  assert.equal(backupDue('manual','',now),false);
});

test('recurring checks use live settings, prevent overlap, retry failure and stop cleanly', async () => {
  let tick, cleared=false, unref=false, count=0, errors=0;
  let frequency='manual',lastAt='',now=new Date('2026-11-13T12:00:00Z');
  let fail=false, release;
  const scheduler=createBackupScheduler({
    isDue:()=>backupDue(frequency,lastAt,now),
    async createBackup(){
      count++;
      if(release===null)await new Promise(resolve=>{release=resolve;});
      if(fail)throw Error('disk full');
      lastAt=now.toISOString();
    },
    onError:()=>{errors++;},
    setIntervalFn(callback,ms){assert.equal(ms,300000);tick=callback;return {unref(){unref=true;}};},
    clearIntervalFn(){cleared=true;}
  });
  assert.equal(unref,true);
  assert.equal(await scheduler.check(),false);
  frequency='daily';tick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(count,1);
  assert.equal(await scheduler.check(),false);
  now=new Date(+now+86400000);fail=true;
  const before=lastAt;
  assert.equal(await scheduler.check(),false);assert.equal(lastAt,before);assert.equal(errors,1);
  fail=false;release=null;
  const pending=scheduler.check();
  assert.equal(await scheduler.check(),false,'overlap is skipped');
  release();assert.equal(await pending,true);
  frequency='weekly';now=new Date(+now+86400000);
  assert.equal(await scheduler.check(),false);
  scheduler.stop();assert.equal(cleared,true);
  frequency='daily';now=new Date(+now+86400000);
  assert.equal(await scheduler.check(),false);assert.equal(count,3);
});

test('failed backup metadata writes do not advance the success timestamp', async (t) => {
  const app=await schoolFixture(t);
  assert.equal((await app.post('/backup/create',{},'admin')).status,302);
  const before=app.withDb(db=>db.prepare("SELECT key,value FROM os_settings WHERE key LIKE 'backup_last_%' ORDER BY key").all());
  app.withDb(db=>db.exec("CREATE TRIGGER fixture_backup_failure BEFORE UPDATE ON os_settings WHEN NEW.key='backup_last_at' BEGIN SELECT RAISE(ABORT,'fixture metadata failure'); END;"));
  assert.equal((await app.post('/backup/create',{},'admin')).status,500);
  assert.deepEqual(app.withDb(db=>db.prepare("SELECT key,value FROM os_settings WHERE key LIKE 'backup_last_%' ORDER BY key").all()),before);
});
