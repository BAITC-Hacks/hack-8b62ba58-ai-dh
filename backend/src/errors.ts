export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function check(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new ApiError(status, code, message);
}
export function object(value: unknown): Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value), 400, 'INVALID_BODY', 'JSON объектісі қажет.');
  return value as Record<string, unknown>;
}
export function only(body: Record<string, unknown>, allowed: string[]) {
  const unknown = Object.keys(body).filter(k => !allowed.includes(k));
  check(!unknown.length, 400, 'UNKNOWN_FIELDS', 'Белгісіз өрістер: ' + unknown.join(', '));
}
export function text(value: unknown, name: string, max = 10000, required = true): string {
  check(typeof value === 'string', 400, 'VALIDATION_ERROR', name + ': мәтін қажет.');
  check(value.length <= max && (!required || value.trim().length > 0), 400, 'VALIDATION_ERROR', name + ': бос емес, ' + max + ' таңбадан аспайтын мәтін қажет.');
  return value.trim();
}
