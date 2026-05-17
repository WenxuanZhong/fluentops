import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectRuntime,
  expectedNodeIsRange,
  expectedNodeMajor,
  expectedNodeSpec,
  expectedPnpmVersion,
  getExpectedRollupPackage,
  hasCommand,
  isPackageInstalled,
  printResults,
  summarizeResults,
} from './toolchain-lib.mjs';

const runtime = detectRuntime();
const results = [];

const nodeMatchesContract = expectedNodeIsRange
  ? runtime.nodeMajor >= expectedNodeMajor
  : runtime.nodeMajor === expectedNodeMajor;

if (nodeMatchesContract) {
  results.push({
    level: 'ok',
    message: `Node.js ${runtime.nodeVersion} satisfies the required range (${expectedNodeSpec}).`,
  });
} else {
  results.push({
    level: 'fail',
    message: `Node.js ${runtime.nodeVersion} does not satisfy the workspace contract (${expectedNodeSpec}).`,
    detail: expectedNodeIsRange
      ? `Install Node ${expectedNodeMajor}.x or any newer LTS, then rerun \`pnpm doctor:env\`.`
      : `Install Node ${expectedNodeMajor}.x, then rerun \`pnpm doctor:env\`. CI is pinned to Node ${expectedNodeMajor}.`,
  });
}

if (runtime.currentPnpmVersion === expectedPnpmVersion) {
  results.push({
    level: 'ok',
    message: `pnpm ${runtime.currentPnpmVersion} matches the pinned packageManager version.`,
  });
} else {
  results.push({
    level: 'fail',
    message: `pnpm ${runtime.currentPnpmVersion ?? 'unknown'} does not match the pinned packageManager version (${expectedPnpmVersion}).`,
    detail:
      'Run `corepack prepare pnpm@9.15.4 --activate` before reinstalling dependencies.',
  });
}

if (runtime.corepackVersion) {
  results.push({
    level: 'ok',
    message: `Corepack is available (${runtime.corepackVersion}).`,
  });
} else {
  results.push({
    level: 'fail',
    message: 'Corepack is missing from PATH.',
    detail:
      'This repo expects Corepack so the pnpm version is reproducible across local setups and CI.',
  });
}

const nodeModulesDir = join(runtime.repoRoot, 'node_modules');
if (existsSync(nodeModulesDir)) {
  results.push({
    level: 'ok',
    message: 'node_modules is present.',
  });
} else {
  results.push({
    level: 'fail',
    message: 'node_modules is missing.',
    detail:
      'Run `pnpm install` at the repo root before running workspace commands.',
  });
}

const rollupPackage = getExpectedRollupPackage(runtime);
if (!rollupPackage) {
  results.push({
    level: 'warn',
    message: `No Rollup native package mapping is defined for ${runtime.platform}/${runtime.arch}${runtime.libc ? `/${runtime.libc}` : ''}.`,
    detail:
      'This environment is outside the current support matrix, so native frontend tooling may require extra work.',
  });
} else if (isPackageInstalled(rollupPackage)) {
  results.push({
    level: 'ok',
    message: `Current-platform Rollup native package is installed (${rollupPackage}).`,
  });
} else {
  results.push({
    level: 'fail',
    message: `Current-platform Rollup native package is missing (${rollupPackage}).`,
    detail:
      'Run `pnpm install` at the repo root. If you are switching between PowerShell and WSL on the same checkout, a reinstall is required to hydrate the missing native package set.',
  });
}

const turboBin = join(nodeModulesDir, '.bin', process.platform === 'win32' ? 'turbo.cmd' : 'turbo');
if (existsSync(turboBin)) {
  results.push({
    level: 'ok',
    message: 'Turbo workspace binary is installed.',
  });
} else {
  results.push({
    level: 'fail',
    message: 'Turbo workspace binary is missing from node_modules/.bin.',
    detail:
      'Reinstall dependencies at the repo root so root workspace scripts can run.',
  });
}

if (hasCommand('docker')) {
  results.push({
    level: 'ok',
    message: 'Docker CLI is available.',
  });
} else {
  results.push({
    level: 'warn',
    message: 'Docker CLI is not available.',
    detail:
      'That is acceptable only if you provide Postgres, Redis, and MinIO by other means. Local quick start uses Docker Desktop.',
  });
}

if (runtime.isMountedWindowsCheckout) {
  results.push({
    level: 'warn',
    message: 'WSL is operating on a Windows-mounted checkout.',
    detail:
      'This repo supports that flow, but native frontend dependencies should always be refreshed with `pnpm install` after toolchain changes.',
  });
}

printResults(results);

const summary = summarizeResults(results);
if (summary.fail > 0) {
  process.exit(1);
}
