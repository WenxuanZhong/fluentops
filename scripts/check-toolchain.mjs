import {
  detectRuntime,
  expectedNodeIsRange,
  expectedNodeMajor,
  expectedNodeSpec,
  expectedPnpmVersion,
  printResults,
  summarizeResults,
} from './toolchain-lib.mjs';

const mode = process.argv.includes('--mode=strict') ? 'strict' : 'warn';
const runtime = detectRuntime();
const results = [];

const nodeMatchesContract = expectedNodeIsRange
  ? runtime.nodeMajor >= expectedNodeMajor
  : runtime.nodeMajor === expectedNodeMajor;

if (nodeMatchesContract) {
  results.push({
    level: 'ok',
    message: `Node.js ${runtime.nodeVersion} satisfies the workspace contract (${expectedNodeSpec}).`,
  });
} else {
  results.push({
    level: mode === 'strict' ? 'fail' : 'warn',
    message: `Node.js ${runtime.nodeVersion} is outside the workspace contract (${expectedNodeSpec}).`,
    detail: expectedNodeIsRange
      ? `Use Node ${expectedNodeMajor}.x or any newer LTS. The contract is open-ended, so any Node version at or above ${expectedNodeMajor}.x is supported.`
      : `Use Node ${expectedNodeMajor}.x for local work. CI uses the same version, so other majors are not treated as supported even if some commands appear to work.`,
  });
}

if (!expectedPnpmVersion) {
  results.push({
    level: 'warn',
    message: 'Could not determine the expected pnpm version from package.json.',
  });
} else if (runtime.currentPnpmVersion === expectedPnpmVersion) {
  results.push({
    level: 'ok',
    message: `pnpm ${runtime.currentPnpmVersion} matches the workspace contract.`,
  });
} else {
  results.push({
    level: mode === 'strict' ? 'fail' : 'warn',
    message: `pnpm ${runtime.currentPnpmVersion ?? 'unknown'} does not match the workspace contract (${expectedPnpmVersion}).`,
    detail:
      'Use Corepack with the repo-pinned packageManager version before running workspace commands.',
  });
}

if (runtime.corepackVersion) {
  results.push({
    level: 'ok',
    message: `Corepack is available (${runtime.corepackVersion}).`,
  });
} else {
  results.push({
    level: mode === 'strict' ? 'fail' : 'warn',
    message: 'Corepack is not available in PATH.',
    detail:
      'Enable Corepack so pnpm 9.15.4 can be provisioned consistently on both local machines and CI.',
  });
}

if (runtime.platform === 'linux' && runtime.libc === 'musl') {
  results.push({
    level: mode === 'strict' ? 'fail' : 'warn',
    message: 'Linux musl runtime detected.',
    detail:
      'The documented support matrix is Windows PowerShell plus glibc-based Linux/WSL/CI. Alpine-style musl environments are outside the current contract.',
  });
} else if (runtime.platform === 'win32' || runtime.platform === 'linux') {
  const distro = runtime.platform === 'linux' ? `${runtime.platform}/${runtime.libc ?? 'unknown-libc'}` : runtime.platform;
  results.push({
    level: 'ok',
    message: `Runtime platform ${distro} ${runtime.arch} is within the documented support matrix.`,
  });
} else {
  results.push({
    level: 'warn',
    message: `Runtime platform ${runtime.platform} ${runtime.arch} is outside the documented support matrix.`,
    detail:
      'The repo may still work there, but only Windows PowerShell and glibc-based Linux/WSL/CI are treated as supported environments right now.',
  });
}

if (runtime.isMountedWindowsCheckout) {
  results.push({
    level: 'warn',
    message: 'WSL is operating on a Windows-mounted checkout.',
    detail:
      'This is supported for this repo, but native dependency issues should be fixed by rerunning `pnpm install` after changing toolchains or if Rollup/Vite/Vitest start failing again.',
  });
}

printResults(results);

const summary = summarizeResults(results);
if (mode === 'strict' && summary.fail > 0) {
  process.exit(1);
}
