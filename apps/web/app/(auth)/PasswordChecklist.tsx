'use client';

import { PASSWORD_RULES } from '@/app/(auth)/passwordRules';

export interface PasswordChecklistProps {
  password: string;
  failing: Set<string>;
  id?: string;
}

export function PasswordChecklist({ password, failing, id }: PasswordChecklistProps) {
  return (
    <ul className="auth__rules" id={id}>
      {PASSWORD_RULES.map((rule) => {
        const met = password.length > 0 && !failing.has(rule.code);
        return (
          <li key={rule.code} className={met ? 'auth__rule auth__rule--met' : 'auth__rule'}>
            <span aria-hidden="true">{met ? '✓' : '•'}</span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}

export default PasswordChecklist;
