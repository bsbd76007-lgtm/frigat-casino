const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 20;
const MAX_PER_ACCOUNT = 8;
const ACCOUNT_LOCKOUT_MS = 15 * 60 * 1000;

const attempts = new Map<string, { count: number; resetAt: number }>();

function sweep(now: number) {
  if (attempts.size <= 10_000) return;
  for (const [k, v] of attempts) if (now >= v.resetAt) attempts.delete(k);
}

function bump(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now >= entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    sweep(now);
    return false;
  }

  entry.count += 1;
  return entry.count > max;
}

function isLocked(key: string, max: number): boolean {
  const entry = attempts.get(key);
  if (!entry || Date.now() >= entry.resetAt) return false;
  return entry.count > max;
}

function ipKey(ip: string, scope: string) {
  return `${scope}:ip:${ip}`;
}

function accountKey(scope: string, email: string) {
  return `${scope}:account:${email}`;
}

export function throttled(ip: string, scope: string, email?: string): boolean {
  if (bump(ipKey(ip, scope), MAX_PER_IP, WINDOW_MS)) return true;
  if (email && isLocked(accountKey(scope, email), MAX_PER_ACCOUNT)) return true;
  return false;
}

export function recordAccountFailure(scope: string, email: string) {
  bump(accountKey(scope, email), MAX_PER_ACCOUNT, ACCOUNT_LOCKOUT_MS);
}

export function clearThrottle(ip: string, scope: string, email?: string) {
  attempts.delete(ipKey(ip, scope));
  if (email) attempts.delete(accountKey(scope, email));
}

export function resetRateLimits() {
  attempts.clear();
}
