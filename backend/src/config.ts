const developmentOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'];

/** Build the allowlist from trusted server configuration, never the request's Host header. */
export function configuredOrigins(host: string, port: number, extra?: string): string[] {
  const hosts = new Set(['127.0.0.1', 'localhost']);
  if (host !== '0.0.0.0' && host !== '::') hosts.add(host);
  const sameOrigin = [...hosts].map(value => `http://${value.includes(':') && !value.startsWith('[') ? `[${value}]` : value}:${port}`);
  const others = extra === undefined ? developmentOrigins : extra.split(',').map(value => value.trim()).filter(Boolean);
  return [...new Set([...sameOrigin, ...others])];
}
