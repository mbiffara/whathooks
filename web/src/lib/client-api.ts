"use client";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/v1";

/** Error thrown for non-2xx API responses; carries the HTTP status. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** True when the API rejected the action because the org has no live plan. */
export function isSubscriptionRequired(e: unknown): boolean {
  return (
    e instanceof ApiError && e.status === 403 && /subscription/i.test(e.message)
  );
}

/**
 * Client-side fetch against the backend. Pass the access token from
 * useSession() (session.accessToken).
 */
export async function apiClient<T = unknown>(
  path: string,
  token: string | undefined,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      message = body.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(
      Array.isArray(message) ? message.join(", ") : message,
      res.status,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
