import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import path from 'path';
import { config as loadEnv } from 'dotenv';

export interface ScratchDb {
  url: string;
  drop: () => void;
}

const REPO_ROOT = path.resolve(process.cwd(), '../..');

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  execFileSync(cmd, args, {
    stdio: 'pipe',
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
  });
}

export function createScratchDb(): ScratchDb {
  const name = `frigat_test_${randomBytes(6).toString('hex')}`;

  loadEnv({ path: path.join(process.cwd(), '.env'), quiet: true });

  const template = process.env.DATABASE_URL;
  if (!template) {
    throw new Error(
      'DATABASE_URL is not set and apps/server/.env did not supply one — integration tests need a reachable Postgres.'
    );
  }
  const url = new URL(template);
  url.pathname = `/${name}`;
  url.search = 'schema=public';

  const admin = new URL(template);
  admin.search = '';

  const drop = () => {
    try {
      run('psql', [admin.toString(), '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS "${name}"`]);
    } catch {
    }
  };

  run('psql', [admin.toString(), '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${name}"`]);
  try {
    run('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
      DATABASE_URL: url.toString(),
    });
  } catch (err) {
    drop();
    throw err;
  }

  return {
    url: url.toString(),
    drop,
  };
}
