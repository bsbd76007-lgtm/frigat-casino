'use client';

import { PASSWORD_POLICY, passwordProblems } from '@frigat/shared';

export const PASSWORD_RULES = [
  { code: 'too_short', label: `At least ${PASSWORD_POLICY.minLength} characters` },
  { code: 'missing_uppercase', label: 'An uppercase letter' },
  { code: 'missing_lowercase', label: 'A lowercase letter' },
  { code: 'missing_digit', label: 'A number' },
] as const;

export interface PasswordState {
  failing: Set<string>;
  ready: boolean;
}

export function evaluatePassword(password: string): PasswordState {
  const failing = new Set(passwordProblems(password).map((problem) => problem.code));
  return { failing, ready: password.length > 0 && failing.size === 0 };
}
