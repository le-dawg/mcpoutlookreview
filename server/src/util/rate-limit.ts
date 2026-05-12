const LIMIT = 60;
const WINDOW_MS = 60_000;

const calls = new Map<string, number[]>();

export function checkRateLimit(key: string): { ok: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const recent = (calls.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= LIMIT) {
    const oldest = recent[0]!;
    return { ok: false, retryAfterMs: WINDOW_MS - (now - oldest) };
  }
  recent.push(now);
  calls.set(key, recent);
  return { ok: true };
}
