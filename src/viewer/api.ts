export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}
export async function authenticate() {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("token");
  if (token) {
    await api("/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  } else await api("/reviews");
}
export const post = <T>(url: string, value: unknown, method = "POST") =>
  api<T>(url, { method, body: JSON.stringify(value) });
