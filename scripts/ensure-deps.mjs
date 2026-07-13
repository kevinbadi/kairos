// Runs before `npm start` / `npm test` (needs nothing but node itself).
// Fresh clone → dependencies install automatically; no "tsx: command not
// found" for anyone who skips `npm install`.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(join(root, 'node_modules', '.bin', 'tsx'))) {
  console.log('First run — installing dependencies (one-time, takes a minute)...\n');
  try {
    execSync('npm install', { cwd: root, stdio: 'inherit' });
  } catch {
    console.error('\nDependency install failed. Run `npm install` manually and check the error above.');
    process.exit(1);
  }
  console.log('\nDependencies ready.\n');
}
