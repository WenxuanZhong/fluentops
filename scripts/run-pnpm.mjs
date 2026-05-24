import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import './ensure-pnpm.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const rawArgs = process.argv.slice(2);
const extraEnv = {};
const args = [];

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];

  if (arg === '--env') {
    const assignment = rawArgs[index + 1];
    if (!assignment || !assignment.includes('=')) {
      console.error('[run-pnpm] `--env` expects KEY=VALUE');
      process.exit(1);
    }

    const [key, ...valueParts] = assignment.split('=');
    extraEnv[key] = valueParts.join('=');
    index += 1;
    continue;
  }

  args.push(arg);
}

const pnpmBin = process.platform === 'win32'
  ? join(repoRoot, '.pnpm-bin', 'pnpm.cmd')
  : join(repoRoot, '.pnpm-bin', 'pnpm');

const isWindows = process.platform === 'win32';
const child = spawn(pnpmBin, args, {
  cwd: repoRoot,
  env: {
    ...process.env,
    ...extraEnv,
  },
  stdio: 'inherit',
  shell: isWindows,
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error('[run-pnpm] Failed to start pnpm', error);
  process.exit(1);
});
