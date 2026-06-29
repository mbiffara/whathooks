import { auth } from "@/auth";

const API_URL = process.env.API_URL ?? "http://localhost:3001/v1";

/**
 * Server-side fetch against the backend, attaching the current user's JWT.
 * Use inside server components / route handlers.
 */
export async function apiServer<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const session = await auth();
  const token = session?.accessToken;

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
