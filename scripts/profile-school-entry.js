// Disposable-load-test entry point only; never used by normal startup.
const path = require('node:path');
const inspector = require('node:inspector');
const database = require('../server/db');
const originalCreate = database.createDb;
const queries = new Map();
database.createDb = options => {
  const db = originalCreate(options);
  const query = db.querySql;
  db.querySql = sql => {
    const key = String(sql).replace(/'[^']*'/g, '?').replace(/\b\d+(?:\.\d+)?\b/g, '?').replace(/\s+/g, ' ').trim();
    let entry = queries.get(key);
    if (!entry) {
      let plan = [];
      if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
        try { plan = query('EXPLAIN QUERY PLAN '+sql).map(row=>row.detail); } catch {}
      }
      entry = {sql:key,count:0,totalMs:0,rows:0,plan};queries.set(key,entry);
    }
    const start = performance.now();
    try { const rows = query(sql);entry.rows+=rows.length;return rows; }
    finally { entry.count++;entry.totalMs+=performance.now()-start; }
  };
  return db;
};
const session = new inspector.Session();
session.connect();
const post = method => new Promise((resolve,reject)=>session.post(method,(error,result)=>error?reject(error):resolve(result)));
const cpu = new Map();
let sampling = false;
require('../server').createApplication().start().then(async()=>{
  await post('Profiler.enable');await post('Profiler.start');
  setInterval(async()=>{
    if(sampling)return;sampling=true;
    try {
      const {profile} = await post('Profiler.stop');
      for(const node of profile.nodes){
        const frame=node.callFrame;
        const key=`${frame.functionName||'(anonymous)'} ${path.basename(frame.url)}:${frame.lineNumber+1}`;
        cpu.set(key,(cpu.get(key)||0)+(node.hitCount||0));
      }
      console.log(JSON.stringify({event:'load.profile',queries:[...queries.values()].sort((a,b)=>b.totalMs-a.totalMs).slice(0,25),cpu:[...cpu].sort((a,b)=>b[1]-a[1]).slice(0,20)}));
      await post('Profiler.start');
    }finally{sampling=false;}
  },2000).unref();
}).catch(error=>{console.error(error);process.exitCode=1;});
