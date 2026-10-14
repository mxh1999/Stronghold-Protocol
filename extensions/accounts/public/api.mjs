export async function api(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`/_account/api/${path}`, { method, credentials: 'same-origin', cache: 'no-store',
    signal: signal || AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'X-SP-Account': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error), { status: response.status });
  return value;
}
