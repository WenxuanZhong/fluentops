import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(join(__dirname, '..'));
const infraDir = join(repoRoot, 'infra');
const composeFile = join(infraDir, 'docker-compose.prod.yml');
const workDir = join(repoRoot, '.local-prod-smoke');
const certsDir = join(workDir, 'certs');
const envFile = join(workDir, '.env.prod.smoke');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keep = args.includes('--keep');
const skipBuild = args.includes('--skip-build');
const help = args.includes('--help') || args.includes('-h');
const timeoutMs = Number(readArg('--timeout-ms') ?? 240000);
const projectName = normalizeProjectName(readArg('--project-name') ?? `fluentops-smoke-${Date.now()}`);
const httpPort = Number(readArg('--http-port') ?? 18080);
const httpsPort = Number(readArg('--https-port') ?? 18443);

if (help) {
  console.log(`Usage: node ./scripts/prod-smoke.mjs [options]

Builds and starts the production Docker Compose stack with temporary env values,
self-signed TLS certs, high edge ports, and isolated volumes. It waits for the
public edge /health endpoint, verifies the object proxy and web shell, then tears
the stack down.

Options:
  --dry-run              Generate and validate inputs without Docker or OpenSSL.
  --keep                 Leave containers, volumes, env, and certs for debugging.
  --skip-build           Run compose up without --build.
  --project-name <name>  Docker Compose project name.
  --http-port <port>     Host HTTP port for edge nginx. Default: 18080.
  --https-port <port>    Host HTTPS port for edge nginx. Default: 18443.
  --timeout-ms <ms>      Health wait timeout. Default: 240000.`);
  process.exit(0);
}

assertWithinRepo(workDir);
const envContent = buildEnv();

if (dryRun) {
  prepareWorkDir();
  try {
    writeFileSync(envFile, envContent);
    runNode(['./scripts/verify-prod.mjs', '--env-file', relative(repoRoot, envFile)]);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  console.log('[prod-smoke] Dry run generated production smoke inputs.');
  console.log(`[prod-smoke] Project: ${projectName}`);
  console.log(`[prod-smoke] HTTPS health URL: https://127.0.0.1:${httpsPort}/health`);
  process.exit(0);
}

requireCommand('docker', ['--version']);
requireCommand('openssl', ['version']);

prepareWorkDir();
writeFileSync(envFile, envContent);
generateCertificate();

let started = false;
try {
  console.log('[prod-smoke] Verifying generated production environment.');
  runNode(['./scripts/verify-prod.mjs', '--env-file', relative(repoRoot, envFile)]);
  console.log('[prod-smoke] Rendering production compose config.');
  compose(['config'], { stdio: 'pipe' });
  started = true;
  console.log(`[prod-smoke] Starting production compose stack for project ${projectName}.`);
  compose(['up', '-d', ...(skipBuild ? [] : ['--build'])]);

  console.log(`[prod-smoke] Waiting for edge health at https://127.0.0.1:${httpsPort}/health.`);
  const health = await waitForHealth();
  if (
    health.status !== 'ok' ||
    health.db !== 'up' ||
    health.redis !== 'up' ||
    health.storage !== 'up'
  ) {
    throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
  }

  console.log('[prod-smoke] Verifying object storage proxy.');
  await waitForObjectsProxy();
  console.log('[prod-smoke] Verifying web shell.');
  await waitForWebShell();
  console.log('[prod-smoke] Production compose smoke test passed.');
} catch (error) {
  console.error(`[prod-smoke] ${error instanceof Error ? error.message : error}`);
  if (started) {
    dumpComposeDiagnostics();
  }
  process.exitCode = 1;
} finally {
  if (!keep) {
    compose(['down', '--volumes', '--remove-orphans'], { allowFailure: true });
    rmSync(workDir, { recursive: true, force: true });
  } else {
    console.log(`[prod-smoke] Kept smoke assets at ${relative(repoRoot, workDir)}.`);
  }
}

function buildEnv() {
  const certsPathForCompose = relative(infraDir, certsDir).replaceAll('\\', '/');
  return [
    'NODE_ENV=production',
    'PORT=3000',
    `FLUENTOPS_IMAGE_TAG=${projectName}`,
    `EDGE_HTTP_PORT=${httpPort}`,
    `EDGE_HTTPS_PORT=${httpsPort}`,
    `FLUENTOPS_VOLUME_PREFIX=${projectName}`,
    `NGINX_CERTS_DIR=${certsPathForCompose}`,
    'CURL_IMAGE=curlimages/curl:8.11.1',
    'POSTGRES_DB=fluentops_smoke',
    'POSTGRES_USER=fluentops',
    `POSTGRES_PASSWORD=${secret(32)}`,
    `JWT_SECRET=${secret(48)}`,
    `REFRESH_SECRET=${secret(48)}`,
    'ACCESS_TOKEN_TTL=15m',
    'REFRESH_TOKEN_TTL=7d',
    'WS_TICKET_TTL=60s',
    'COOKIE_DOMAIN=',
    `CORS_ORIGIN=https://127.0.0.1:${httpsPort}`,
    `REDIS_PASSWORD=${secret(32)}`,
    `MINIO_ACCESS_KEY=fluentops_${token(12)}`,
    `MINIO_SECRET_KEY=${secret(32)}`,
    'MINIO_BUCKET=fluentops-smoke',
    `MINIO_PUBLIC_URL=https://127.0.0.1:${httpsPort}/objects`,
    'AI_PROVIDER=openai',
    `OPENAI_API_KEY=smoke-openai-key-${token(24)}`,
    'MODEL_NAME=gpt-4o-mini',
    'AI_TEMPERATURE=0.7',
    'BILLING_PROVIDER=alipay',
    'ALIPAY_APP_ID=fluentops-smoke',
    'ALIPAY_PRIVATE_KEY=fluentops-smoke-private-key',
    'ALIPAY_PUBLIC_KEY=fluentops-smoke-public-key',
    'ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do',
    `ALIPAY_NOTIFY_URL=https://127.0.0.1:${httpsPort}/api/v1/billing/alipay/notify`,
    'EMAIL_PROVIDER=resend',
    'EMAIL_FROM=noreply@fluentops-smoke.local',
    `RESEND_API_KEY=smoke-resend-key-${token(24)}`,
    'VITE_API_BASE_URL=/api/v1',
    '',
  ].join('\n');
}

function prepareWorkDir() {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(certsDir, { recursive: true });
}

function generateCertificate() {
  run('openssl', [
    'req',
    '-x509',
    '-nodes',
    '-days',
    '1',
    '-newkey',
    'rsa:2048',
    '-subj',
    '/CN=localhost',
    '-keyout',
    join(certsDir, 'privkey.pem'),
    '-out',
    join(certsDir, 'fullchain.pem'),
  ]);
}

async function waitForHealth() {
  const url = `https://127.0.0.1:${httpsPort}/health`;
  const startedAt = Date.now();
  let lastError = '';

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await httpsJson(url);
      if (response.statusCode === 200) {
        return JSON.parse(response.body);
      }
      lastError = `HTTP ${response.statusCode}: ${response.body}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(3000);
  }

  throw new Error(`Timed out waiting for ${url}. Last error: ${lastError}`);
}

async function waitForWebShell() {
  const url = `https://127.0.0.1:${httpsPort}/`;
  const response = await httpsText(url);
  if (response.statusCode !== 200 || !response.body.includes('<div id="app">')) {
    throw new Error(`Unexpected web shell response from ${url}: HTTP ${response.statusCode}`);
  }
}

async function waitForObjectsProxy() {
  const url = `https://127.0.0.1:${httpsPort}/objects/minio/health/live`;
  const response = await httpsText(url);
  if (response.statusCode !== 200) {
    throw new Error(`Unexpected object proxy response from ${url}: HTTP ${response.statusCode}`);
  }
}

function httpsJson(url) {
  return httpsRequest(url, { accept: 'application/json' });
}

function httpsText(url) {
  return httpsRequest(url, { accept: 'text/html' });
}

function httpsRequest(url, { accept }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = https.get(
      url,
      {
        rejectUnauthorized: false,
        timeout: 5000,
        headers: { Accept: accept },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolvePromise({ statusCode: response.statusCode ?? 0, body });
        });
      },
    );
    request.on('timeout', () => {
      request.destroy(new Error(`Request timed out: ${url}`));
    });
    request.on('error', rejectPromise);
  });
}

function compose(composeArgs, options = {}) {
  return run(
    'docker',
    [
      'compose',
      '-p',
      projectName,
      '-f',
      composeFile,
      '--env-file',
      envFile,
      ...composeArgs,
    ],
    options,
  );
}

function runNode(nodeArgs) {
  return run(process.execPath, nodeArgs);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  });

  if (result.status !== 0 && !options.allowFailure) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(
      `${command} ${commandArgs.join(' ')} failed with exit code ${result.status ?? 1}${output ? `\n${output}` : ''}`,
    );
  }

  return result;
}

function dumpComposeDiagnostics() {
  compose(['ps', '-a'], { allowFailure: true });
  compose(['logs', '--tail=200', 'migrate', 'api-gateway', 'web', 'edge', 'postgres', 'redis', 'minio', 'minio-ready'], {
    allowFailure: true,
  });
}

function requireCommand(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'ignore',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`[prod-smoke] Required command is unavailable: ${command}`);
  }
}

function assertWithinRepo(target) {
  const relativePath = relative(repoRoot, resolve(target));
  if (relativePath.startsWith('..') || relativePath === '') {
    throw new Error(`[prod-smoke] Refusing to operate outside the repo: ${target}`);
  }
}

function readArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function secret(bytes) {
  return randomBytes(bytes).toString('base64url');
}

function token(bytes) {
  return randomBytes(bytes).toString('hex');
}

function normalizeProjectName(value) {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 48);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
