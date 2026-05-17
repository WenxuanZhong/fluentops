import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const repoRoot = join(__dirname, '..');

const packageJson = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);

export const expectedNodeSpec = packageJson.engines?.node ?? '>=20';
export const expectedNodeMajor = parseExpectedNodeMajor(expectedNodeSpec);
export const expectedNodeIsRange = /^[<>=]/.test(expectedNodeSpec.trim());
export const expectedPnpmVersion = parseExpectedPnpmVersion(
  packageJson.packageManager,
);

function parseExpectedNodeMajor(spec) {
  const match = spec.match(/\d+/);
  return match ? Number(match[0]) : 20;
}

function parseExpectedPnpmVersion(packageManager) {
  if (typeof packageManager !== 'string') {
    return null;
  }

  const match = packageManager.match(/^pnpm@(.+)$/);
  return match ? match[1] : null;
}

function parseUserAgentVersion(userAgent, tool) {
  if (!userAgent) {
    return null;
  }

  const match = userAgent.match(new RegExp(`${tool}/([^\\s]+)`));
  return match ? match[1] : null;
}

function execVersion(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  });

  if (result.status !== 0) {
    return null;
  }

  const value = `${result.stdout}${result.stderr}`.trim();
  return value || null;
}

function getReportHeader() {
  try {
    if (process.platform !== 'win32') {
      return process.report?.getReport()?.header ?? null;
    }

    // Rollup avoids process.report.getReport() directly on Windows for stability.
    const child = spawnSync(
      process.execPath,
      ['-p', "console.log(JSON.stringify(require('node:process').report.getReport().header));"],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
      },
    );

    if (child.status !== 0) {
      return null;
    }

    const stdout = child.stdout?.replace(/undefined\r?\n?$/, '').trim();
    return stdout ? JSON.parse(stdout) : null;
  } catch {
    return null;
  }
}

function isMingw32(reportHeader) {
  return reportHeader?.osName?.startsWith('MINGW32_NT') ?? false;
}

function detectLibc(reportHeader) {
  if (process.platform !== 'linux') {
    return null;
  }

  return reportHeader?.glibcVersionRuntime ? 'glibc' : 'musl';
}

export function getExpectedRollupPackage(runtime) {
  const bindings = {
    android: {
      arm: { base: 'android-arm-eabi' },
      arm64: { base: 'android-arm64' },
    },
    darwin: {
      arm64: { base: 'darwin-arm64' },
      x64: { base: 'darwin-x64' },
    },
    freebsd: {
      arm64: { base: 'freebsd-arm64' },
      x64: { base: 'freebsd-x64' },
    },
    linux: {
      arm: { base: 'linux-arm-gnueabihf', musl: 'linux-arm-musleabihf' },
      arm64: { base: 'linux-arm64-gnu', musl: 'linux-arm64-musl' },
      loong64: { base: 'linux-loong64-gnu', musl: 'linux-loong64-musl' },
      ppc64: { base: 'linux-ppc64-gnu', musl: 'linux-ppc64-musl' },
      riscv64: { base: 'linux-riscv64-gnu', musl: 'linux-riscv64-musl' },
      s390x: { base: 'linux-s390x-gnu', musl: null },
      x64: { base: 'linux-x64-gnu', musl: 'linux-x64-musl' },
    },
    openbsd: {
      x64: { base: 'openbsd-x64' },
    },
    openharmony: {
      arm64: { base: 'openharmony-arm64' },
    },
    win32: {
      arm64: { base: 'win32-arm64-msvc' },
      ia32: { base: 'win32-ia32-msvc' },
      x64: {
        base: runtime.isMingw32 ? 'win32-x64-gnu' : 'win32-x64-msvc',
      },
    },
  };

  const platformBindings = bindings[runtime.platform];
  const archBindings = platformBindings?.[runtime.arch];

  if (!archBindings) {
    return null;
  }

  if ('musl' in archBindings && runtime.libc === 'musl') {
    return archBindings.musl
      ? `@rollup/rollup-${archBindings.musl}`
      : null;
  }

  return `@rollup/rollup-${archBindings.base}`;
}

export function isPackageInstalled(packageName) {
  const pnpmStore = join(repoRoot, 'node_modules', '.pnpm');
  if (!existsSync(pnpmStore)) {
    return false;
  }

  const encodedName = packageName.replace('/', '+');
  return readdirSync(pnpmStore).some((entry) => entry.startsWith(`${encodedName}@`));
}

export function hasCommand(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], {
    cwd: repoRoot,
    stdio: 'ignore',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  return result.status === 0;
}

export function detectRuntime() {
  const reportHeader = getReportHeader();
  const userAgent = process.env.npm_config_user_agent ?? '';
  const currentPnpmVersion =
    parseUserAgentVersion(userAgent, 'pnpm') ??
    execVersion('corepack', ['pnpm', '--version']) ??
    execVersion(join(repoRoot, '.pnpm-bin', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'), ['--version']);
  const nodeVersion = process.versions.node;
  const nodeMajor = Number(nodeVersion.split('.')[0]);
  const libc = detectLibc(reportHeader);
  const isWsl =
    process.platform === 'linux' &&
    (Boolean(process.env.WSL_DISTRO_NAME) ||
      reportHeader?.osRelease?.toLowerCase().includes('microsoft') === true);
  const isMountedWindowsCheckout =
    isWsl && repoRoot.startsWith('/mnt/');

  return {
    repoRoot,
    cwd: process.cwd(),
    nodeVersion,
    nodeMajor,
    currentPnpmVersion,
    corepackVersion: hasCommand('corepack') ? execVersion('corepack', ['--version']) : null,
    platform: process.platform,
    arch: process.arch,
    libc,
    reportHeader,
    isWsl,
    isMingw32: isMingw32(reportHeader),
    isMountedWindowsCheckout,
  };
}

export function summarizeResults(results) {
  return results.reduce(
    (summary, result) => {
      summary[result.level] += 1;
      return summary;
    },
    { ok: 0, warn: 0, fail: 0 },
  );
}

export function printResults(results) {
  for (const result of results) {
    const label = `[${result.level}]`.padEnd(7, ' ');
    console.log(`${label} ${result.message}`);
    if (result.detail) {
      console.log(`        ${result.detail}`);
    }
  }

  const summary = summarizeResults(results);
  console.log(
    `Summary: ${summary.ok} ok, ${summary.warn} warn, ${summary.fail} fail`,
  );
}
