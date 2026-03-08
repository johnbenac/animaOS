const DEFAULT_API_BASE = "http://127.0.0.1:3031/api";

const configuredBase = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE;

export const API_BASE = configuredBase.replace(/\/$/, "");

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) return `${API_BASE}/${path}`;
  return `${API_BASE}${path}`;
}
