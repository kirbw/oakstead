// Rendering fixtures must not inherit a developer's local demo-mode .env.
process.env.DEMO_MODE = '0';
const { createGradeFixture } = require('./grade-fixture');
const { applyAdditiveMigrations } = require('../../server/schema');
const { createSetupRenderer } = require('../../server/setup');
const baselineSetup = require('./baseline-setup');
const { gradeRank } = require('../../server/grades');

function setupFixture({ familyCount = 1, studentCount = 8 } = {}) {
  const fixture=createGradeFixture({studentCount,subjectCount:2,assignmentCount:12});
  applyAdditiveMigrations(fixture.db);
  fixture.db.exec('BEGIN;');
  for(let id=2;id<=familyCount;id++)fixture.db.prepare('INSERT INTO os_families (id,family_name) VALUES (?,?)').run(id,`Family ${String(id).padStart(4,'0')}`);
  fixture.db.exec('COMMIT;');
  fixture.db.exec(`UPDATE os_students SET family_id=((id-1)%${familyCount})+1;`);
  let calls=[];let io={};
  const querySql=(sql)=>{calls.push(sql);return fixture.query(sql);};
  const count=(key)=>{io[key]=(io[key]||0)+1;};
  const helpers={
    querySql,
    appSettings:()=>({schoolName:'Fixture School',logoUrl:'/assets/logo',faviconUrl:'/assets/favicon',hasCustomLogo:false,hasCustomFavicon:false}),
    getSetting:(key,fallback)=>querySql(`SELECT value FROM os_settings WHERE key='${key}'`)[0]?.value||fallback,
    backupFrequency:value=>value,
    backupFrequencyLabel:value=>({manual:'Manual only',weekly:'Weekly',daily:'Daily',monthly:'Monthly'}[value]),
    networkAccessLabel:host=>host==='0.0.0.0'?'LAN access':'Local only',
    desiredNetworkConfig:()=>({host:'127.0.0.1',port:3000}),
    networkStatus:()=>{count('network');return {desired:{host:'127.0.0.1',port:3000},active:{host:'127.0.0.1',port:3000},hostName:'Fixture',addresses:[],urls:['http://127.0.0.1:3000'],desiredUrls:['http://127.0.0.1:3000'],restartRequired:false,envManaged:true};},
    listDatabaseBackups:()=>{count('backups');return [];},
    readUpdateStatus:()=>{count('updates');return {channel:'stable',log:[],running:false,percent:0,message:'No activity',phase:'idle'};},
    schoolYearHead:title=>`<h1>${title}</h1>`,
    selectedAttr:(value,selected)=>String(value||'')===String(selected||'')?'selected':'',
    csrfInput:token=>`<input name="csrfToken" value="${token}" />`,
    familyReportName:row=>row.family_name,
    firstNameOnly:value=>String(value).split(' ')[0],
    studentDisplayName:row=>`${row.first_name} ${row.last_name}`,
    genderIcon:()=>'',genderOptions:()=>'<option>Fixture</option>',gradeOptions:()=>'<option>1</option>',gradeChoices:()=>['1','2'],
    roleAssignmentRows:()=>'',roleAssignmentForm:()=>'<form>Fixture role</form>',roleOptionsForUser:()=>'<option>teacher</option>',
    roleLabel:role=>role,canManageAdminUsers:user=>user.role==='admin',isAdmin:user=>user.role==='admin',
    sortGrades:grades=>[...new Set(grades)].sort((a,b)=>gradeRank(a)-gradeRank(b)),displayCategory:value=>value,
    emptyState:text=>`<p>${text}</p>`,DEFAULT_LETTER_GRADES:[['A',90],['F',0]],CATEGORIES:['Lesson / Homework','Quiz','Test'],ROLE_ADMIN:'admin',ROLE_PRINCIPAL:'principal',ROLE_TEACHER:'teacher'
  };
  const selectedYear=fixture.db.prepare('SELECT * FROM os_school_years WHERE id=1').get();
  const before=baselineSetup(helpers),after=createSetupRenderer(helpers);
  return {...fixture,helpers,selectedYear,before,after,
    reset(){fixture.reset();calls=[];io={};},
    stats:()=>({...fixture.stats(),calls,io})};
}

module.exports = { setupFixture };
