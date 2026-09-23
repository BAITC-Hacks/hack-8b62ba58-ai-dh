import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { generateAssessment, createOpenAIProvider } from '../src/ai_service.js';
import { emptyValues } from '../src/domain.ts';
import { createApp } from '../src/app.ts';
import { openDatabase } from '../src/database.ts';

const fixture = () => ({ fields: { ...emptyValues(), title: 'Асхана', context: 'Описание задачи' }, questions: [
  { field: 'need', text: 'Какую проблему решаем?' }, { field: 'data', text: 'Какие данные доступны?' }, { field: 'success', text: 'Как измерить успех?' },
], assessment: { difficulty: 4, feedback: 'Нужен прототип. Уточните доступность данных.' } });
function completed(result = fixture()) {
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] }), { status: 200 });
}

test('OpenAI request is structured, server-only, bounded; existing user values are preserved', async () => {
  const user = { ...emptyValues(), title: 'Моё название', need: 'Сократить очередь' };
  const result = await generateAssessment('Описание задачи', user, { apiKey: 'test-key', model: 'gpt-4.1-mini', fetchImpl: async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal((options.headers as Record<string,string>).Authorization, 'Bearer test-key');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body as string);
    assert.equal(body.store, false); assert.equal(body.max_output_tokens, 3500);
    assert.equal(body.text.format.strict, true); assert.equal(body.text.format.schema.properties.questions.maxItems, 3);
    assert.equal(JSON.parse(body.input[0].content).fields.title, user.title);
    return completed();
  } });
  assert.equal(result.questions.length, 3); assert.equal(result.assessment?.difficulty, 4);
  assert.equal(result.fields.title, user.title); assert.equal(result.fields.need, user.need);
  assert.ok(!JSON.stringify(result).includes('test-key'));
});

test('API errors become safe actionable messages without upstream details or keys', async () => {
  for (const [status, upstream, expected] of [[401,'invalid_api_key','AI_AUTH_ERROR'], [403,'permission_denied','AI_ACCESS_DENIED'], [404,'model_not_found','AI_MODEL_UNAVAILABLE'], [429,'insufficient_quota','AI_QUOTA_EXCEEDED'], [429,'rate_limit_exceeded','AI_RATE_LIMIT'], [500,'server_error','AI_UPSTREAM_ERROR']] as const) {
    await assert.rejects(generateAssessment('Задача', emptyValues(), {apiKey:'test-key', fetchImpl:async()=>new Response(JSON.stringify({error:{code:upstream,message:'sensitive-test-key'}}),{status})}), (error: any) => error.code === expected && !error.message.includes('sensitive-test-key'));
  }
  await assert.rejects(generateAssessment('Задача', emptyValues(), {apiKey:'test-key', fetchImpl:async()=>{throw new DOMException('hidden details','TimeoutError');}}), {code:'AI_TIMEOUT'});
});

test('invalid assessments, incomplete answers and refusals do not become successful AI results', async () => {
  const invalids: any[] = [ {...fixture(), questions:fixture().questions.slice(0,2)}, {...fixture(), assessment:{difficulty:11,feedback:'Ошибка'}}, {...fixture(), assessment:{difficulty:3,feedback:''}}, {...fixture(), fields:null} ];
  for (const invalid of invalids) await assert.rejects(generateAssessment('Задача', emptyValues(), {apiKey:'test-key',fetchImpl:async()=>completed(invalid)}), {code:'AI_INVALID_RESPONSE'});
  for (const [payload, code] of [[{status:'incomplete',output:[]},'AI_INCOMPLETE'], [{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]},'AI_REFUSAL']] as const) {
    await assert.rejects(generateAssessment('Задача', emptyValues(), {apiKey:'test-key',fetchImpl:async()=>new Response(JSON.stringify(payload))}), {code});
  }
});

test('missing key and oversized input do not call the external service; concurrent calls are bounded', async () => {
  let calls = 0;
  const fetchImpl = async () => {calls++; return completed();};
  await assert.rejects(generateAssessment('Задача', emptyValues(), {apiKey:'',fetchImpl}), {code:'AI_NOT_CONFIGURED'});
  await assert.rejects(generateAssessment('x'.repeat(50001), emptyValues(), {apiKey:'test-key',fetchImpl}), {code:'AI_INPUT_TOO_LONG'});
  assert.equal(calls,0);
  let release!: () => void;
  const gate = new Promise<void>(resolve=>{release=resolve;});
  const provider = createOpenAIProvider({apiKey:'test-key',fetchImpl:async()=>{await gate;return completed();}});
  const pending = provider('Задача',emptyValues());
  await assert.rejects(provider('Задача',emptyValues()), {code:'AI_BUSY'});
  release(); await pending; await provider('Задача',emptyValues());
});

test('assessment survives reload/publication, stays separate from rating and is marked stale after editing', async t => {
  const db=openDatabase(':memory:');
  const server=createApp(db,{aiName:'openai',aiModel:'test-model',aiProvider:createOpenAIProvider({apiKey:'test-key',fetchImpl:async()=>completed()})});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();});
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  async function call(path:string,method='GET',body?:unknown) {
    const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Demo-Role':'business'},body:body===undefined?undefined:JSON.stringify(body)});
    const payload=await r.json(); assert.ok(r.ok,JSON.stringify(payload));return payload;
  }
  const health=(await call('/api/health')).data;
  assert.equal(health.aiProvider,'openai'); assert.ok(!JSON.stringify(health).includes('test-key'));
  let task=(await call('/api/tasks','POST',{draft:'Описание задачи',topic:'Қызмет көрсету'})).data;
  const clarified=await call('/api/tasks/'+task.id+'/clarify','POST',{expectedRevision:task.revision}); task=clarified.data;
  assert.equal(clarified.ai.questions.length,3); assert.equal(task.assessment.difficulty,4); assert.equal(task.rating.score,0);
  assert.deepEqual((await call('/api/tasks/'+task.id)).data.assessment,task.assessment);
  task=(await call('/api/tasks/'+task.id+'/confirm','POST',{expectedRevision:task.revision})).data;
  task=(await call('/api/tasks/'+task.id+'/publish','POST',{expectedRevision:task.revision})).data;
  assert.equal((await call('/api/tasks')).data.find((x:any)=>x.id===task.id).assessment.difficulty,4);
  task=(await call('/api/tasks/'+task.id,'PATCH',{expectedRevision:task.revision,values:{data:'Добавили примеры'}})).data;
  assert.equal(task.assessment.stale,true);
  assert.equal((await call('/api/tasks')).data.find((x:any)=>x.id===task.id).assessment.stale,undefined);
});
