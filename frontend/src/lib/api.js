const TOKEN_KEY = 'calamelle_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`/api${path}`, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Erreur ${response.status}`);
    error.status = response.status;
    error.code = data.code || null;
    error.data = data;
    if (token && (response.status === 401 || response.status === 423)) {
      setToken(null);
      window.dispatchEvent(new CustomEvent('calamelle:session-invalid', {
        detail: { code: data.code || null, status: response.status }
      }));
    }
    throw error;
  }
  return data;
}
