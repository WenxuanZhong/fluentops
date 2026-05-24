import { spawn } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import './ensure-pnpm.mjs';
import './check-toolchain.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const pnpmBinDir = join(repoRoot, '.pnpm-bin');
const nodeBinDir = join(repoRoot, 'node_modules', '.bin');
const env = {
  ...process.env,
  PATH: [pnpmBinDir, nodeBinDir, process.env.PATH ?? ''].join(delimiter),
};

const pnpmCommand = process.platform === 'win32'
  ? join(pnpmBinDir, 'pnpm.cmd')
  : join(pnpmBinDir, 'pnpm');

const steps = [
  {
    name: 'lint',
    command: pnpmCommand,
    args: ['lint'],
    note: 'Workspace ESLint across all packages.',
  },
  {
    name: 'typecheck',
    command: pnpmCommand,
    args: ['typecheck'],
    note: 'Workspace TypeScript verification.',
  },
  {
    name: 'test',
    command: pnpmCommand,
    args: ['test'],
    note: 'Root package tests: shared + web + api-gateway.',
  },
  {
    name: 'build',
    command: pnpmCommand,
    args: ['build'],
    note: 'Production build for shared + web + api-gateway.',
  },
  {
    name: 'api-e2e',
    command: pnpmCommand,
    args: ['--filter', 'api-gateway', 'test:e2e'],
    note: 'Local API end-to-end suite (defaults to in-memory Prisma mode).',
  },
];

for (let index = 0; index < steps.length; index += 1) {
  const step = steps[index];
  console.log('');
  console.log(`[verify-local] (${index + 1}/${steps.length}) ${step.name}`);
  console.log(`[verify-local] ${step.note}`);

  const exitCode = await runStep(step.command, step.args);
  if (exitCode !== 0) {
    process.exit(exitCode ?? 1);
  }
}

console.log('');
console.log('[verify-local] All local verification steps passed.');

function runStep(command, args) {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
      shell: isWindows,
      windowsHide: true,
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 1);
    });

    child.on('error', (error) => {
      console.error(`[verify-local] Failed to start ${command}`, error);
      resolve(1);
    });
  });
}
