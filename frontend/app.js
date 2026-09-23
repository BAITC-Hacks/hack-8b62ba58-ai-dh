import { createApi } from './api.js';

const $ = selector => document.querySelector(selector);
const fieldLabels = {
  title: 'Название задачи', context: 'Текущий процесс и контекст', need: 'Проблема и потребность',
  users: 'Кто будет пользоваться решением', data: 'Данные и материалы', constraints: 'Ограничения',
  result: 'Ожидаемый результат', success: 'Критерии успеха', contact: 'Контакт для команды', interaction: 'Формат совместной работы',
};
const questionsRu = {
  title: 'Какое короткое название дадим задаче?', context: 'Как сейчас устроен процесс и когда возникает проблема?',
  need: 'Что именно нужно изменить или улучшить?', users: 'Кто будет пользоваться решением?',
  data: 'Какие данные, примеры или материалы уже есть? Как можно получить к ним доступ?',
  constraints: 'Какие есть ограничения по срокам, бюджету, технологиям или доступу?',
  result: 'Какой конкретный результат вы ожидаете от команды?', success: 'По какому показателю вы поймёте, что решение сработало?',
  contact: 'С кем и как команда сможет связаться?', interaction: 'Как часто и в каком формате вы сможете давать обратную связь?',
};
const topicLabels = { 'Білім': 'Образование', 'Қызмет көрсету': 'Услуги', 'Экология': 'Экология', 'Сауда': 'Торговля', 'Ауыл шаруашылығы': 'Сельское хозяйство' };
const levelLabels = { 'Нақтылау қажет': 'Нужно уточнение', 'Жұмысқа жарамды': 'Можно начинать работу', 'Дайын': 'Готова', 'Басым': 'Приоритетная' };
const statusLabels = { pending: 'На рассмотрении', selected: 'Команда выбрана', rejected: 'Отклонено' };
const preferenceKey = 'ai-sana-role-preference-v1';
const blankValues = () => Object.fromEntries(Object.keys(fieldLabels).map(key => [key, '']));
function readPreference() {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey));
    if (value && ['business', 'student'].includes(value.role)) return { role: value.role, teamId: typeof value.teamId === 'string' ? value.teamId : '' };
  } catch { /* A blocked or stale preference must not prevent loading server data. */ }
  return { role: 'business', teamId: '' };
}
const state = {
  actor: readPreference(), ready: false, meta: null, teams: [], editor: null, conflicts: {},
  editorBusy: false, detailBusy: false, mutations: 0, catalogVersion: 0, workspaceVersion: 0,
  detailVersion: 0, detail: null, assistant: { phase: 'start', questions: [], index: 0 },
};
const api = createApi(() => state.actor);
const taskForm = $('#task-form');
const editorFields = $('#editor-fields');
const formMessage = $('#form-message');
const assistantInput = $('#assistant-input');
const modeDialog = $('#mode-dialog');
const taskDialog = $('#task-dialog');

function element(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}
function actionButton(text, onClick, className = 'button button-secondary') {
  const button = element('button', className, text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}
function message(target, text = '', kind = '') {
  target.textContent = text;
  target.classList.remove('message-error', 'message-success', 'message-info');
  if (kind) target.classList.add(`message-${kind}`);
}
function errorText(error) {
  const messages = {
    REVISION_CONFLICT: 'Эту запись уже изменили. Ваш текст сохранён в форме. Загрузите актуальную версию и проверьте изменения перед повторным сохранением.',
    CONFIRMATION_REQUIRED: 'Сначала вручную подтвердите текущую карточку.',
    TITLE_REQUIRED: 'Введите название задачи перед подтверждением.',
    AI_INVALID_RESPONSE: 'Помощник временно недоступен. Черновик сохранён; повторите уточнение или заполните поля вручную.',
    FORBIDDEN: 'Это действие недоступно в выбранном режиме.',
    TEAM_NOT_SELECTED: 'Сначала выберите предложение этой команды.',
    NOT_FOUND: 'Запись больше не доступна. Обновите список.',
  };
  return messages[error.code] || error.message || 'Не удалось выполнить действие. Попробуйте ещё раз.';
}
function setOptions(select, options, labels = {}, emptyLabel) {
  const selected = select.value;
  select.replaceChildren();
  if (emptyLabel) select.append(new Option(emptyLabel, ''));
  for (const value of options) select.append(new Option(labels[value] || value, value));
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
  select.disabled = false;
}
function getField(name) { return taskForm.elements.namedItem(name); }
function snapshotEditor() {
  return { draft: getField('draft').value.trim(), topic: getField('topic').value,
    values: Object.fromEntries(Object.keys(fieldLabels).map(key => [key, getField(key).value.trim()])) };
}
function writeEditor(snapshot) {
  getField('draft').value = snapshot.draft || '';
  getField('topic').value = snapshot.topic || state.meta?.topics[0] || '';
  for (const key of Object.keys(fieldLabels)) getField(key).value = snapshot.values?.[key] || '';
}
function isDirty() {
  const current = snapshotEditor();
  if (!state.editor) return Boolean(current.draft || Object.values(current.values).some(Boolean));
  return current.draft !== state.editor.draft || current.topic !== state.editor.topic ||
    Object.keys(fieldLabels).some(key => current.values[key] !== state.editor.values[key]);
}
function syncEditor() {
  const task = state.editor;
  const dirty = isDirty();
  const hasConflicts = Object.keys(state.conflicts).length > 0;
  const parts = [];
  if (task) {
    parts.push(task.hasPublishedVersion ? 'Есть версия в каталоге' : 'Черновик на сервере');
    parts.push(`Версия ${task.revision} · готовность ${task.rating.score}%`);
    if (task.confirmedRevision === task.revision && !dirty) parts.push('Карточка подтверждена');
  } else parts.push('Новый черновик');
  if (dirty) parts.push('Есть несохранённые изменения');
  if (hasConflicts) parts.push('Нужно выбрать версии конфликтующих полей');
  $('#editor-status').textContent = parts.join(' · ');
  for (const id of ['save-draft', 'clarify-draft', 'confirm-draft']) $(`#${id}`).disabled = !state.ready || state.editorBusy || hasConflicts;
  $('#publish-draft').disabled = !state.ready || state.editorBusy || hasConflicts || !task || dirty || task.confirmedRevision !== task.revision;
  $('#assistant-topic').disabled = !state.ready || state.editorBusy || Boolean(task);
  $('#readiness-score').textContent = `${task?.rating.score || 0}%`;
  const assistantDisabled = !state.ready || state.editorBusy || hasConflicts || state.assistant.phase === 'done';
  assistantInput.disabled = assistantDisabled;
  $('#assistant-form button').disabled = assistantDisabled;
  $('#quick-prompts').hidden = Boolean(task) || state.assistant.phase !== 'start';
  $('#new-draft').disabled = !state.ready || state.editorBusy;
  editorFields.disabled = !state.ready || state.editorBusy;
  for (const key of ['draft', 'topic', ...Object.keys(fieldLabels)]) getField(key).disabled = !state.ready || Object.hasOwn(state.conflicts, key);
  $('#conflict-panel').querySelectorAll('button').forEach(button => { button.disabled = state.editorBusy; });
}
function renderConflicts() {
  const panel = $('#conflict-panel');
  panel.replaceChildren();
  panel.hidden = Object.keys(state.conflicts).length === 0;
  if (panel.hidden) return;
  panel.append(element('h3', '', 'Выберите нужные значения'), element('p', '', 'Эти поля изменили и вы, и другой участник. Остальные изменения уже объединены. До вашего выбора сохранение недоступно.'));
  const labels = { draft: 'Исходное описание', topic: 'Направление', ...fieldLabels };
  for (const [key, conflict] of Object.entries(state.conflicts)) {
    const card = element('section', 'conflict-field');
    card.dataset.conflictField = key;
    card.append(element('h4', '', labels[key]));
    const variants = element('div', 'conflict-variants');
    for (const [source, label] of [['local', 'Ваш вариант'], ['remote', 'Вариант на сервере']]) {
      const column = element('div', 'conflict-variant');
      column.append(element('strong', '', label), element('p', '', (key === 'topic' ? topicLabels[conflict[source]] || conflict[source] : conflict[source]) || '(пусто)'));
      const button = actionButton(source === 'local' ? 'Оставить мой вариант' : 'Принять серверный вариант', () => {
        if (state.editorBusy) return;
        getField(key).value = conflict[source];
        delete state.conflicts[key];
        renderConflicts(); syncEditor();
        message(formMessage, Object.keys(state.conflicts).length
          ? 'Выберите значения для оставшихся полей.'
          : 'Конфликты разрешены. Проверьте объединённую карточку и сохраните изменения.', 'info');
      });
      button.dataset.conflictChoice = source;
      button.setAttribute('aria-label', `${source === 'local' ? 'Оставить мой вариант' : 'Принять серверный вариант'}: ${labels[key]}`);
      column.append(button); variants.append(column);
    }
    card.append(variants); panel.append(card);
  }
}
function applyServerTask(task, fill = true) {
  state.editor = task;
  if (fill) writeEditor(task);
  $('#assistant-topic').value = task.topic;
  syncEditor();
}
function addChat(text, role = 'assistant') {
  const row = element('div', `chat-message ${role === 'user' ? 'user-message' : 'assistant-message'}`);
  if (role !== 'user') row.append(element('span', 'message-avatar', '✳'));
  row.append(element('p', '', text));
  $('#assistant-chat').append(row);
  $('#assistant-chat').scrollTop = $('#assistant-chat').scrollHeight;
}
function resetAssistant(existing = false) {
  state.assistant = { phase: existing ? 'done' : 'start', questions: [], index: 0 };
  $('#assistant-chat').replaceChildren();
  addChat(existing ? 'Черновик открыт. Проверьте поля ниже или нажмите «Уточнить с AI», чтобы продолжить работу с помощником.' : 'Привет! Помогу превратить бизнес-идею в понятную задачу для команд. Что вы хотите улучшить или решить?');
  assistantInput.value = '';
  $('#assistant-progress').hidden = true;
  $('#assistant-result').hidden = true;
  message($('#assistant-message'));
  syncEditor();
}
function askNextQuestion() {
  const interview = state.assistant;
  const question = interview.questions[interview.index];
  if (!question) {
    interview.phase = 'done';
    $('#assistant-progress').hidden = true;
    $('#assistant-result').hidden = false;
    addChat('Ответы сохранены. Проверьте все поля карточки, подтвердите сведения и нажмите «Опубликовать», когда будете готовы.');
  } else {
    interview.phase = 'questions';
    $('#assistant-progress').hidden = false;
    $('#assistant-result').hidden = true;
    $('#progress-count').textContent = `${interview.index + 1} из ${interview.questions.length}`;
    $('#assistant-progress-fill').style.width = `${(interview.index / interview.questions.length) * 100}%`;
    addChat(question.text);
  }
  syncEditor();
}
async function saveEditor() {
  if (Object.keys(state.conflicts).length) throw new Error('Сначала выберите варианты всех конфликтующих полей.');
  const input = snapshotEditor();
  if (!input.draft) throw new Error('Добавьте исходное описание задачи.');
  if (!state.meta.topics.includes(input.topic)) throw new Error('Выберите направление задачи.');
  if (!state.editor) {
    const created = await api.create(input.draft, input.topic);
    applyServerTask(created.data, false);
  }
  if (isDirty()) {
    const result = await api.update(state.editor.id, state.editor.revision, input);
    applyServerTask(result.data);
  }
  return state.editor;
}
async function runEditor(work, assistantAction = false) {
  if (!state.ready || state.editorBusy) return false;
  if (state.actor.role !== 'business') return false;
  state.editorBusy = true;
  state.mutations++;
  message(formMessage);
  message($('#assistant-message'));
  syncEditor();
  try {
    await work();
    $('#reload-draft').hidden = true;
    return true;
  } catch (error) {
    message(formMessage, errorText(error), 'error');
    if (assistantAction) message($('#assistant-message'), errorText(error), 'error');
    if (error.status === 409 && state.editor) $('#reload-draft').hidden = false;
    return false;
  } finally {
    state.editorBusy = false;
    state.mutations--;
    syncEditor();
    void loadWorkspace();
  }
}
async function clarifyEditor() {
  await saveEditor();
  const result = await api.clarify(state.editor.id, state.editor.revision);
  applyServerTask(result.data);
  state.assistant = { phase: 'questions', index: 0, questions: result.ai.questions
    .filter(question => Object.hasOwn(fieldLabels, question.field))
    .map(question => ({ field: question.field, text: result.ai.mode === 'demo'
      ? `${fieldLabels[question.field]}. ${questionsRu[question.field]}` : question.text })) };
  askNextQuestion();
  message(formMessage, 'Помощник уточнил черновик. Ответьте на вопросы или отредактируйте поля вручную.', 'info');
}
async function sendAssistantMessage() {
  const text = assistantInput.value.trim();
  if (!text || state.editorBusy || state.assistant.phase === 'done') return;
  const success = await runEditor(async () => {
    if (state.assistant.phase === 'start') {
      getField('draft').value = text;
      if (!state.editor) {
        getField('topic').value = $('#assistant-topic').value;
      }
      await saveEditor();
      addChat(text, 'user');
      await clarifyEditor();
    } else {
      const question = state.assistant.questions[state.assistant.index];
      getField(question.field).value = text;
      await saveEditor();
      addChat(text, 'user');
      state.assistant.index++;
      askNextQuestion();
      message(formMessage, 'Ответ сохранён в черновике на сервере.', 'success');
    }
  }, true);
  if (success) {
    assistantInput.value = '';
    assistantInput.style.height = 'auto';
    if (!assistantInput.disabled) assistantInput.focus();
  }
}

for (const [key, labelText] of Object.entries(fieldLabels)) {
  const label = element('label', 'field');
  label.append(element('span', '', labelText + (key === 'title' ? ' *' : '')));
  const input = document.createElement(key === 'title' ? 'input' : 'textarea');
  input.name = key;
  input.maxLength = key === 'title' ? 200 : 10000;
  if (key === 'title') input.type = 'text';
  else input.rows = 2;
  input.placeholder = key === 'title' ? 'Короткое название задачи' : 'Заполните, если информация уже известна';
  label.append(input);
  $('#value-fields').append(label);
}
taskForm.addEventListener('input', syncEditor);
taskForm.addEventListener('change', syncEditor);
taskForm.addEventListener('submit', event => {
  event.preventDefault();
  void runEditor(async () => { await saveEditor(); message(formMessage, 'Черновик сохранён на сервере.', 'success'); });
});
$('#clarify-draft').addEventListener('click', () => void runEditor(async () => {
  await clarifyEditor();
  $('#assistant').scrollIntoView({ behavior: 'smooth', block: 'start' });
}, true));
$('#confirm-draft').addEventListener('click', () => void runEditor(async () => {
  if (!getField('title').value.trim()) throw new Error('Введите название задачи перед подтверждением.');
  await saveEditor();
  const result = await api.confirm(state.editor.id, state.editor.revision);
  applyServerTask(result.data);
  message(formMessage, 'Карточка подтверждена. Проверьте готовность и нажмите «Опубликовать», чтобы она появилась в каталоге.', 'success');
}));
$('#publish-draft').addEventListener('click', () => void runEditor(async () => {
  if (!state.editor || isDirty() || state.editor.confirmedRevision !== state.editor.revision) throw new Error('Сохраните изменения и подтвердите карточку перед публикацией.');
  const result = await api.publish(state.editor.id, state.editor.revision);
  applyServerTask(result.data);
  message(formMessage, 'Задача опубликована в общем каталоге.', 'success');
  await loadCatalog();
}));
$('#reload-draft').addEventListener('click', () => void runEditor(async () => {
  const flatten = snapshot => ({ draft: snapshot.draft, topic: snapshot.topic, ...snapshot.values });
  const original = flatten(state.editor);
  const localInput = snapshotEditor();
  const local = flatten(localInput);
  const result = await api.task(state.editor.id);
  const remote = flatten(result.data);
  const merged = {};
  state.conflicts = {};
  for (const key of Object.keys(local)) {
    if (local[key] === original[key]) merged[key] = remote[key];
    else if (remote[key] === original[key] || remote[key] === local[key]) merged[key] = local[key];
    else {
      merged[key] = local[key];
      state.conflicts[key] = { local: local[key], remote: remote[key] };
    }
  }
  applyServerTask(result.data, false);
  writeEditor({ draft: merged.draft, topic: merged.topic, values: merged });
  renderConflicts(); syncEditor();
  message(formMessage, Object.keys(state.conflicts).length
    ? 'Актуальная версия загружена. Для полей, изменённых одновременно, выберите свой или серверный вариант ниже.'
    : 'Изменения объединены: ваш новый текст сохранён, а остальные поля обновлены с сервера. Проверьте карточку и сохраните.', 'info');
}));
$('#new-draft').addEventListener('click', () => {
  if (!state.ready || state.editorBusy) return;
  if (isDirty()) { message(formMessage, 'Сначала сохраните текущие изменения. После этого можно начать новую задачу.', 'info'); return; }
  state.editor = null;
  state.conflicts = {}; renderConflicts();
  writeEditor({ draft: '', values: blankValues(), topic: state.meta.topics[0] });
  $('#assistant-topic').value = state.meta.topics[0];
  $('#reload-draft').hidden = true;
  message(formMessage);
  resetAssistant();
  $('#assistant').scrollIntoView({ behavior: 'smooth' });
  assistantInput.focus();
});
$('#assistant-form').addEventListener('submit', event => { event.preventDefault(); void sendAssistantMessage(); });
assistantInput.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#assistant-form').requestSubmit(); } });
assistantInput.addEventListener('input', () => { assistantInput.style.height = 'auto'; assistantInput.style.height = `${Math.min(assistantInput.scrollHeight, 105)}px`; });
$('#quick-prompts').addEventListener('click', event => {
  const prompt = event.target.closest('.prompt-chip');
  if (prompt && !state.editorBusy && state.ready) { assistantInput.value = prompt.textContent; void sendAssistantMessage(); }
});
$('#use-assistant-draft').addEventListener('click', () => { $('#submit').scrollIntoView({ behavior: 'smooth', block: 'start' }); getField('title').focus({ preventScroll: true }); });

function taskTitle(task) { return task.values.title || 'Черновик без названия'; }
function readinessMeter(task) {
  const holder = element('div', 'readiness');
  const top = element('div', 'readiness-top');
  top.append(element('span', '', levelLabels[task.rating.level] || task.rating.level), element('strong', '', `${task.rating.score}%`));
  const track = element('div', 'progress-track');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', 'Подтверждённая готовность задачи');
  track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100'); track.setAttribute('aria-valuenow', String(task.rating.score));
  const fill = element('div', 'progress-fill');
  fill.style.width = `${Math.max(0, Math.min(100, task.rating.score))}%`;
  track.append(fill); holder.append(top, track);
  return holder;
}
async function loadCatalog() {
  if (!state.ready) return;
  const version = ++state.catalogVersion;
  const filters = {};
  if ($('#filter-topic').value) filters.topic = $('#filter-topic').value;
  if ($('#filter-level').value) filters.level = $('#filter-level').value;
  message($('#catalog-message'), 'Обновляем каталог…');
  try {
    const result = await api.catalog(filters);
    if (version !== state.catalogVersion) return;
    $('#task-list').replaceChildren();
    $('#catalog-count span:last-child').textContent = `Задач: ${result.total}`;
    if (!result.data.length) $('#task-list').append(element('div', 'catalog-state empty', 'По выбранным условиям задач пока нет.'));
    result.data.forEach((task, index) => {
      const card = element('article', 'task-card');
      const meta = element('div', 'card-meta');
      meta.append(element('span', 'category-tag', topicLabels[task.topic] || task.topic), element('span', 'card-index', `CH · ${String(index + 1).padStart(2, '0')}`));
      const bottom = element('div', 'card-bottom');
      bottom.append(actionButton(state.actor.role === 'student' ? 'Подробнее и откликнуться ↗' : 'Подробнее и предложения ↗', () => void openDetail(task.id), 'apply-button'));
      card.append(meta, element('h3', '', taskTitle(task)), element('p', '', task.values.need || task.values.context || task.draft), readinessMeter(task), bottom);
      $('#task-list').append(card);
    });
    message($('#catalog-message'));
  } catch (error) {
    if (version !== state.catalogVersion) return;
    $('#catalog-count span:last-child').textContent = 'Не удалось обновить';
    if (!$('#task-list .task-card')) $('#task-list').replaceChildren(element('div', 'catalog-state error', 'Каталог не загружен. Нажмите «Обновить», чтобы повторить.'));
    message($('#catalog-message'), errorText(error), 'error');
  }
}
async function loadWorkspace() {
  if (!state.ready || state.actor.role !== 'business') return;
  const version = ++state.workspaceVersion;
  try {
    const result = await api.businessTasks();
    if (version !== state.workspaceVersion || state.actor.role !== 'business') return;
    $('#draft-list').replaceChildren();
    if (!result.data.length) $('#draft-list').append(element('div', 'catalog-state empty', 'Пока нет черновиков. Начните с помощника или заполните карточку.'));
    for (const task of result.data) {
      const row = element('article', 'draft-card');
      row.append(element('span', 'category-tag', task.hasPublishedVersion ? 'Есть в каталоге' : 'Черновик'), element('h3', '', taskTitle(task)), element('p', '', `${topicLabels[task.topic] || task.topic} · версия ${task.revision} · ${task.rating.score}%`));
      const actions = element('div', 'editor-actions');
      actions.append(actionButton('Открыть редактор', () => void openDraft(task.id)));
      if (task.hasPublishedVersion) actions.append(actionButton('Предложения', () => void openDetail(task.id)));
      row.append(actions); $('#draft-list').append(row);
    }
    message($('#workspace-message'));
  } catch (error) { if (version === state.workspaceVersion) message($('#workspace-message'), errorText(error), 'error'); }
}
async function openDraft(taskId) {
  if (state.editorBusy) return;
  if (isDirty() && state.editor?.id !== taskId) { message($('#workspace-message'), 'Сохраните изменения в открытой карточке перед переходом к другой задаче.', 'info'); return; }
  if (isDirty() && state.editor?.id === taskId) { $('#submit').scrollIntoView({ behavior: 'smooth' }); return; }
  await runEditor(async () => {
    const result = await api.task(taskId);
    applyServerTask(result.data);
    resetAssistant(true);
    message(formMessage, 'Черновик загружен с сервера. Изменения публикации не попадут в каталог до нового подтверждения и публикации.', 'info');
    $('#submit').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
function renderTeams() {
  $('#team-list').replaceChildren();
  for (const team of [...state.teams].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))) {
    const card = element('article', 'team-card');
    const top = element('div', 'team-top');
    top.append(element('h3', '', team.name), element('strong', 'team-points', `${team.points} баллов`));
    card.append(top, element('p', '', `Интересы: ${topicLabels[team.interests] || team.interests}`), element('p', '', `Навыки: ${team.skills}`), element('p', '', `Технологии: ${team.technologies}`));
    $('#team-list').append(card);
  }
}
async function loadTeams() {
  try {
    const result = await api.teams();
    state.teams = result.data;
    if (!state.teams.some(team => team.id === state.actor.teamId)) state.actor.teamId = state.teams[0]?.id || '';
    const teamSelect = $('#mode-form').elements.teamId;
    const chosen = teamSelect.value || state.actor.teamId;
    teamSelect.replaceChildren(...state.teams.map(team => new Option(team.name, team.id)));
    teamSelect.value = state.teams.some(team => team.id === chosen) ? chosen : state.actor.teamId;
    renderTeams(); message($('#teams-message'));
  } catch (error) { message($('#teams-message'), errorText(error), 'error'); }
}
function applyRole() {
  const business = state.actor.role === 'business';
  document.querySelectorAll('.business-section').forEach(section => { section.hidden = !business; });
  $('#open-auth').textContent = business ? 'Режим: бизнес ↗' : `Команда: ${state.teams.find(team => team.id === state.actor.teamId)?.name || 'выбрать'} ↗`;
  $('.hero-cta').href = business ? '#assistant' : '#catalog';
  $('.hero-cta').textContent = business ? 'Начать с AI-помощником ↓' : 'Выбрать задачу в каталоге ↓';
  syncEditor();
}
$('#open-auth').addEventListener('click', () => {
  const form = $('#mode-form');
  form.elements.role.value = state.actor.role;
  form.elements.teamId.value = state.actor.teamId;
  $('#team-choice').hidden = state.actor.role !== 'student';
  message($('#mode-message'));
  modeDialog.showModal();
});
$('#close-mode').addEventListener('click', () => modeDialog.close());
$('#mode-form').elements.role.addEventListener('change', event => { $('#team-choice').hidden = event.target.value !== 'student'; });
$('#mode-form').addEventListener('submit', event => {
  event.preventDefault();
  if (state.mutations) { message($('#mode-message'), 'Дождитесь завершения текущего сохранения.', 'info'); return; }
  const form = event.currentTarget;
  const role = form.elements.role.value;
  const teamId = form.elements.teamId.value;
  if (role === 'student' && !state.teams.some(team => team.id === teamId)) { message($('#mode-message'), 'Команды ещё не загружены. Закройте окно и обновите страницу.', 'error'); return; }
  state.actor = { role, teamId };
  try { localStorage.setItem(preferenceKey, JSON.stringify(state.actor)); } catch { /* Preference is optional. */ }
  modeDialog.close(); applyRole();
  void loadCatalog(); void loadWorkspace();
});

function detailField(label, value) {
  const item = element('div', 'detail-field');
  item.append(element('dt', '', label), element('dd', '', value || 'Пока не указано'));
  return item;
}
function safeLink(url) {
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; }
  catch { return null; }
}
function captureDetailInput() {
  if (!state.detail) return;
  const form = $('#proposal-form');
  if (form) state.detail.offer = Object.fromEntries(['idea', 'plan', 'deadline', 'url'].map(key => [key, form.elements.namedItem(key).value]));
  taskDialog.querySelectorAll('[data-evidence]').forEach(input => { state.detail.evidence[input.dataset.evidence] = input.value; });
}
function setDetailBusy(busy) {
  state.detailBusy = busy;
  taskDialog.querySelectorAll('button, input, textarea, select').forEach(control => { control.disabled = busy || control.dataset.completed === 'true'; });
}
async function runDetail(work) {
  if (state.detailBusy || !state.detail) return;
  captureDetailInput();
  state.mutations++; setDetailBusy(true);
  message($('#detail-message'));
  try { await work(); $('#reload-detail').hidden = true; }
  catch (error) {
    message($('#detail-message'), errorText(error), 'error');
    if (error.status === 409) $('#reload-detail').hidden = false;
  } finally { state.mutations--; setDetailBusy(false); }
}
function renderDetail() {
  const { task, proposals, offer, evidence } = state.detail;
  const content = $('#detail-content');
  content.replaceChildren();
  const heading = element('h2', '', taskTitle(task)); heading.id = 'detail-title';
  content.append(element('span', 'category-tag', topicLabels[task.topic] || task.topic), heading, readinessMeter(task));
  if (state.actor.role === 'business') content.append(element('p', 'detail-note', 'Показана рабочая версия. В каталоге доступна последняя опубликованная карточка.'));
  const data = element('dl', 'detail-fields');
  for (const [key, label] of Object.entries(fieldLabels)) data.append(detailField(label, task.values[key]));
  content.append(data);
  if (task.rating.missing.length) content.append(element('p', 'detail-note', `Не подтверждены: ${[...new Set(task.rating.missing.flatMap(part => part.fields).map(key => fieldLabels[key]))].join(', ')}.`));
  content.append(element('h3', 'detail-section-title', state.actor.role === 'business' ? 'Предложения команд' : 'Предложения моей команды'));
  if (!proposals.length) content.append(element('p', 'detail-note', 'Предложений пока нет.'));
  for (const proposal of proposals) {
    const card = element('article', 'proposal-card');
    const team = state.teams.find(item => item.id === proposal.teamId);
    card.append(element('h4', '', team?.name || proposal.teamId), element('span', `proposal-status status-${proposal.status}`, statusLabels[proposal.status]));
    for (const [label, text] of [['Идея', proposal.idea], ['План', proposal.plan], ['Срок', proposal.deadline]]) {
      const row = element('p', 'proposal-copy'); row.append(element('strong', '', `${label}: `), document.createTextNode(text)); card.append(row);
    }
    const url = safeLink(proposal.url);
    if (url) { const link = element('a', 'text-action', 'Открыть материалы ↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); }
    card.append(element('p', 'detail-note', proposal.completed.length ? `Подтверждено: ${proposal.completed.map(stage => stage === 'prototype' ? 'прототип' : 'пилот').join(', ')}` : 'Этапы ещё не подтверждены'));
    if (state.actor.role === 'business') {
      const actions = element('div', 'editor-actions');
      for (const [status, label] of [['selected', 'Выбрать команду'], ['rejected', 'Отклонить']]) {
        if (proposal.status !== status) actions.append(actionButton(label, () => void runDetail(async () => {
          const result = await api.decide(proposal.id, proposal.revision, status);
          state.detail.proposals = state.detail.proposals.map(item => item.id === proposal.id ? result.data : item);
          renderDetail(); message($('#detail-message'), status === 'selected' ? 'Команда выбрана.' : 'Предложение отклонено.', 'success');
        })));
      }
      card.append(actions);
      if (proposal.status === 'selected') {
        const label = element('label', 'field evidence-field'); label.append(element('span', '', 'Что сделано: подтверждение результата'));
        const input = document.createElement('textarea'); input.rows = 2; input.maxLength = 5000; input.dataset.evidence = proposal.id;
        input.value = evidence[proposal.id] || ''; input.placeholder = 'Опишите проверенный результат или укажите ссылку'; label.append(input); card.append(label);
        const stages = element('div', 'editor-actions');
        for (const [stage, title] of [['prototype', 'Прототип'], ['pilot', 'Пилот']]) {
          const completed = proposal.completed.includes(stage);
          const button = actionButton(completed ? `${title} подтверждён ✓` : `Подтвердить: ${title.toLowerCase()}`, () => void runDetail(async () => {
            const proof = state.detail.evidence[proposal.id]?.trim();
            if (!proof) throw new Error('Добавьте описание проверенного результата для подтверждения этапа.');
            const result = await api.milestone(task.id, proposal.teamId, stage, proof);
            const updated = await api.proposals(task.id);
            state.detail.proposals = updated.data;
            renderDetail(); await loadTeams(); applyRole();
            message($('#detail-message'), result.data.awarded ? 'Этап подтверждён. Команда получила 25 баллов.' : 'Этот этап уже был подтверждён. Баллы повторно не начислялись.', 'success');
          }));
          button.disabled = completed; button.dataset.completed = String(completed); stages.append(button);
        }
        card.append(stages);
      }
    }
    content.append(card);
  }
  if (state.actor.role === 'student') {
    content.append(element('h3', 'detail-section-title', 'Предложить решение'));
    const form = element('form', 'proposal-form'); form.id = 'proposal-form';
    for (const [key, title] of [['idea', 'Идея решения'], ['plan', 'План работы'], ['deadline', 'Срок выполнения'], ['url', 'Ссылка на прототип или материалы']]) {
      const label = element('label', 'field'); label.append(element('span', '', `${title} *`));
      const input = document.createElement(['deadline', 'url'].includes(key) ? 'input' : 'textarea');
      input.name = key; input.required = true; input.value = offer[key] || '';
      input.maxLength = { idea: 5000, plan: 10000, deadline: 200, url: 2000 }[key];
      if (key === 'url') { input.type = 'url'; input.placeholder = 'https://…'; }
      else if (key === 'deadline') input.type = 'text';
      else input.rows = 3;
      label.append(input); form.append(label);
    }
    const submit = element('button', 'button button-primary', 'Отправить предложение ↗'); submit.type = 'submit'; form.append(submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      void runDetail(async () => {
        const input = Object.fromEntries(Object.entries(state.detail.offer).map(([key, value]) => [key, value.trim()]));
        if (Object.values(input).some(value => !value)) throw new Error('Заполните все поля предложения.');
        if (!safeLink(input.url)) throw new Error('Укажите ссылку, начинающуюся с http:// или https://.');
        const result = await api.propose(task.id, input);
        state.detail.proposals.push(result.data); state.detail.offer = {};
        renderDetail(); message($('#detail-message'), 'Предложение отправлено и сохранено на сервере.', 'success');
      });
    });
    content.append(form);
  }
  if (state.detailBusy) setDetailBusy(true);
}
async function openDetail(taskId) {
  if (state.detailBusy) return;
  const version = ++state.detailVersion;
  state.detail = null;
  const loadingTitle = element('h2', '', 'Загружаем задачу…');
  loadingTitle.id = 'detail-title';
  $('#detail-content').replaceChildren(loadingTitle);
  message($('#detail-message')); $('#reload-detail').hidden = true;
  if (!taskDialog.open) taskDialog.showModal();
  try {
    const [task, proposals] = await Promise.all([api.task(taskId), api.proposals(taskId)]);
    if (version !== state.detailVersion || !taskDialog.open) return;
    state.detail = { task: task.data, proposals: proposals.data, offer: {}, evidence: {} };
    renderDetail();
  } catch (error) {
    if (version !== state.detailVersion) return;
    message($('#detail-message'), errorText(error), 'error');
    $('#detail-content').append(actionButton('Повторить загрузку', () => void openDetail(taskId)));
  }
}
$('#reload-detail').addEventListener('click', () => void runDetail(async () => {
  const result = await api.proposals(state.detail.task.id);
  state.detail.proposals = result.data;
  renderDetail(); message($('#detail-message'), 'Предложения обновлены. Ваш текст в форме сохранён.', 'info');
}));
$('#close-detail').addEventListener('click', () => { if (!state.detailBusy) taskDialog.close(); });
taskDialog.addEventListener('cancel', event => { if (state.detailBusy) event.preventDefault(); });
taskDialog.addEventListener('close', () => { state.detailVersion++; });
for (const dialog of [taskDialog, modeDialog]) dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) && !state.detailBusy) dialog.close();
});
for (const id of ['filter-topic', 'filter-level']) $(`#${id}`).addEventListener('change', () => void loadCatalog());
$('#refresh-catalog').addEventListener('click', () => void (state.ready ? loadCatalog() : initialize()));
$('#refresh-workspace').addEventListener('click', () => void loadWorkspace());
document.querySelectorAll('[data-current-year]').forEach(item => { item.textContent = String(new Date().getFullYear()); });
window.addEventListener('beforeunload', event => { if (isDirty() || state.mutations) { event.preventDefault(); event.returnValue = ''; } });

let initializing = false;
async function initialize() {
  if (initializing) return;
  initializing = true;
  message($('#connection-message'), 'Подключаемся к серверу…');
  try {
    const [meta, health] = await Promise.all([api.meta(), api.health()]);
    state.meta = meta.data;
    setOptions($('#editor-topic'), meta.data.topics, topicLabels);
    setOptions($('#assistant-topic'), meta.data.topics, topicLabels);
    setOptions($('#filter-topic'), meta.data.topics, topicLabels, 'Все направления');
    setOptions($('#filter-level'), meta.data.levels, levelLabels, 'Все уровни');
    state.ready = true;
    $('#ai-mode').textContent = health.data.aiMode === 'provider' ? 'AI ПОДКЛЮЧЁН' : 'ДЕМО AI';
    $('#assistant-note').textContent = health.data.aiMode === 'provider'
      ? 'Помощник подключён к AI-сервису. Проверьте предложенные сведения перед подтверждением.'
      : 'Серверный демо-помощник задаёт вопросы по незаполненным полям. Генеративный AI-сервис не подключён.';
    await loadTeams();
    applyRole();
    message($('#connection-message'), 'Общий сервер подключён · демонстрационный выбор роли · данные сохраняются в базе', 'success');
    await Promise.all([loadCatalog(), loadWorkspace()]);
  } catch (error) {
    message($('#connection-message'), errorText(error), 'error');
    $('#connection-message').append(document.createTextNode(' '), actionButton('Повторить подключение', () => void initialize(), 'text-action'));
  } finally { initializing = false; syncEditor(); }
}
resetAssistant();
applyRole();
void initialize();
