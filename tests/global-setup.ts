import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function globalSetup() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const databaseUrl = process.env.STILL_E2E_DATABASE_URL ?? 'postgresql://127.0.0.1:55432/still_e2e';
  execFileSync('.venv/bin/python', ['-m', 'backend.reset_test_database'], {
    cwd: root,
    env: { ...process.env, STILL_E2E_DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}
