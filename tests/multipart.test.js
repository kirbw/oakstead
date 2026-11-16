const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseMultipart } = require('../server/http');
const { schoolFixture } = require('./helpers/school');

function multipart(boundary, parts) {
  return Buffer.concat(parts.flatMap(({name,value,filename}) => [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename===undefined?'':`; filename="${filename}"`}\r\n\r\n`),
    Buffer.isBuffer(value) ? value : Buffer.from(value), Buffer.from('\r\n')
  ]).concat(Buffer.from(`--${boundary}--\r\n`)));
}

test('multipart text uses UTF-8 while arbitrary file bytes remain identical', () => {
  const boundary='oakstead-boundary';
  const bytes=Buffer.concat([Buffer.from([0,255,128,13,10]),Buffer.from('\r\n--oakstead-boundaryXmore\r\n'),Buffer.from([254,0])]);
  const buffer=multipart(boundary,[{name:'schoolName',value:'Colegio José 学校 🌿'},{name:'empty',value:''},{name:'logoFile',filename:'é.png',value:bytes}]);
  for(const type of [`multipart/form-data; boundary=${boundary}`,`multipart/form-data; boundary="${boundary}"`]) {
    const parsed=parseMultipart(buffer,type);
    assert.equal(parsed.schoolName,'Colegio José 学校 🌿');
    assert.equal(parsed.empty,'');
    assert.equal(parsed.logoFile.filename,'é.png');
    assert.deepEqual(parsed.logoFile.data,bytes);
    assert.equal(createHash('sha256').update(parsed.logoFile.data).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
  }
});

test('malformed multipart framing and invalid text are rejected', () => {
  const good=multipart('example',[{name:'name',value:'text'}]);
  for(const [buffer,type] of [
    [good,'multipart/form-data'],[good,'multipart/form-data; boundary=wrong'],
    [good.subarray(0,good.length-5),'multipart/form-data; boundary=example'],
    [Buffer.from('--example\r\nbroken\r\n--example--\r\n'),'multipart/form-data; boundary=example'],
    [multipart('example',[{name:'name',value:Buffer.from([255])}]),'multipart/form-data; boundary=example']
  ]) assert.throws(()=>parseMultipart(buffer,type),{statusCode:400});
});

test('real multipart settings preserve Unicode and reject malformed requests without mutation', async (t) => {
  const app=await schoolFixture(t);
  const readName=()=>app.withDb(db=>db.prepare("SELECT value FROM os_settings WHERE key='school_name'").get()?.value);
  const form=new FormData(); form.set('csrfToken','fixture');form.set('schoolName','Colegio José 学校 🌿');
  const response=await app.request('/system-settings',{method:'POST',headers:{Cookie:app.cookie('admin')},body:form});
  assert.equal(response.status,302);
  assert.equal(readName(),'Colegio José 学校 🌿');
  const bad=multipart('broken',[{name:'csrfToken',value:'fixture'},{name:'schoolName',value:'Must not save'}]).subarray(0,-8);
  const rejected=await app.request('/system-settings',{method:'POST',headers:{Cookie:app.cookie('admin'),'Content-Type':'multipart/form-data; boundary=broken'},body:bad});
  assert.equal(rejected.status,400);
  assert.equal(readName(),'Colegio José 学校 🌿');
  const png=Buffer.from([137,80,78,71,13,10,26,10,0,255,128]);
  const withImage=new FormData();withImage.set('csrfToken','fixture');withImage.set('schoolName','Colegio José 学校 🌿');withImage.set('logo',new Blob([png]),'test.png');
  assert.equal((await app.request('/system-settings',{method:'POST',headers:{Cookie:app.cookie('admin')},body:withImage})).status,302);
  assert.deepEqual(fs.readFileSync(path.join(app.directory,'uploads','logo.png')),png);
  assert.equal(readName(),'Colegio José 学校 🌿');
  const invalidImage=new FormData();invalidImage.set('csrfToken','fixture');invalidImage.set('schoolName','Colegio José 学校 🌿');invalidImage.set('logo',new Blob(['not a PNG']),'fake.png');
  assert.equal((await app.request('/system-settings',{method:'POST',headers:{Cookie:app.cookie('admin')},body:invalidImage})).status,400);
  assert.equal((await app.request('/',{headers:{Cookie:app.cookie('admin')}})).status,200);
});
