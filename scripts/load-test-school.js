// Isolated school-sized, closed-loop mixed HTTP workload. No production URL input.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { performance } = require('node:perf_hooks');
const { startApp } = require('../tests/helpers/app');
const percentile = (a,p) => a.length ? [...a].sort((x,y)=>x-y)[Math.ceil(a.length*p)-1] : null;
const stats = a => ({count:a.length,p50Ms:percentile(a,.5),p95Ms:percentile(a,.95),maxMs:a.length?Math.max(...a):null});
const password = 'Synthetic-school-only-password';

(async()=>{
  const cleanup=[];
  let db;
  const report={date:new Date().toISOString(),runtime:process.version,platform:process.platform,hardware:{cpu:os.cpus()[0]?.model,logicalProcessors:os.cpus().length,memoryGiB:os.totalmem()/1024**3},stages:[]};
  try {
    const app=await startApp({after:fn=>cleanup.push(fn)},{demoMode:false,
      entryPoint:process.env.LOAD_PROFILE==='1'?path.join(__dirname,'profile-school-entry.js'):undefined});
    db=new DatabaseSync(app.dbFile);
    db.exec('PRAGMA foreign_keys=ON;');
    const yearId=db.prepare('SELECT id FROM os_school_years WHERE is_active=1').get().id;
    const periods=db.prepare('SELECT id,start_date FROM os_marking_periods WHERE school_year_id=? ORDER BY period_number').all(yearId);
    if(periods.length!==6)throw Error('Expected six marking periods');
    const salt=crypto.randomBytes(16).toString('hex');
    const encoded=salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
    // One shared fixture hash has identical verification cost; no hashing is timed here.
    const insert = (sql,...args) => Number(db.prepare(sql).run(...args).lastInsertRowid);
    const students=[],users=[];
    const addAssignment=db.prepare('INSERT INTO os_assignments(school_year_id,grade_level,subject_id,classroom_id,teacher_id,title,category,assignment_date,max_score,marking_period_id) VALUES(?,?,?,?,?,?,?,?,100,?)');
    const addScore=db.prepare('INSERT INTO os_scores(assignment_id,student_id,score) VALUES(?,?,?)');
    const subjects=['Math','Reading','Writing','Science','History'].map(name=>insert('INSERT INTO os_subjects(name) VALUES(?)','Load '+name));
    db.exec('BEGIN;');
    try {
      for(let grade=1;grade<=10;grade++)for(const subject of subjects)db.prepare('INSERT INTO os_grade_subjects(school_year_id,grade_level,subject_id) VALUES(?,?,?)').run(yearId,String(grade),subject);
      for(let n=0;n<50;n++){
        const grade=String(n%10+1);
        const teacherId=insert('INSERT INTO os_teachers(name) VALUES(?)',`Teacher ${n+1}`);
        const classroomId=insert('INSERT INTO os_classrooms(school_year_id,teacher_id,name) VALUES(?,?,?)',yearId,teacherId,`Classroom ${n+1}`);
        db.prepare('INSERT INTO os_classroom_grades(classroom_id,grade_level) VALUES(?,?)').run(classroomId,grade);
        const username=`school-load-${n+1}`;
        insert('INSERT INTO os_users(name,username,role,password_hash,teacher_id) VALUES(?,?,?,?,?)',`School Load Teacher ${n+1}`,username,'teacher',encoded,teacherId);
        const classroomStudents=[];
        for(let s=0;s<10;s++){
          const familyId=insert('INSERT INTO os_families(family_name) VALUES(?)',`Synthetic family ${n*10+s+1}`);
          const studentId=insert('INSERT INTO os_students(family_id,first_name,last_name) VALUES(?,?,?)',familyId,`Student ${n*10+s+1}`,'Synthetic');
          db.prepare('INSERT INTO os_student_years(student_id,school_year_id,grade_level,classroom_id) VALUES(?,?,?,?)').run(studentId,yearId,grade,classroomId);
          classroomStudents.push(studentId);students.push(studentId);
        }
        const user={username,grade,yearId,subjectId:subjects[0],periodId:periods[0].id,studentId:classroomStudents[0],expected:null};
        for(const subjectId of subjects)for(let p=0;p<periods.length;p++)for(let a=0;a<20;a++){
          const assignmentId=Number(addAssignment.run(yearId,grade,subjectId,classroomId,teacherId,`Assignment ${a+1}`,['Lesson / Homework','Quiz','Test'][a%3],p===0?new Date().toISOString().slice(0,10):periods[p].start_date,periods[p].id).lastInsertRowid);
          if(subjectId===subjects[0]&&p===0&&a===0)user.assignmentId=assignmentId;
          for(const studentId of classroomStudents)addScore.run(assignmentId,studentId,60+(studentId+a)%41);
        }
        users.push(user);
      }
      db.exec('COMMIT;');
    }catch(error){db.exec('ROLLBACK;');throw error;}
    report.fixture={teacherAccounts:50,teacherRecords:50,classrooms:50,students:students.length,subjects:subjects.length,periods:periods.length,assignments:db.prepare('SELECT COUNT(*) n FROM os_assignments').get().n,scores:db.prepare('SELECT COUNT(*) n FROM os_scores').get().n};
    console.log(JSON.stringify({fixture:report.fixture}));
    async function request(url,options={}){
      const response=await app.request(url,{...options,signal:AbortSignal.timeout(30000)});
      const text=await response.text();
      return {response,text};
    }
    async function login(user){
      const page=await request('/login');
      const token=page.text.match(/name="csrfToken" value="([^"]+)"/)[1];
      const {response}=await request('/login',{method:'POST',headers:{Cookie:`csrfToken=${token}`},body:new URLSearchParams({csrfToken:token,username:user.username,password})});
      const session=response.headers.getSetCookie().find(c=>c.startsWith('sessionToken=')&&!c.startsWith('sessionToken=;'));
      if(response.status!==302||!session)throw Error('Login status '+response.status);
      user.cookie=`csrfToken=${token}; ${session.split(';')[0]}`;user.token=token;
    }
    const seconds=Number(process.env.LOAD_STAGE_SECONDS||8);
    if(!Number.isInteger(seconds)||seconds<1||seconds>60)throw Error('LOAD_STAGE_SECONDS must be 1–60');
    const levels=(process.env.LOAD_LEVELS||'1,5,10,20,35,50,50,1').split(',').map(Number);
    const reauthEvery=Number(process.env.LOAD_REAUTH_EVERY??3);
    if(levels.some(n=>!Number.isInteger(n)||n<1||n>50)||!Number.isInteger(reauthEvery)||reauthEvery<0)throw Error('Invalid workload configuration');
    report.workload={levels,reauthEvery};
    for(const concurrency of levels){
      const times={login:[],dashboard:[],gradebook:[],save:[],health:[]};
      const errors=[];let failed=0,probeBusy=false;
      let operations=0,verified=0;
      const started=performance.now(),deadline=started+seconds*1000;
      async function measure(kind,fn){const t=performance.now();try{await fn();operations++;return true;}catch(error){failed++;if(errors.length<10)errors.push({kind,error:error.message});return false;}finally{times[kind].push(performance.now()-t);}}
      const timer=setInterval(()=>{
        if(probeBusy)return;probeBusy=true;
        measure('health',async()=>{const r=await request('/health');if(r.response.status!==200)throw Error('Health status '+r.response.status);}).finally(()=>probeBusy=false);
      },100);
      try{
        await Promise.all(users.slice(0,concurrency).map(async(user,index)=>{
          let cycle=0;
          while(performance.now()<deadline){
            // Relogin periodically so authentication overlaps other users' reads/writes.
            if((cycle===0||(reauthEvery>0&&cycle%reauthEvery===0))&&!await measure('login',()=>login(user)))break;
            if(!await measure('dashboard',async()=>{const r=await request('/',{headers:{Cookie:user.cookie}});if(r.response.status!==200||!r.text.includes(`School Load Teacher ${index+1}`))throw Error('Dashboard status/body '+r.response.status);}))break;
            if(!await measure('gradebook',async()=>{const r=await request(`/gradebook?yearId=${yearId}&grid=on&grade=${user.grade}&subjectId=${user.subjectId}&markingPeriodId=${user.periodId}&mode=percent`,{headers:{Cookie:user.cookie}});if(r.response.status!==200||!r.text.includes(`data-assignment-id="${user.assignmentId}"`)||(r.text.match(/data-grid-score-input/g)||[]).length!==200)throw Error('Gradebook status/body '+r.response.status);}))break;
            const value=50+(cycle+index)%51;
            if(!await measure('save',async()=>{const r=await request('/gradebook',{method:'POST',headers:{Cookie:user.cookie,Accept:'application/json'},body:new URLSearchParams({csrfToken:user.token,action:'grid-score',schoolYearId:yearId,gradeLevel:user.grade,subjectId:user.subjectId,markingPeriodId:user.periodId,assignmentId:user.assignmentId,studentId:user.studentId,scoreMode:'percent',scoreValue:value})});const json=JSON.parse(r.text);if(r.response.status!==200||!json.ok)throw Error('Save status/body '+r.response.status);user.expected=value;}))break;
            cycle++;
          }
        }));
      }finally{clearInterval(timer);while(probeBusy)await new Promise(r=>setTimeout(r,10));}
      for(const user of users.slice(0,concurrency))if(user.expected!==null){const stored=db.prepare('SELECT score FROM os_scores WHERE assignment_id=? AND student_id=?').get(user.assignmentId,user.studentId);if(stored?.score!==user.expected){failed++;errors.push({kind:'verification',error:'Persisted score mismatch'});}else verified++;}
      const elapsedMs=performance.now()-started;
      const stage={concurrency,targetSeconds:seconds,elapsedMs,operationsPerSecond:operations/(elapsedMs/1000),failures:failed,errors,verifiedFinalScores:verified,timings:Object.fromEntries(Object.entries(times).map(([k,v])=>[k,stats(v)]))};
      report.stages.push(stage);console.log(JSON.stringify(stage));
    }
    report.integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
    report.foreignKeyViolations=db.prepare('PRAGMA foreign_key_check').all().length;
    report.finalHealth=JSON.parse((await request('/health')).text);
    const events=app.logs().split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
    report.profile=events.filter(e=>e.event==='load.profile').at(-1);
    const serverTimes={};
    for(const event of events.filter(e=>e.event==='http.request')){
      const label=event.method+' '+event.route;
      (serverTimes[label]||=[]).push(event.durationMs);
    }
    report.serverRequestTimings=Object.fromEntries(Object.entries(serverTimes).map(([label,times])=>[label,stats(times)]));
    report.slowDatabaseOperations=events.filter(e=>e.event==='database.slow').map(({operation,durationMs,failed})=>({operation,durationMs,failed}));
    const output=path.join(__dirname,'../docs/load-tests/school-'+report.date.replace(/[:.]/g,'-')+'.json');
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({output,integrity:report.integrity,foreignKeyViolations:report.foreignKeyViolations,health:report.finalHealth}));
    if(report.stages.some(s=>s.failures)||report.integrity!=='ok'||report.foreignKeyViolations)process.exitCode=1;
  }finally{db?.close();for(const fn of cleanup.reverse())await fn();}
})().catch(error=>{console.error(error);process.exitCode=1;});
