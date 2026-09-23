export const fields = {
  title: 'Тапсырма атауы', context: 'Контекст', need: 'Қажеттілік / мәселе', users: 'Пайдаланушылар',
  data: 'Деректер мен материалдар', constraints: 'Шектеулер', result: 'Күтілетін нәтиже', success: 'Сәттілік критерийлері', contact: 'Байланыс', interaction: 'Өзара жұмыс форматы',
} as const;
export type Field = keyof typeof fields;
export type Values = Record<Field, string>;
export type Task = { id: string; topic: string; draft: string; values: Values; confirmed: Partial<Values>; published: boolean; createdAt: string };
export type Team = { id: string; name: string; interests: string; skills: string; technologies: string };
export type Proposal = { id: string; taskId: string; teamId: string; idea: string; plan: string; deadline: string; url: string; status: 'pending' | 'selected' | 'rejected'; completed: string[] };
export type Hub = { version: 1; tasks: Task[]; teams: Team[]; proposals: Proposal[] };
export const topics = ['Білім', 'Қызмет көрсету', 'Экология', 'Сауда', 'Ауыл шаруашылығы'];
export const emptyValues = (): Values => Object.fromEntries(Object.keys(fields).map(k => [k, ''])) as Values;
export const criteria: { label: string; weight: number; keys: Field[] }[] = [
  { label: 'Контекст пен қажеттілік', weight: 20, keys: ['context', 'need'] },
  { label: 'Деректер мен материалдар', weight: 20, keys: ['data'] },
  { label: 'Күтілетін нәтиже', weight: 15, keys: ['result'] },
  { label: 'Сәттілік критерийлері', weight: 15, keys: ['success'] },
  { label: 'Шектеулер', weight: 10, keys: ['constraints'] },
  { label: 'Пайдаланушылар', weight: 10, keys: ['users'] },
  { label: 'Байланыс және жұмыс форматы', weight: 10, keys: ['contact', 'interaction'] },
];
export function breakdown(t: Task) {
  return criteria.map(c => ({ ...c, earned: c.keys.every(k => t.values[k].trim() && t.confirmed[k] === t.values[k]) ? c.weight : 0 }));
}
export function score(t: Task) { return breakdown(t).reduce((sum, c) => sum + c.earned, 0); }
export function level(n: number) { return n < 40 ? 'Нақтылау қажет' : n < 70 ? 'Жұмысқа жарамды' : n < 90 ? 'Дайын' : 'Басым'; }
export const levels = ['Нақтылау қажет', 'Жұмысқа жарамды', 'Дайын', 'Басым'];
export function editField(t: Task, k: Field, value: string): Task {
  const confirmed = { ...t.confirmed }; delete confirmed[k];
  return { ...t, values: { ...t.values, [k]: value }, confirmed };
}
export function confirmTask(t: Task): Task { return { ...t, confirmed: { ...t.values } }; }
export function validURL(s: string) { try { return ['https:', 'http:'].includes(new URL(s).protocol); } catch { return false; } }
export function validateProposal(p: Pick<Proposal, 'idea' | 'plan' | 'deadline' | 'url'>) {
  if (![p.idea, p.plan, p.deadline, p.url].every(s => s.trim())) return 'Ұсыныстың барлық өрісін толтырыңыз.';
  if (!validURL(p.url)) return 'Прототипке жарамды http:// немесе https:// сілтемесін енгізіңіз.';
  return '';
}
export function awardStage(p: Proposal, stage: string): Proposal {
  if (p.status !== 'selected') throw new Error('Алдымен команданы таңдаңыз.');
  if (!['prototype', 'pilot'].includes(stage)) throw new Error('Белгісіз кезең.');
  return p.completed.includes(stage) ? p : { ...p, completed: [...p.completed, stage] };
}
export function stageCompleted(h: Hub, p: Proposal, stage: string) { return h.proposals.some(x => x.taskId === p.taskId && x.teamId === p.teamId && x.completed.includes(stage)); }
export function awardHubStage(h: Hub, proposalId: string, stage: string): Hub {
  const p = h.proposals.find(x => x.id === proposalId);
  if (!p || p.status !== 'selected') throw new Error('Алдымен команданы таңдаңыз.');
  if (!['prototype', 'pilot'].includes(stage)) throw new Error('Белгісіз кезең.');
  if (stageCompleted(h, p, stage)) return h;
  return { ...h, proposals: h.proposals.map(x => x.id === p.id ? awardStage(x, stage) : x) };
}
export function teamPoints(h: Hub, id: string) { return new Set(h.proposals.filter(p => p.teamId === id).flatMap(p => p.completed.map(s => `${p.taskId}:${s}`))).size * 25; }
export const AI_PROMPT = `Сен бизнес тапсырмаларын нақтылайсың. Тек пайдаланушы берген ақпаратты қолдан. input: {draft: string, fields: object}. output: {fields: object, questions: [{field: string, text: string}]}. Тек берілген өрістерді пайдалан. Жетіспейтін мәліметке кемінде үш сұрақ қой. Белгісіз мәнді бос қалдыр. Факт ойдан қоспа. Команда таңдама.`;
const questions: Record<Field, string> = {
  title: 'Тапсырмаға қандай қысқа атау бересіз?', context: 'Қазір процесс қалай жүреді және мәселе қашан туындайды?',
  need: 'Нақты нені өзгерту немесе жақсарту керек?', users: 'Шешімді кімдер пайдаланады?',
  data: 'Қандай деректер, мысалдар немесе материалдар бар? Қолжетімділігі қандай?',
  constraints: 'Мерзім, технология, бюджет немесе қолжетімділік бойынша қандай шектеулер бар?',
  result: 'Команда жұмысының соңында қандай нақты нәтиже күтесіз?',
  success: 'Нәтиженің сәтті екенін қандай санмен немесе өлшеммен тексересіз?',
  contact: 'Команда кіммен және қалай байланыса алады?', interaction: 'Кеңес пен кері байланыс қандай форматта, қаншалықты жиі беріледі?',
};
export type AIResult = { fields: Values; questions: { field: Field; text: string }[] };
export function demoAnalyze(draft: string, values = emptyValues()): AIResult {
  if (!draft.trim()) throw new Error('Алдымен мәселені сипаттаңыз.');
  const result = { ...values };
  // Labelled lines are copied verbatim; free prose is preserved as context, never inferred as facts.
  for (const k of Object.keys(fields) as Field[]) {
    const line = draft.split('\n').find(line => line.toLocaleLowerCase().startsWith(fields[k].toLocaleLowerCase() + ':'));
    if (line && !result[k]) result[k] = line.slice(line.indexOf(':') + 1).trim();
  }
  if (!result.context) result.context = draft.trim();
  const missing = (Object.keys(fields) as Field[]).filter(k => !result[k].trim());
  const selected = [...missing];
  for (const k of ['success', 'data', 'constraints'] as Field[]) if (selected.length < 3 && !selected.includes(k)) selected.push(k);
  const subject = /асхана|кезек/i.test(draft) ? 'Асханадағы кезек туралы: ' : '';
  return { fields: result, questions: selected.map(k => ({ field: k, text: result[k] ? `${fields[k]} мәліметін нақтылап, тексеріңіз.` : subject + questions[k] })) };
}
export function parseAIResponse(raw: string): AIResult {
  const value = JSON.parse(raw);
  if (!value || typeof value.fields !== 'object' || !Array.isArray(value.questions) || value.questions.length < 3) throw new Error('ИИ жауабының форматы жарамсыз. Мәліметтеріңіз сақталды. Қайта көріңіз.');
  if (!(Object.keys(fields) as Field[]).every(k => typeof value.fields[k] === 'string') || !value.questions.every((q: {field: string; text: string}) => q && Object.hasOwn(fields, q.field) && typeof q.text === 'string' && q.text.trim())) throw new Error('ИИ жауабында жарамсыз өрістер бар.');
  return { fields: Object.fromEntries(Object.keys(fields).map(k => [k, value.fields[k]])) as Values, questions: value.questions };
}
export async function analyze(draft: string, values: Values, provider?: (draft: string, values: Values) => Promise<string>) {
  const raw = provider ? await provider(draft, values) : JSON.stringify(demoAnalyze(draft, values));
  return parseAIResponse(raw);
}
export function seed(): Hub {
  const examples = [
    ['Асханадағы кезекті азайту', 'Қызмет көрсету', 'Университет асханасындағы кезекті азайтқымыз келеді.', 'Түскі үзілісте студенттер 20 минутқа дейін күтеді.', 'Тапсырысты алдын ала қабылдау', 'Студенттер мен асхана қызметкерлері', 'Жеке мәліметсіз 2 апталық тапсырыс кестесі', '4 апта, тек синтетикалық деректер', 'Алдын ала тапсырыс беру прототипі', 'Сынақта орташа күту уақытын 20%-ға қысқарту', 'Асхана үйлестірушісі: canteen@example.com', 'Аптасына бір онлайн кеңес'],
    ['Студент сұрақтарына AI көмекші', 'Білім', 'Оқу бөліміне жиі қойылатын сұрақтарға жауап беретін көмекші керек.', 'Оқу бөлімі күн сайын бірдей сұрақтарға жауап береді.', 'Қайталанатын сұрақтарды азайту', 'Бірінші курс студенттері', '50 сұрақтан тұратын синтетикалық FAQ', '3 апта, қазақ тілінде', 'FAQ чат-прототипі', '20 тест сұрағының кемінде 16-сына дұрыс жауап', '', ''],
    ['Қалдықтарды сұрыптау картасы', 'Экология', 'Кампуста қалдық қабылдау нүктелерін табу қиын.', 'Қабылдау орындары әр корпуста орналасқан.', 'Жақын қабылдау орнын табу', 'Студенттер мен қызметкерлер', '5 нүктенің синтетикалық координаталары', '', 'Нүктелер көрсетілген интерактивті карта', '', '', ''],
    ['Шағын дүкеннің сұранысын болжау', 'Сауда', 'Дүкендегі тауар қорын жоспарлауға көмектесіңіз.', 'Кейбір тауарлар артық қалып қояды.', 'Қорды тиімді жоспарлау', '', '', '', '', '', '', ''],
    ['Суару кестесін жоспарлау', 'Ауыл шаруашылығы', 'Жылыжайға суару кестесін жасау керек.', 'Суару уақыты қолмен белгіленеді.', 'Су шығынын азайту', 'Жылыжай қызметкерлері', 'Синтетикалық ылғалдылық өлшемдері', '2 апта, датчик сатып алу қажет емес', 'Суару кестесінің прототипі', '', 'Үйлестіруші: farm@example.com', 'Аптасына бір кездесу'],
  ];
  const tasks = examples.map((e, i) => {
    const values: Values = { title: e[0], context: e[3], need: e[4], users: e[5], data: e[6], constraints: e[7], result: e[8], success: e[9], contact: e[10], interaction: e[11] };
    return { id: `task-${i}`, topic: e[1], draft: e[2], values, confirmed: { ...values }, published: true, createdAt: `2026-09-${20 + i}T09:00:00Z` };
  });
  const teams = ['Qadam AI', 'Sana Lab', 'Nomad Code', 'JasTech', 'Data Dala'].map((name, i) => ({ id: `team-${i}`, name, interests: topics[i], skills: ['Деректерді талдау', 'UX және зерттеу', 'Веб-әзірлеу', 'ML және Python', 'Аналитика'][i], technologies: ['Python, React', 'Figma, TypeScript', 'React, Node.js', 'Python, FastAPI', 'SQL, Python'][i] }));
  const proposals: Proposal[] = teams.map((t, i) => ({ id: `proposal-${i}`, taskId: i < 3 ? 'task-0' : `task-${i}`, teamId: t.id, idea: ['Алдын ала тапсырыс қабылдайтын веб-қосымша', 'Кезек ұзақтығын көрсететін қарапайым панель', 'Тапсырыс уақытын таңдауға арналған прототип', 'Тауар сұранысының апталық болжамы', 'Ылғалдылыққа негізделген суару кестесі'][i], plan: '1. Мәселені нақтылау. 2. Прототип жасау. 3. Бизнеспен бірге тексеру.', deadline: '3 апта', url: `https://example.com/prototype-${i + 1}`, status: 'pending', completed: [] }));
  return { version: 1, tasks, teams, proposals };
}
export function parseStore(raw: string): Hub {
  const h = JSON.parse(raw);
  if (h?.version !== 1 || !Array.isArray(h.tasks) || !Array.isArray(h.teams) || !Array.isArray(h.proposals)) throw new Error('Сақталған деректер оқылмады.');
  if (!h.tasks.every((t: Task) => typeof t.id === 'string' && typeof t.draft === 'string' && typeof t.topic === 'string' && typeof t.published === 'boolean' && t.confirmed && Object.keys(fields).every(k => typeof t.values?.[k as Field] === 'string'))) throw new Error('Тапсырма деректері жарамсыз.');
  if (!h.teams.every((t: Team) => ['id', 'name', 'interests', 'skills', 'technologies'].every(k => typeof t[k as keyof Team] === 'string'))) throw new Error('Команда деректері жарамсыз.');
  if (!h.proposals.every((p: Proposal) => ['id', 'taskId', 'teamId', 'idea', 'plan', 'deadline', 'url'].every(k => typeof p[k as keyof Proposal] === 'string') && ['pending', 'selected', 'rejected'].includes(p.status) && Array.isArray(p.completed) && new Set(p.completed).size === p.completed.length && p.completed.every(s => ['prototype', 'pilot'].includes(s)) && h.tasks.some((t: Task) => t.id === p.taskId) && h.teams.some((t: Team) => t.id === p.teamId))) throw new Error('Ұсыныс деректері жарамсыз.');
  return h;
}
