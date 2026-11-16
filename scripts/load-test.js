// Real HTTP/application load test. Never opens the developer's database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { performance } = require('node:perf_hooks');
const { startApp } = require('../tests/helpers/app');

const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]||0;
const stats=values=>({count:values.length,medianMs:+percentile(values,.5).toFixed(1),p95Ms:+percentile(values,.95).toFixed(1),maxMs:+Math.max(0,...values).toFixed(1)});

(async()=>{
  const cleanup=[];
  let db;
  try {
    const app=await startApp({after:fn=>cleanup.push(fn)},{demoMode:false});
    execFileSync(process.execPath,[path.join(__dirname,'seed-demo.js'),'--reset'],{env:{...process.env,DB_FILE:app.dbFile,DEMO_MODE:'0'},windowsHide:true,stdio:'pipe'});
    db=new DatabaseSync(app.dbFile);
    db.exec('PRAGMA foreign_keys=ON;');
    const teachers=db.prepare('SELECT id FROM os_teachers ORDER BY id').all();
    const password='Load-test-only-password';
    const users=Array.from({length:20},(_,i)=>{
      const teacher=teachers[i%teachers.length].id;
      const username=`load-teacher-${i+1}`;
      const salt=crypto.randomBytes(16).toString('hex');
      const hash=salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
      db.prepare('INSERT INTO os_users(name,username,role,password_hash,teacher_id) VALUES(?,?,?,?,?)').run(`Load Teacher ${i+1}`,username,'teacher',hash,teacher);
      const target=db.prepare(`SELECT a.id assignmentId,a.school_year_id yearId,a.grade_level grade,a.subject_id subjectId,a.marking_period_id periodId,sy.student_id studentId FROM os_assignments a JOIN os_classrooms c ON c.school_year_id=a.school_year_id JOIN os_classroom_grades cg ON cg.classroom_id=c.id AND cg.grade_level=a.grade_level JOIN os_student_years sy ON sy.classroom_id=c.id WHERE c.teacher_id=? AND a.marking_period_id IS NOT NULL ORDER BY a.id,sy.student_id LIMIT 1 OFFSET ?`).get(teacher,Math.floor(i/teachers.length));
      if(!target)throw Error('Missing authorized score target');
      return {username,...target};
    });
    const report={date:new Date().toISOString(),node:process.version,platform:process.platform,demoMode:false,fixture:{teacherAccounts:20,teacherRecords:teachers.length,students:db.prepare('SELECT COUNT(*) n FROM os_students').get().n,assignments:db.prepare('SELECT COUNT(*) n FROM os_assignments').get().n,scores:db.prepare('SELECT COUNT(*) n FROM os_scores').get().n},phases:[]};
    async function phase(name,work){
      const timings=[],probes=[];let failure=0,inProbe=false;
      const timer=setInterval(async()=>{if(inProbe)return;inProbe=true;const start=performance.now();try{const r=await app.request('/health',{signal:AbortSignal.timeout(30000)});await r.text();if(r.status!==200)failure++;probes.push(performance.now()-start);}catch{failure++;}finally{inProbe=false;}},50);
      const start=performance.now();
      async function measured(fn){const t=performance.now();try{await fn();}catch(e){failure++;console.error(name+': '+e.message);}finally{timings.push(performance.now()-t);}}
      try{await work(measured);}finally{clearInterval(timer);while(inProbe)await new Promise(r=>setTimeout(r,10));}
      const result={name,elapsedMs:+(performance.now()-start).toFixed(1),requests:stats(timings),healthProbes:stats(probes),failures:failure};report.phases.push(result);console.log(JSON.stringify(result));
    }
    async function login(user){
      const page=await app.request('/login',{signal:AbortSignal.timeout(30000)});
      const token=(await page.text()).match(/name="csrfToken" value="([^"]+)"/)[1];
      const response=await app.request('/login',{method:'POST',headers:{Cookie:`csrfToken=${token}`},body:new URLSearchParams({csrfToken:token,username:user.username,password}),signal:AbortSignal.timeout(30000)});
      await response.text();
      const session=response.headers.getSetCookie().find(c=>c.startsWith('sessionToken=')&&!c.startsWith('sessionToken=;'));
      if(response.status!==302||!session)throw Error('Login rejected: '+response.status);
      user.token=token;user.cookie=`csrfToken=${token}; ${session.split(';')[0]}`;
    }
    for(const count of [1,5,20])await phase(`${count} simultaneous logins`,measure=>Promise.all(users.slice(0,count).map(user=>measure(()=>login(user)))));
    await phase('20 teachers browsing: 5 dashboard/gradebook cycles each',measure=>Promise.all(users.map(async user=>{for(let cycle=0;cycle<5;cycle++)for(const url of ['/',`/gradebook?yearId=${user.yearId}&grid=on&markingPeriodId=${user.periodId}&grade=${user.grade}&subjectId=${user.subjectId}&mode=percent`])await measure(async()=>{const response=await app.request(url,{headers:{Cookie:user.cookie},signal:AbortSignal.timeout(30000)});const html=await response.text();if(response.status!==200||!html.includes('Load Teacher'))throw Error('Authenticated page failed: '+response.status);});})));
    await phase('20 simultaneous score saves',measure=>Promise.all(users.map((user,i)=>measure(async()=>{const response=await app.request('/gradebook',{method:'POST',headers:{Cookie:user.cookie,Accept:'application/json'},body:new URLSearchParams({csrfToken:user.token,action:'grid-score',schoolYearId:user.yearId,gradeLevel:user.grade,subjectId:user.subjectId,markingPeriodId:user.periodId,assignmentId:user.assignmentId,studentId:user.studentId,scoreMode:'percent',scoreValue:60+i}),signal:AbortSignal.timeout(30000)});const result=await response.json();if(response.status!==200||!result.ok)throw Error('Save failed: '+response.status);} ))));
    let verified=0;
    users.forEach((user,i)=>{const score=db.prepare('SELECT sc.score,a.max_score FROM os_scores sc JOIN os_assignments a ON a.id=sc.assignment_id WHERE sc.assignment_id=? AND sc.student_id=?').get(user.assignmentId,user.studentId);if(!score||Math.abs(score.score/score.max_score*100-(60+i))>.01)throw Error('Stored score mismatch');verified++;});
    report.verifiedScoreWrites=verified;
    const health=await app.request('/health');report.finalHealth=await health.json();
    report.integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
    report.relationshipViolations=db.prepare('PRAGMA foreign_key_check').all().length;
    fs.mkdirSync(path.join(__dirname,'../docs/load-tests'),{recursive:true});
    fs.writeFileSync(path.join(__dirname,'../docs/load-tests/latest.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({verified,health:report.finalHealth,integrity:report.integrity}));
    if(report.phases.some(p=>p.failures)||report.integrity!=='ok'||report.relationshipViolations)process.exitCode=1;
  } finally {db?.close();for(const fn of cleanup.reverse())await fn();}
})().catch(error=>{console.error(error);process.exitCode=1;});
