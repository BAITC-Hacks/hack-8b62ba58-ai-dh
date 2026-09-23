export class ApiError extends Error {
  constructor(message, status = 0, code = 'NETWORK_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function createApi(getActor) {
  async function request(path, method = 'GET', body) {
    const actor = getActor();
    const headers = { Accept: 'application/json', 'X-Demo-Role': actor.role };
    if (actor.teamId) headers['X-Team-Id'] = actor.teamId;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(`/api${path}`, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
    } catch (error) {
      throw new ApiError(error.name === 'TimeoutError'
        ? 'Сервер не ответил вовремя. Проверьте сохранённые данные перед повторной отправкой.'
        : 'Не удалось связаться с сервером. Проверьте соединение и повторите попытку.');
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(payload?.error?.message || `Ошибка сервера (${response.status}).`, response.status, payload?.error?.code || 'HTTP_ERROR');
    if (!payload || !Object.hasOwn(payload, 'data')) throw new ApiError('Сервер вернул неожиданный ответ.', response.status, 'INVALID_RESPONSE');
    return payload;
  }
  const id = encodeURIComponent;
  return {
    health: () => request('/health'),
    meta: () => request('/meta'),
    teams: () => request('/teams'),
    catalog: filters => request(`/tasks?${new URLSearchParams(filters)}`),
    businessTasks: () => request('/business/tasks'),
    task: taskId => request(`/tasks/${id(taskId)}`),
    create: (draft, topic) => request('/tasks', 'POST', { draft, topic }),
    update: (taskId, expectedRevision, changes) => request(`/tasks/${id(taskId)}`, 'PATCH', { expectedRevision, ...changes }),
    clarify: (taskId, expectedRevision) => request(`/tasks/${id(taskId)}/clarify`, 'POST', { expectedRevision }),
    confirm: (taskId, expectedRevision) => request(`/tasks/${id(taskId)}/confirm`, 'POST', { expectedRevision }),
    publish: (taskId, expectedRevision) => request(`/tasks/${id(taskId)}/publish`, 'POST', { expectedRevision }),
    proposals: taskId => request(`/tasks/${id(taskId)}/proposals`),
    propose: (taskId, offer) => request(`/tasks/${id(taskId)}/proposals`, 'POST', offer),
    decide: (proposalId, expectedRevision, status) => request(`/proposals/${id(proposalId)}`, 'PATCH', { expectedRevision, status }),
    milestone: (taskId, teamId, stage, evidence) => request(`/tasks/${id(taskId)}/milestones/confirm`, 'POST', { teamId, stage, evidence }),
  };
}
