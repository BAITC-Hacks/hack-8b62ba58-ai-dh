import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { openDatabase } from '../src/database.ts';
import { createApp, type Options } from '../src/app.ts';
import { seed } from '../src/domain.ts';
import { configuredOrigins } from '../src/config.ts';

async function setup(t: { after: (fn: () => unknown) => void }, options: Options = {}, filename = ':memory:') {
  const db = openDatabase(filename); const server = createApp(db, options); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as {port:number}).port;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); });
  const call = async (path: string, method = 'GET', body?: unknown, role = 'business', team = 'team-0', extra: Record<string,string> = {}) => {
    const r = await fetch('http://127.0.0.1:' + port + path, { method, headers: { 'Content-Type':'application/json','X-Demo-Role':role,'X-Team-Id':team,...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status:r.status, headers:r.headers, body:r.status === 204 ? null : await r.json() };
  };
  return { db, server, call, baseUrl: 'http://127.0.0.1:' + port };
}
const draft = { draft:'Университет асханасындағы кезекті азайтқымыз келеді.',topic:'Қызмет көрсету' };
const offer = {idea:'Алдын ала тапсырыс',plan:'Зерттеу, прототип, тест',deadline:'2 апта',url:'https://example.com/demo'};
test('health, seed volume, public catalog sorting and readiness filters', async t => {
  const {call}=await setup(t);
  assert.equal((await call('/api/health')).body.data.status,'ok');
  const list=await call('/api/tasks'); assert.equal(list.body.total,5);
  assert.deepEqual(list.body.data.map((x:any)=>x.rating.score),[100,90,85,65,20]);
  assert.equal((await call('/api/teams')).body.data.length,5);
  assert.equal((await call('/api/tasks?topic='+encodeURIComponent('Сауда'))).body.total,1);
  assert.equal((await call('/api/tasks?level='+encodeURIComponent('Нақтылау қажет'))).body.data[0].rating.score,20);
  assert.equal((await call('/api/tasks?topic=unknown')).status,400);
});
test('full journey: create, clarify, edit, confirm, publish and persistence format',async t=>{
  const {call}=await setup(t);
  const created=await call('/api/tasks','POST',draft); assert.equal(created.status,201);
  let task=created.body.data; const id=task.id;
  assert.equal((await call('/api/tasks/'+id,'GET',undefined,'student')).status,404);
  const clarified=await call('/api/tasks/'+id+'/clarify','POST',{expectedRevision:task.revision});
  assert.equal(clarified.status,200); assert.ok(clarified.body.ai.questions.length>=3);
  task=clarified.body.data; assert.equal(task.values.context,draft.draft); assert.equal(task.values.data,'');
  const full=seed().tasks[0].values;
  task=(await call('/api/tasks/'+id,'PATCH',{expectedRevision:task.revision,values:full})).body.data;
  assert.equal(task.rating.score,0);
  assert.equal((await call('/api/tasks/'+id+'/publish','POST',{expectedRevision:task.revision})).status,409);
  task=(await call('/api/tasks/'+id+'/confirm','POST',{expectedRevision:task.revision})).body.data;
  assert.equal(task.rating.score,100);
  task=(await call('/api/tasks/'+id+'/publish','POST',{expectedRevision:task.revision})).body.data;
  assert.equal(task.published,true);
  assert.equal((await call('/api/tasks')).body.total,6);
  assert.equal((await call('/api/tasks/'+id,'GET',undefined,'student')).body.data.rating.score,100);
});
test('unconfirmed edits stay private; reconfirmation and publishing update catalog',async t=>{
  const {call}=await setup(t);
  let task=(await call('/api/tasks/task-0')).body.data;
  task=(await call('/api/tasks/task-0','PATCH',{expectedRevision:task.revision,values:{data:'Жаңа материал'}})).body.data;
  assert.equal(task.rating.score,80);
  const student=(await call('/api/tasks/task-0','GET',undefined,'student')).body.data;
  assert.equal(student.rating.score,100); assert.notEqual(student.values.data,'Жаңа материал');
  assert.equal((await call('/api/tasks/task-0/publish','POST',{expectedRevision:task.revision})).status,409);
  task=(await call('/api/tasks/task-0/confirm','POST',{expectedRevision:task.revision})).body.data;
  await call('/api/tasks/task-0/publish','POST',{expectedRevision:task.revision});
  assert.equal((await call('/api/tasks/task-0','GET',undefined,'student')).body.data.values.data,'Жаңа материал');
});
test('stale parallel changes conflict and missing fields fail without corrupting state',async t=>{
  const {call}=await setup(t);
  const results=await Promise.all(['A','B'].map(title=>call('/api/tasks/task-0','PATCH',{expectedRevision:1,values:{title}})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await call('/api/tasks/task-0','PATCH',{values:{title:'C'}})).status,400);
  const before=(await call('/api/tasks/task-0')).body.data;
  assert.equal((await call('/api/tasks/task-0','PATCH',{expectedRevision:2,values:{score:100}})).status,400);
  assert.deepEqual((await call('/api/tasks/task-0')).body.data,before);
});
test('low rating accepts proposals, validates URL, and supports unlimited offers',async t=>{
  const {call}=await setup(t);
  assert.equal((await call('/api/tasks/task-3/proposals','POST',{...offer,url:'javascript:alert(1)'},'student')).status,400);
  assert.equal((await call('/api/tasks/task-3/proposals','POST',{...offer,idea:''},'student')).status,400);
  const a=await call('/api/tasks/task-3/proposals','POST',offer,'student');
  const b=await call('/api/tasks/task-3/proposals','POST',offer,'student');
  assert.equal(a.status,201);assert.equal(b.status,201);assert.notEqual(a.body.data.id,b.body.data.id);
  assert.equal((await call('/api/tasks/task-3/proposals','GET',undefined,'student')).body.data.length,2);
});
test('business chooses multiple teams or none; students cannot select or edit',async t=>{
  const {call}=await setup(t);
  assert.equal((await call('/api/proposals/proposal-0','PATCH',{expectedRevision:1,status:'selected'},'student')).status,403);
  assert.equal((await call('/api/tasks/task-0','PATCH',{expectedRevision:1,values:{title:'hack'}},'student')).status,403);
  for(const id of ['proposal-0','proposal-1'])assert.equal((await call('/api/proposals/'+id,'PATCH',{expectedRevision:1,status:'selected'})).status,200);
  let offers=(await call('/api/tasks/task-0/proposals')).body.data;
  assert.equal(offers.filter((p:any)=>p.status==='selected').length,2);
  for(const p of offers)await call('/api/proposals/'+p.id,'PATCH',{expectedRevision:p.revision,status:'rejected'});
  offers=(await call('/api/tasks/task-0/proposals')).body.data;
  assert.equal(offers.filter((p:any)=>p.status==='selected').length,0);
});
test('milestones require selection and are idempotent in concurrent requests and across offers',async t=>{
  const {call}=await setup(t);
  const event={teamId:'team-0',stage:'prototype',evidence:'Прототип көрсетіліп, бизнес тексерді.'};
  assert.equal((await call('/api/tasks/task-0/milestones/confirm','POST',event)).status,409);
  await call('/api/proposals/proposal-0','PATCH',{expectedRevision:1,status:'selected'});
  const results=await Promise.all([call('/api/tasks/task-0/milestones/confirm','POST',event),call('/api/tasks/task-0/milestones/confirm','POST',event)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
  const duplicate=(await call('/api/tasks/task-0/proposals','POST',offer,'student')).body.data;
  await call('/api/proposals/'+duplicate.id,'PATCH',{expectedRevision:1,status:'selected'});
  assert.equal((await call('/api/tasks/task-0/milestones/confirm','POST',event)).body.data.awarded,false);
  const teams=(await call('/api/teams')).body.data;assert.equal(teams.find((x:any)=>x.id==='team-0').points,25);
  assert.equal((await call('/api/tasks/task-0/milestones/confirm','POST',{...event,stage:'fake'})).status,400);
});
test('AI errors leave draft and revision unchanged',async t=>{
  const {call}=await setup(t,{aiProvider:async()=>'{bad JSON'});
  const before=(await call('/api/tasks','POST',draft)).body.data;
  const result=await call('/api/tasks/'+before.id+'/clarify','POST',{expectedRevision:before.revision});
  assert.equal(result.status,502); assert.equal(result.body.error.code,'AI_INVALID_RESPONSE');
  assert.deepEqual((await call('/api/tasks/'+before.id)).body.data,before);
});
test('CORS, role requirements, unknown fields and empty values',async t=>{
  const {call}=await setup(t);
  assert.equal((await call('/api/tasks','POST',draft,'')).status,401);
  assert.equal((await call('/api/business/tasks','GET',undefined,'student')).status,403);
  assert.equal((await call('/api/tasks','POST',{...draft,draft:''})).status,400);
  assert.equal((await call('/api/tasks','POST',{...draft,rating:100})).status,400);
  assert.equal((await call('/api/tasks','GET',undefined,'business','team-0',{Origin:'https://evil.example'})).status,403);
  const cors=await call('/api/tasks','OPTIONS',undefined,'business','team-0',{Origin:'http://localhost:5173'});
  assert.equal(cors.status,204);assert.equal(cors.headers.get('access-control-allow-origin'),'http://localhost:5173');
});
test('database persists across connections and seed never duplicates',async ()=>{
  const folder=mkdtempSync(resolve(tmpdir(),'ai-sana-test-')); const filename=resolve(folder,'test.sqlite');
  try {
    let db=openDatabase(filename);
    db.prepare("UPDATE proposals SET status = 'selected' WHERE id = 'proposal-0'").run();
    db.close(); db=openDatabase(filename);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()!.n,5);
    assert.equal(db.prepare("SELECT status FROM proposals WHERE id = 'proposal-0'").get()!.status,'selected');db.close();
  } finally { rmSync(folder,{recursive:true,force:true}); }
});

test('frontend assets support GET and HEAD without exposing private files', async t => {
  const folder = mkdtempSync(resolve(tmpdir(), 'ai-sana-static-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const files = [
    ['index.html', '<!doctype html><title>Challenge Hub</title>', 'text/html'],
    ['styles.css', 'body { color: black; }', 'text/css'],
    ['app.js', 'console.log("frontend");', 'text/javascript'],
    ['api.js', 'export const api = {};', 'text/javascript'],
  ];
  for (const [name, content] of files) writeFileSync(resolve(folder, name), content);
  writeFileSync(resolve(folder, '.env'), 'PRIVATE_VALUE=must-not-leak');
  writeFileSync(resolve(folder, 'package.json'), '{"private":true}');
  const { baseUrl } = await setup(t, { staticDir: folder });
  for (const [name, content, type] of files) {
    const response = await fetch(baseUrl + '/' + name);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.startsWith(type));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), content);
    const head = await fetch(baseUrl + '/' + name, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(content));
    assert.equal(await head.text(), '');
  }
  assert.equal(await (await fetch(baseUrl + '/')).text(), files[0][1]);
  for (const path of ['/.env', '/package.json', '/data/ai-sana.sqlite', '/src/server.ts', '/backend/src/server.ts', '/api.js.map', '/%2e%2e/backend/.env', '/%2f..%2f.env', '/styles.css/']) {
    const response = await fetch(baseUrl + path);
    assert.equal(response.status, 404, path);
    assert.equal((await response.json()).error.code, 'ROUTE_NOT_FOUND', path);
  }
  assert.equal((await fetch(baseUrl + '/index.html', { method: 'POST' })).status, 404);
  assert.equal((await fetch(baseUrl + '/api/health')).status, 200);
});

test('API-only mode does not serve frontend and missing assets return 404', async t => {
  const apiOnly = await setup(t);
  assert.equal((await fetch(apiOnly.baseUrl + '/')).status, 404);
  const folder = mkdtempSync(resolve(tmpdir(), 'ai-sana-empty-static-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const emptyStatic = await setup(t, { staticDir: folder });
  assert.equal((await fetch(emptyStatic.baseUrl + '/app.js')).status, 404);
});

test('configured same-origin browser writes and custom origins work; hostile Host grants no CORS access', async t => {
  const origins: string[] = [];
  const { call, baseUrl } = await setup(t, { origins });
  const port = Number(new URL(baseUrl).port);
  origins.push(...configuredOrigins('127.0.0.1', port, 'https://frontend.example'));
  for (const origin of [baseUrl, 'http://localhost:' + port, 'https://frontend.example']) {
    const response = await call('/api/tasks', 'POST', draft, 'business', 'team-0', { Origin: origin });
    assert.equal(response.status, 201, origin);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
  }
  const blocked = await call('/api/tasks', 'POST', draft, 'business', 'team-0', { Origin: 'https://hostile.example', Host: 'hostile.example' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  assert.equal((await call('/api/tasks', 'OPTIONS', undefined, 'business', 'team-0', { Origin: 'https://hostile.example' })).status, 403);
  assert.ok(configuredOrigins('127.0.0.1', 4000).includes('http://localhost:5173'));
  assert.ok(!configuredOrigins('127.0.0.1', 4000, '').includes('http://localhost:5173'));
  assert.ok(configuredOrigins('::1', 4000, '').includes('http://[::1]:4000'));
  assert.ok(!configuredOrigins('0.0.0.0', 4000, '').includes('http://0.0.0.0:4000'));
});
