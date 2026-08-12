export type AuthUser = { id: string; email: string; name: string };
export type AuthSession = { token: string; user: AuthUser };

const SESSION_KEY = "icanvas:session";
const SYNC_HTTP_URL = process.env.NEXT_PUBLIC_SYNC_HTTP_URL ?? "http://localhost:1234";

export function getSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? "null") as AuthSession | null;
    return value?.token && value.user?.id ? value : null;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveSession(session: AuthSession) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getSession();
  const response = await fetch(`${SYNC_HTTP_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      ...init.headers
    }
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The request failed.");
  return payload;
}

export async function authenticate(mode: "login" | "register", input: { email: string; name?: string; password: string }) {
  const response = await fetch(`${SYNC_HTTP_URL}/api/auth/${mode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const payload = (await response.json()) as AuthSession & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Authentication failed.");
  saveSession(payload);
  return payload;
}
