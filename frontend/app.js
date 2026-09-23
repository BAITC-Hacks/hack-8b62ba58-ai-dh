const API_URL = '/api/tasks';

const taskForm = document.querySelector('#task-form');
const taskList = document.querySelector('#task-list');
const formMessage = document.querySelector('#form-message');
const catalogMessage = document.querySelector('#catalog-message');
const catalogCount = document.querySelector('#catalog-count span:last-child');

function setMessage(element, message, type = '') {
  element.textContent = message;
  element.className = type ? `${element.id === 'form-message' ? 'form-message' : 'catalog-message'} message-${type}` : element.id === 'form-message' ? 'form-message' : 'catalog-message';
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Запрос не выполнен (${response.status})`);
  }
  return payload;
}

function readinessValue(task) {
  const value = Number(task.readiness ?? task.readinessScore ?? task.readiness_score ?? task.score ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function makeTaskCard(task, index) {
  const card = document.createElement('article');
  card.className = 'task-card';

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const category = document.createElement('span');
  category.className = 'category-tag';
  category.textContent = task.category || task.industry || 'Без категории';
  const number = document.createElement('span');
  number.className = 'card-index';
  number.textContent = `CH · ${String(index + 1).padStart(2, '0')}`;
  meta.append(category, number);

  const title = document.createElement('h3');
  title.textContent = task.title || task.name || 'Новая задача';
  const description = document.createElement('p');
  description.textContent = task.description || 'Описание задачи пока не добавлено.';

  const readiness = readinessValue(task);
  const meter = document.createElement('div');
  meter.className = 'readiness';
  const meterTop = document.createElement('div');
  meterTop.className = 'readiness-top';
  const meterLabel = document.createElement('span');
  meterLabel.textContent = 'Готовность задачи';
  const meterValue = document.createElement('strong');
  meterValue.textContent = `${readiness}%`;
  meterTop.append(meterLabel, meterValue);
  const track = document.createElement('div');
  track.className = 'progress-track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', 'Рейтинг готовности');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', String(readiness));
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  fill.style.width = `${readiness}%`;
  track.append(fill);
  meter.append(meterTop, track);

  const bottom = document.createElement('div');
  bottom.className = 'card-bottom';
  const button = document.createElement('button');
  button.className = 'apply-button';
  button.type = 'button';
  button.innerHTML = 'Откликнуться <span aria-hidden="true">↗</span>';
  button.addEventListener('click', () => applyToTask(task, button));
  bottom.append(button);

  card.append(meta, title, description, meter, bottom);
  return card;
}

function renderTasks(tasks) {
  taskList.replaceChildren();
  catalogMessage.textContent = '';

  if (!tasks.length) {
    catalogCount.textContent = 'Пока нет задач';
    const empty = document.createElement('div');
    empty.className = 'catalog-state empty';
    empty.textContent = 'Каталог пока пуст. Будьте первыми — добавьте бизнес-задачу.';
    taskList.append(empty);
    return;
  }

  catalogCount.textContent = `${tasks.length} ${pluralize(tasks.length, ['задача', 'задачи', 'задач'])}`;
  const fragment = document.createDocumentFragment();
  tasks.forEach((task, index) => fragment.append(makeTaskCard(task, index)));
  taskList.append(fragment);
}

function pluralize(number, forms) {
  const lastTwo = number % 100;
  const last = number % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  if (last === 1) return forms[0];
  return last >= 2 && last <= 4 ? forms[1] : forms[2];
}

async function loadTasks() {
  try {
    const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
    const payload = await parseResponse(response);
    const tasks = Array.isArray(payload) ? payload : payload?.tasks;
    if (!Array.isArray(tasks)) throw new Error('Сервер вернул неожиданный формат списка задач.');
    renderTasks(tasks);
  } catch (error) {
    catalogCount.textContent = 'Каталог недоступен';
    taskList.replaceChildren();
    const state = document.createElement('div');
    state.className = 'catalog-state error';
    state.textContent = 'Не удалось загрузить задачи. Проверьте соединение и попробуйте обновить страницу.';
    taskList.append(state);
    setMessage(catalogMessage, error.message, 'error');
  }
}

async function applyToTask(task, button) {
  const taskId = task.id ?? task._id;
  if (taskId === undefined || taskId === null || taskId === '') {
    setMessage(catalogMessage, 'Не удалось откликнуться: у задачи отсутствует идентификатор.', 'error');
    return;
  }

  const originalContent = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Отправляем…';
  try {
    const response = await fetch(`${API_URL}/${encodeURIComponent(taskId)}/apply`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const result = await parseResponse(response);
    button.textContent = 'Вы откликнулись ✓';
    setMessage(catalogMessage, result?.message || `Отклик на задачу «${task.title || task.name || 'задача'}» отправлен.`, 'success');
  } catch (error) {
    button.disabled = false;
    button.innerHTML = originalContent;
    setMessage(catalogMessage, `Не удалось отправить отклик: ${error.message}`, 'error');
  }
}

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(formMessage, '');

  if (!taskForm.reportValidity()) return;

  const formData = new FormData(taskForm);
  const task = {
    title: String(formData.get('title')).trim(),
    description: String(formData.get('description')).trim(),
    category: String(formData.get('category')).trim(),
  };

  if (Object.values(task).some((value) => !value)) {
    setMessage(formMessage, 'Заполните все обязательные поля.', 'error');
    return;
  }

  const submitButton = taskForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Отправляем…';
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(task),
    });
    await parseResponse(response);
    taskForm.reset();
    setMessage(formMessage, 'Задача отправлена. Спасибо — она скоро появится в каталоге.', 'success');
    await loadTasks();
  } catch (error) {
    setMessage(formMessage, `Не удалось отправить задачу: ${error.message}`, 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Отправить задачу <span aria-hidden="true">↗</span>';
  }
});

loadTasks();
