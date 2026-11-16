import { demoRequest, isDemo } from "@/lib/demo";

export class ApiError extends Error {}

function root(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  token = "",
): Promise<T> {
  if (isDemo()) {
    try {
      return demoRequest<T>(path, init, token);
    } catch (err: unknown) {
      throw new ApiError(err instanceof Error ? err.message : "The request failed.");
    }
  }
  const base = root();
  if (!base) {
    throw new ApiError("Set NEXT_PUBLIC_API_URL and restart the page.");
  }
  const headers = new Headers(init.headers);
  if (init.body) {
    headers.set("content-type", "application/json");
  }
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  let data: { error?: string } = {};
  if (text) {
    try {
      data = JSON.parse(text) as { error?: string };
    } catch {
      throw new ApiError("The server sent an unreadable response.");
    }
  }
  if (!response.ok) {
    throw new ApiError(data.error || "The request failed.");
  }
  return data as T;
}

const TOKEN_KEY = "admin_token";

export function adminToken(): string {
  if (typeof sessionStorage === "undefined") {
    return "";
  }
  return sessionStorage.getItem(TOKEN_KEY) ?? "";
}

export function setAdminToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}
