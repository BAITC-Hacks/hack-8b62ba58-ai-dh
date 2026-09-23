const API_URL = '/api/tasks';
const LOCAL_TASKS_KEY = 'ai-sana-demo-tasks';
const LOCAL_APPLIES_KEY = 'ai-sana-demo-applies';
const LOCAL_USERS_KEY = 'ai-sana-demo-users';
const LOCAL_SESSION_KEY = 'ai-sana-demo-session';
const DEMO_TASKS = [
  { id: 'demo-demand', title: 'Прогнозирование спроса в розничной сети', description: 'Помочь планировать закупки точнее и сократить дефицит товаров на полках с помощью прогноза продаж.', category: 'Ритейл', readiness: 72 },
  { id: 'demo-support', title: 'Умный помощник для службы поддержки', description: 'Автоматизировать ответы на частые обращения клиентов и быстрее направлять сложные вопросы нужному специалисту.', category: 'Финансы', readiness: 58 },
  { id: 'demo-logistics', title: 'Оптимизация маршрутов доставки', description: 'Подбирать эффективные маршруты с учётом загруженности дорог, срочности заказов и доступности курьеров.', category: 'Логистика', readiness: 84 },
];

const taskForm = document.querySelector('#task-form');
const taskList = document.querySelector('#task-list');
const formMessage = document.querySelector('#form-message');
const catalogMessage = document.querySelector('#catalog-message');
const catalogCount = document.querySelector('#catalog-count span:last-child');

function readLocalTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_TASKS_KEY) || 'null');
    return Array.isArray(saved) ? saved : DEMO_TASKS;
  } catch {
    return DEMO_TASKS;
  }
}

function writeLocalTasks(tasks) {
  try {
    localStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
    return true;
  } catch {
    return false;
  }
}

function showDemoNotice(message = 'API недоступно — показаны демо-данные. Ваши изменения сохраняются только в этом браузере.') {
  setMessage(catalogMessage, message, 'info');
  catalogCount.textContent = 'Демо-режим';
}

function readLocalUsers() {
  try {
    const users = JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || '[]');
    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function setSession(user) {
  const session = { email: user.email, name: user.name };
  localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
  updateAuthButton(session);
}

function updateAuthButton(session = readSession()) {
  const button = document.querySelector('#open-auth');
  if (session) {
    button.innerHTML = `${escapeHtml(session.name.split(/\s+/)[0])} <span aria-hidden="true">·</span> Выйти`;
    button.title = session.email;
    button.setAttribute('aria-label', `Выйти из аккаунта ${session.name}`);
  } else {
    button.innerHTML = 'Войти <span aria-hidden="true">↗</span>';
    button.removeAttribute('title');
    button.setAttribute('aria-label', 'Войти');
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function hashPassword(password, saltHex) {
  if (!globalThis.crypto?.subtle) throw new Error('Для локального демо-входа откройте сайт через localhost или HTTPS.');
  const salt = saltHex ? Uint8Array.from(saltHex.match(/.{2}/g), (byte) => parseInt(byte, 16)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
  const hash = Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { salt: saltHex || Array.from(salt, (byte) => byte.toString(16).padStart(2, '0')).join(''), hash };
}

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
    renderTasks(readLocalTasks());
    showDemoNotice(`API ответило ошибкой (${error.message}). Показаны демо-данные; изменения сохраняются только в этом браузере.`);
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
    try {
      const applies = JSON.parse(localStorage.getItem(LOCAL_APPLIES_KEY) || '[]');
      if (!applies.includes(String(taskId))) applies.push(String(taskId));
      localStorage.setItem(LOCAL_APPLIES_KEY, JSON.stringify(applies));
      button.textContent = 'Отклик сохранён ✓';
      showDemoNotice(`API не приняло отклик (${error.message}). Отклик сохранён только в этом браузере.`);
    } catch {
      button.disabled = false;
      button.innerHTML = originalContent;
      setMessage(catalogMessage, `Не удалось отправить отклик: ${error.message}`, 'error');
    }
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
    const savedTasks = readLocalTasks();
    const localTask = { ...task, id: `local-${Date.now()}`, readiness: 0 };
    savedTasks.unshift(localTask);
    if (writeLocalTasks(savedTasks)) {
      taskForm.reset();
      setMessage(formMessage, 'API недоступно. Задача сохранена в демо-режиме только в этом браузере.', 'success');
      renderTasks(savedTasks);
      showDemoNotice(`API ответило ошибкой (${error.message}). Новая задача сохранена только в этом браузере.`);
    } else {
      setMessage(formMessage, `Не удалось отправить или локально сохранить задачу: ${error.message}`, 'error');
    }
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Отправить задачу <span aria-hidden="true">↗</span>';
  }
});

const authOverlay = document.querySelector('#auth-overlay');
const loginForm = document.querySelector('#login-form');
const authTitle = document.querySelector('#auth-title');
const authIntro = document.querySelector('#auth-intro');
const authSubmit = document.querySelector('#auth-submit');
const authMessage = document.querySelector('#auth-message');
const passwordInput = loginForm.elements.password;
const nameInput = loginForm.elements.namedItem('name');
const confirmPasswordInput = loginForm.elements.namedItem('confirmPassword');
const forgotPassword = document.querySelector('#forgot-password');
const backToLogin = document.querySelector('#back-to-login');
const authModeSwitch = document.querySelector('#switch-auth-mode');
const authFootnoteCopy = document.querySelector('#auth-footnote-copy');

function showRegisterForm() {
  authOverlay.classList.remove('is-recovery');
  authOverlay.classList.add('is-register');
  authTitle.textContent = 'Создать аккаунт';
  authIntro.textContent = 'Зарегистрируйтесь, чтобы откликаться на задачи и следить за проектами.';
  authSubmit.innerHTML = 'Зарегистрироваться <span aria-hidden="true">↗</span>';
  authSubmit.disabled = false;
  document.querySelector('#name-field').hidden = false;
  document.querySelector('#confirm-password-field').hidden = false;
  document.querySelector('#confirm-password-field').querySelector('span').innerHTML = 'Повторите пароль <b>*</b>';
  document.querySelector('#password-field').hidden = false;
  nameInput.required = true;
  passwordInput.required = true;
  passwordInput.autocomplete = 'new-password';
  confirmPasswordInput.required = true;
  document.querySelector('#name-field').hidden = false;
  document.querySelector('#confirm-password-field').hidden = false;
  document.querySelector('#password-field').querySelector('span:first-child').textContent = 'Пароль (не менее 8 символов) *';
  document.querySelector('#forgot-password').hidden = true;
  authModeSwitch.hidden = false;
  authFootnoteCopy.textContent = 'Уже есть аккаунт?';
  authModeSwitch.textContent = 'Войти';
  authModeSwitch.dataset.mode = 'login';
  backToLogin.hidden = true;
  setMessage(authMessage, '');
}

function openAuth() {
  authOverlay.hidden = false;
  document.body.classList.add('dialog-open');
  loginForm.elements.email.focus();
}

function closeAuth() {
  authOverlay.hidden = true;
  authOverlay.classList.remove('is-recovery');
  document.body.classList.remove('dialog-open');
  loginForm.reset();
  passwordInput.type = 'password';
  document.querySelector('#toggle-password').setAttribute('aria-label', 'Показать пароль');
  document.querySelector('#toggle-password').textContent = 'Показать';
  showLoginForm();
}

function showLoginForm() {
  authOverlay.classList.remove('is-recovery');
  authOverlay.classList.remove('is-register');
  authTitle.textContent = 'С возвращением';
  authIntro.textContent = 'Войдите, чтобы следить за задачами и откликами.';
  authSubmit.innerHTML = 'Войти <span aria-hidden="true">↗</span>';
  authSubmit.disabled = false;
  passwordInput.required = true;
  passwordInput.autocomplete = 'current-password';
  nameInput.required = false;
  confirmPasswordInput.required = false;
  document.querySelector('#name-field').hidden = true;
  document.querySelector('#confirm-password-field').hidden = true;
  document.querySelector('#password-field').hidden = false;
  document.querySelector('#password-field').querySelector('span:first-child').innerHTML = 'Пароль <b>*</b>';
  document.querySelector('#confirm-password-field').querySelector('span').innerHTML = 'Повторите пароль <b>*</b>';
  document.querySelector('#forgot-password').hidden = false;
  authFootnoteCopy.textContent = 'Нет аккаунта?';
  authModeSwitch.textContent = 'Зарегистрироваться';
  authModeSwitch.dataset.mode = 'register';
  authModeSwitch.hidden = false;
  setMessage(authMessage, '');
  backToLogin.hidden = true;
}

document.querySelector('#open-auth').addEventListener('click', () => {
  if (readSession()) {
    localStorage.removeItem(LOCAL_SESSION_KEY);
    updateAuthButton(null);
  } else {
    openAuth();
  }
});
document.querySelector('#close-auth').addEventListener('click', closeAuth);
authOverlay.addEventListener('click', (event) => {
  if (event.target === authOverlay) closeAuth();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !authOverlay.hidden) closeAuth();
});

document.querySelector('#toggle-password').addEventListener('click', (event) => {
  const button = event.currentTarget;
  const showPassword = passwordInput.type === 'password';
  passwordInput.type = showPassword ? 'text' : 'password';
  button.textContent = showPassword ? 'Скрыть' : 'Показать';
  button.setAttribute('aria-label', showPassword ? 'Скрыть пароль' : 'Показать пароль');
});

forgotPassword.addEventListener('click', () => {
  authOverlay.classList.add('is-recovery');
  authOverlay.classList.remove('is-register');
  authTitle.textContent = 'Изменить пароль';
  authIntro.textContent = 'В демо-режиме задайте новый пароль для аккаунта на этом устройстве.';
  authSubmit.innerHTML = 'Сохранить пароль <span aria-hidden="true">↗</span>';
  passwordInput.required = true;
  passwordInput.autocomplete = 'new-password';
  passwordInput.value = '';
  confirmPasswordInput.value = '';
  document.querySelector('#password-field').hidden = false;
  document.querySelector('#password-field').querySelector('span:first-child').textContent = 'Новый пароль (не менее 8 символов) *';
  nameInput.required = false;
  confirmPasswordInput.required = true;
  document.querySelector('#name-field').hidden = true;
  document.querySelector('#confirm-password-field').hidden = false;
  document.querySelector('#confirm-password-field').querySelector('span').innerHTML = 'Повторите новый пароль <b>*</b>';
  document.querySelector('#forgot-password').hidden = true;
  authModeSwitch.hidden = true;
  backToLogin.hidden = false;
  setMessage(authMessage, '');
  loginForm.elements.email.focus();
});

backToLogin.addEventListener('click', showLoginForm);

authModeSwitch.addEventListener('click', () => {
  if (authModeSwitch.dataset.mode === 'register') showRegisterForm();
  else showLoginForm();
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;

  const email = loginForm.elements.email.value.trim().toLowerCase();
  const password = passwordInput.value;
  const users = readLocalUsers();
  authSubmit.disabled = true;
  authSubmit.textContent = 'Подождите…';

  try {
    if (password !== confirmPasswordInput.value && (authOverlay.classList.contains('is-register') || authOverlay.classList.contains('is-recovery'))) {
      throw new Error('Пароли не совпадают. Проверьте оба поля.');
    }

    if (authOverlay.classList.contains('is-recovery')) {
      const userIndex = users.findIndex((user) => user.email === email);
      if (userIndex < 0) throw new Error('Демо-аккаунт с такой почтой не найден на этом устройстве.');
      const credentials = await hashPassword(password);
      users[userIndex] = { ...users[userIndex], salt: credentials.salt, passwordHash: credentials.hash };
      localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
      setMessage(authMessage, 'Пароль изменён. Теперь можно войти с новым паролем.', 'success');
      loginForm.reset();
      showLoginForm();
      setMessage(authMessage, 'Пароль изменён. Войдите с новым паролем.', 'success');
      return;
    }

    if (authOverlay.classList.contains('is-register')) {
      const name = nameInput.value.trim().replace(/\s+/g, ' ');
      if (users.some((user) => user.email === email)) throw new Error('Для этой почты уже есть демо-аккаунт. Войдите или измените пароль.');
      const credentials = await hashPassword(password);
      const user = { name, email, salt: credentials.salt, passwordHash: credentials.hash };
      users.push(user);
      localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
      setSession(user);
      closeAuth();
      return;
    }

    const user = users.find((candidate) => candidate.email === email);
    if (!user) throw new Error('Демо-аккаунт не найден на этом устройстве. Сначала зарегистрируйтесь.');
    const credentials = await hashPassword(password, user.salt);
    if (credentials.hash !== user.passwordHash) throw new Error('Неверная почта или пароль. Проверьте данные и попробуйте ещё раз.');
    setSession(user);
    closeAuth();
  } catch (error) {
    setMessage(authMessage, error.message || 'Не удалось выполнить действие. Попробуйте ещё раз.', 'error');
  } finally {
    authSubmit.disabled = false;
    if (!authOverlay.hidden) {
      if (authOverlay.classList.contains('is-recovery')) authSubmit.innerHTML = 'Сохранить пароль <span aria-hidden="true">↗</span>';
      else if (authOverlay.classList.contains('is-register')) authSubmit.innerHTML = 'Зарегистрироваться <span aria-hidden="true">↗</span>';
      else authSubmit.innerHTML = 'Войти <span aria-hidden="true">↗</span>';
    }
  }
});

updateAuthButton();
loadTasks();
