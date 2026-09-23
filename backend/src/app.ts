import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { analyze, breakdown, confirmTask, editField, emptyValues, fields, level, levels, score, topics, validateProposal, type Task, type Values, type Field } from './domain.ts';
import { transaction, working, type TaskRow, type ProposalRow } from './database.ts';
import { ApiError, check, object, only, text } from './errors.ts';

export type Options = { origins?: string[]; staticDir?: string; aiName?: string; aiModel?: string; aiProvider?: (draft: string, values: Values) => Promise<string> };
const publicFiles = new Map([
  ['/', { name: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { name: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/styles.css', { name: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['/app.js', { name: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/api.js', { name: 'api.js', type: 'text/javascript; charset=utf-8' }],
]);
type Actor = { role: 'business' | 'student'; teamId?: string };
function actor(req: IncomingMessage): Actor {
  const role = req.headers['x-demo-role'];
  check(role === 'business' || role === 'student', 401, 'ROLE_REQUIRED', 'X-Demo-Role: business немесе student қажет.');
  return { role, teamId: typeof req.headers['x-team-id'] === 'string' ? req.headers['x-team-id'] : undefined };
}
function business(a: Actor) { check(a.role === 'business', 403, 'FORBIDDEN', 'Бұл әрекетті бизнес орындайды.'); }
function row(db: DatabaseSync, id: string): TaskRow {
  const r = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  check(r, 404, 'NOT_FOUND', 'Тапсырма табылмады.'); return r;
}
function revision(b: Record<string, unknown>, current: number) {
  check(Number.isInteger(b.expectedRevision), 400, 'REVISION_REQUIRED', 'expectedRevision бүтін саны қажет.');
  check(b.expectedRevision === current, 409, 'REVISION_CONFLICT', 'Мәлімет өзгерген. Қайта жүктеп көріңіз.');
}
function rating(t: Task) {
  const parts = breakdown(t); const n = score(t);
  return { score: n, level: level(n), breakdown: parts, missing: parts.filter(c => !c.earned).map(c => ({ label: c.label, points: c.weight, fields: c.keys })) };
}
function serialize(r: TaskRow, publicView = false) {
  const t: Task = JSON.parse(publicView ? r.public_snapshot! : r.working);
  return { ...t, ...(publicView ? {} : { revision: r.revision, confirmedRevision: r.confirmed_revision }), hasPublishedVersion: r.public_snapshot !== null, rating: rating(t) };
}
function proposalJSON(db: DatabaseSync, p: ProposalRow) {
  return { id: p.id, taskId: p.task_id, teamId: p.team_id, idea: p.idea, plan: p.plan, deadline: p.deadline, url: p.url, status: p.status, revision: p.revision, createdAt: p.created_at,
    completed: db.prepare('SELECT stage FROM milestones WHERE task_id = ? AND team_id = ? ORDER BY stage').all(p.task_id, p.team_id).map(x => x.stage) };
}
async function bodyJSON(req: IncomingMessage) {
  check(req.headers['content-type']?.split(';')[0].trim().toLowerCase() === 'application/json', 415, 'CONTENT_TYPE', 'Content-Type: application/json қажет.');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    check(size <= 65536, 413, 'BODY_TOO_LARGE', 'JSON көлемі 64 КБ-тан аспауы керек.');
    chunks.push(Buffer.from(chunk));
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(400, 'INVALID_JSON', 'JSON синтаксисі қате.'); }
}
export function createApp(db: DatabaseSync, options: Options = {}) {
  const origins = options.origins ?? ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'];
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    function reply(status: number, data: unknown) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
    try {
      const origin = req.headers.origin;
      if (origin) {
        check(origins.includes(origin), 403, 'ORIGIN_NOT_ALLOWED', 'Бұл frontend мекенжайына CORS рұқсаты жоқ.');
        res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Demo-Role,X-Team-Id'); res.writeHead(204); res.end(); return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost'); const path = url.pathname.replace(/\/$/, '') || '/'; const method = req.method;
      // Only the browser's public assets are served; source code, data, and configuration stay private.
      if (!url.pathname.startsWith('/api/')) {
        const file = publicFiles.get(url.pathname);
        check(options.staticDir && file && (method === 'GET' || method === 'HEAD'), 404, 'ROUTE_NOT_FOUND', 'Файл табылмады.');
        let content: Buffer;
        try { content = await readFile(resolve(options.staticDir, file.name)); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(404, 'ROUTE_NOT_FOUND', 'Файл табылмады.');
          throw error;
        }
        res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': content.length });
        res.end(method === 'HEAD' ? undefined : content); return;
      }
      if (method === 'GET' && path === '/api/health') { db.prepare('SELECT 1').get(); reply(200, { data: { status: 'ok', service: 'ai-sana-backend', aiMode: options.aiProvider ? 'provider' : 'demo', aiProvider: options.aiName || (options.aiProvider ? 'custom' : 'demo'), aiModel: options.aiModel || null, authMode: 'demo-headers' } }); return; }
      if (method === 'GET' && path === '/api/meta') { reply(200, { data: { fields, topics, levels, aiMode: options.aiProvider ? 'provider' : 'demo', stages: [{ id: 'prototype', points: 25 }, { id: 'pilot', points: 25 }] } }); return; }
      if (method === 'GET' && path === '/api/teams') {
        reply(200, { data: db.prepare('SELECT teams.*, COALESCE(SUM(milestones.points),0) AS points FROM teams LEFT JOIN milestones ON teams.id = milestones.team_id GROUP BY teams.id ORDER BY teams.name').all() }); return;
      }
      if (method === 'GET' && path === '/api/tasks') {
        const topic = url.searchParams.get('topic'); const readiness = url.searchParams.get('level');
        check(!topic || topics.includes(topic), 400, 'INVALID_FILTER', 'Белгісіз тақырып.');
        check(!readiness || levels.includes(readiness), 400, 'INVALID_FILTER', 'Белгісіз дайындық деңгейі.');
        const data = (db.prepare('SELECT * FROM tasks WHERE public_snapshot IS NOT NULL').all() as TaskRow[]).map(r => serialize(r, true))
          .filter(t => (!topic || t.topic === topic) && (!readiness || t.rating.level === readiness)).sort((a, b) => b.rating.score - a.rating.score || a.id.localeCompare(b.id));
        reply(200, { data, total: data.length }); return;
      }
      const a = actor(req);
      if (method === 'GET' && path === '/api/business/tasks') { business(a); reply(200, { data: (db.prepare('SELECT * FROM tasks ORDER BY rowid DESC').all() as TaskRow[]).map(r => serialize(r)) }); return; }
      if (method === 'POST' && path === '/api/tasks') {
        business(a); const b = await bodyJSON(req); only(b, ['draft', 'topic']);
        const draft = text(b.draft, 'draft'); const topic = text(b.topic, 'topic', 100);
        check(topics.includes(topic), 400, 'VALIDATION_ERROR', 'Тақырыпты /api/meta тізімінен таңдаңыз.');
        const t: Task = { id: randomUUID(), topic, draft, values: emptyValues(), confirmed: {}, published: false, createdAt: new Date().toISOString() };
        db.prepare('INSERT INTO tasks VALUES (?, ?, NULL, 1, NULL)').run(t.id, JSON.stringify(t)); reply(201, { data: serialize(row(db, t.id)) }); return;
      }
      const match = path.match(/^\/api\/tasks\/([^/]+)(?:\/(clarify|confirm|publish|proposals|milestones\/confirm))?$/);
      if (match) {
        const [, id, action] = match; const r = row(db, id);
        if (a.role === 'student') check(r.public_snapshot, 404, 'NOT_FOUND', 'Тапсырма табылмады.');
        if (method === 'GET' && !action) { reply(200, { data: serialize(r, a.role === 'student') }); return; }
        if (method === 'GET' && action === 'proposals') {
          let proposals: ProposalRow[];
          if (a.role === 'business') proposals = db.prepare('SELECT * FROM proposals WHERE task_id = ? ORDER BY created_at,id').all(id) as ProposalRow[];
          else { check(a.teamId, 401, 'TEAM_REQUIRED', 'X-Team-Id қажет.'); proposals = db.prepare('SELECT * FROM proposals WHERE task_id = ? AND team_id = ? ORDER BY created_at,id').all(id, a.teamId) as ProposalRow[]; }
          reply(200, { data: proposals.map(p => proposalJSON(db, p)) }); return;
        }
        if (method === 'POST' && action === 'proposals') {
          check(a.role === 'student', 403, 'FORBIDDEN', 'Ұсынысты студенттік команда жібереді.');
          check(r.public_snapshot, 409, 'NOT_PUBLISHED', 'Тапсырма жарияланбаған.');
          check(a.teamId && db.prepare('SELECT id FROM teams WHERE id = ?').get(a.teamId), 400, 'INVALID_TEAM', 'Жарамды X-Team-Id қажет.');
          const b = await bodyJSON(req); only(b, ['idea', 'plan', 'deadline', 'url']);
          const p = { idea: text(b.idea, 'idea', 5000), plan: text(b.plan, 'plan'), deadline: text(b.deadline, 'deadline', 200), url: text(b.url, 'url', 2000) };
          const invalid = validateProposal(p); check(!invalid, 400, 'VALIDATION_ERROR', invalid);
          const pid = randomUUID(); db.prepare('INSERT INTO proposals VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)').run(pid, id, a.teamId, p.idea, p.plan, p.deadline, p.url, 'pending', new Date().toISOString());
          reply(201, { data: proposalJSON(db, db.prepare('SELECT * FROM proposals WHERE id = ?').get(pid) as ProposalRow) }); return;
        }
        business(a);
        if (method === 'POST' && action === 'milestones/confirm') {
          const b = await bodyJSON(req); only(b, ['teamId', 'stage', 'evidence']);
          const teamId = text(b.teamId, 'teamId', 100); const stage = text(b.stage, 'stage', 30); const evidence = text(b.evidence, 'evidence', 5000);
          check(['prototype', 'pilot'].includes(stage), 400, 'INVALID_STAGE', 'Кезең prototype немесе pilot болуы керек.');
          const result = transaction(db, () => {
            check(db.prepare("SELECT id FROM proposals WHERE task_id = ? AND team_id = ? AND status = 'selected'").get(id, teamId), 409, 'TEAM_NOT_SELECTED', 'Алдымен осы команданың ұсынысын таңдаңыз.');
            const existing = db.prepare('SELECT * FROM milestones WHERE task_id = ? AND team_id = ? AND stage = ?').get(id, teamId, stage);
            if (existing) return { ...existing, awarded: false };
            const mid = randomUUID(); db.prepare('INSERT INTO milestones VALUES (?, ?, ?, ?, 25, ?, ?)').run(mid, id, teamId, stage, evidence, new Date().toISOString());
            return { ...db.prepare('SELECT * FROM milestones WHERE id = ?').get(mid), awarded: true };
          }); reply(result.awarded ? 201 : 200, { data: result }); return;
        }
        if ((method === 'PATCH' && !action) || (method === 'POST' && ['clarify', 'confirm', 'publish'].includes(action))) {
          const b = await bodyJSON(req);
          only(b, method === 'PATCH' ? ['expectedRevision', 'values', 'topic', 'draft'] : ['expectedRevision']);
          let ai: Awaited<ReturnType<typeof analyze>> | undefined;
          if (action === 'clarify') {
            revision(b, row(db, id).revision); const current = working(row(db, id));
            try { ai = await analyze(current.draft, current.values, options.aiProvider); }
            catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(502, 'AI_INVALID_RESPONSE', 'Көмекші жауабы жарамсыз немесе қолжетімсіз. Черновик сақталды; қайта көріңіз немесе қолмен өңдеңіз.'); }
          }
          const result = transaction(db, () => {
            const current = row(db, id); revision(b, current.revision); let t = working(current);
            let confirmedRevision: number | null = null; let publicSnapshot = current.public_snapshot;
            if (method === 'PATCH') {
              const before = JSON.stringify({ draft: t.draft, topic: t.topic, values: t.values });
              check(['values', 'topic', 'draft'].some(k => k in b), 400, 'VALIDATION_ERROR', 'Кемінде бір өзгеріс қажет.');
              if ('values' in b) { const values = object(b.values); only(values, Object.keys(fields)); for (const k of Object.keys(values) as Field[]) { const value = text(values[k], k, k === 'title' ? 200 : 10000, false); if (value !== t.values[k]) t = editField(t, k, value); } }
              if ('draft' in b) t.draft = text(b.draft, 'draft');
              if ('topic' in b) { t.topic = text(b.topic, 'topic', 100); check(topics.includes(t.topic), 400, 'VALIDATION_ERROR', 'Белгісіз тақырып.'); }
              if (t.assessment && before !== JSON.stringify({ draft: t.draft, topic: t.topic, values: t.values })) t.assessment.stale = true;
            } else if (action === 'clarify') {
              for (const k of Object.keys(fields) as Field[]) if (ai!.fields[k] !== t.values[k]) t = editField(t, k, ai!.fields[k]);
              if (ai!.assessment) t.assessment = ai!.assessment;
              else delete t.assessment;
            } else if (action === 'confirm') {
              check(t.values.title.trim(), 400, 'TITLE_REQUIRED', 'Тапсырма атауын енгізіңіз.'); t = confirmTask(t); confirmedRevision = current.revision + 1;
            } else if (action === 'publish') {
              check(current.confirmed_revision === current.revision, 409, 'CONFIRMATION_REQUIRED', 'Ағымдағы карточканы қолмен растаңыз.');
              check(t.values.title.trim(), 400, 'TITLE_REQUIRED', 'Тапсырма атауы қажет.'); t.published = true; publicSnapshot = JSON.stringify(t); confirmedRevision = current.revision + 1;
            }
            db.prepare('UPDATE tasks SET working = ?, public_snapshot = ?, revision = revision + 1, confirmed_revision = ? WHERE id = ?').run(JSON.stringify(t), publicSnapshot, confirmedRevision, id);
            return serialize(row(db, id));
          }); reply(200, { data: result, ...(ai ? { ai: { mode: options.aiProvider ? 'provider' : 'demo', questions: ai.questions, ...(ai.assessment ? { assessment: ai.assessment } : {}) } } : {}) }); return;
        }
      }
      const pm = path.match(/^\/api\/proposals\/([^/]+)$/);
      if (method === 'PATCH' && pm) {
        business(a); const b = await bodyJSON(req); only(b, ['status', 'expectedRevision']);
        check(b.status === 'selected' || b.status === 'rejected', 400, 'INVALID_STATUS', 'status: selected немесе rejected қажет.');
        const result = transaction(db, () => {
          const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(pm[1]) as ProposalRow | undefined; check(p, 404, 'NOT_FOUND', 'Ұсыныс табылмады.'); revision(b, p.revision);
          db.prepare('UPDATE proposals SET status = ?, revision = revision + 1 WHERE id = ?').run(b.status as string, p.id);
          return proposalJSON(db, db.prepare('SELECT * FROM proposals WHERE id = ?').get(p.id) as ProposalRow);
        }); reply(200, { data: result }); return;
      }
      throw new ApiError(404, 'ROUTE_NOT_FOUND', 'API жолы табылмады.');
    } catch (e) {
      if (res.writableEnded || res.destroyed) return;
      const err = e instanceof ApiError ? e : new ApiError(500, 'INTERNAL_ERROR', 'Сервер қатесі.');
      if (!(e instanceof ApiError)) console.error('[' + requestId + ']', e instanceof Error ? e.message : 'Unknown error');
      reply(err.status, { error: { code: err.code, message: err.message, requestId } });
    }
  });
}
