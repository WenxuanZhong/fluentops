import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const args = process.argv.slice(2);
const composeOnly = args.includes('--compose-only');
const envFileArgIndex = args.indexOf('--env-file');
if (envFileArgIndex >= 0 && !args[envFileArgIndex + 1]) {
  console.error('[verify-prod] --env-file expects a path');
  process.exit(1);
}
const envFile = envFileArgIndex >= 0
  ? resolve(repoRoot, args[envFileArgIndex + 1] ?? '')
  : join(repoRoot, '.env.prod');

const composeFile = join(repoRoot, 'infra', 'docker-compose.prod.yml');
const edgeConfigFile = join(repoRoot, 'infra', 'nginx', 'edge.conf.example');
const dockerignoreFile = join(repoRoot, '.dockerignore');
const ciFile = join(repoRoot, '.github', 'workflows', 'ci.yml');
const prodSmokeFile = join(repoRoot, 'scripts', 'prod-smoke.mjs');
const compose = readFileSync(composeFile, 'utf8');
const edgeConfig = readFileSync(edgeConfigFile, 'utf8');
const dockerignore = readFileSync(dockerignoreFile, 'utf8');
const ci = readFileSync(ciFile, 'utf8');
const prodSmoke = readFileSync(prodSmokeFile, 'utf8');
const results = [];

checkCompose();
checkCi();
if (!composeOnly) {
  checkProductionEnv();
}

printResults();
const failed = results.some((result) => result.level === 'fail');
process.exit(failed ? 1 : 0);

function checkCompose() {
  const requiredFragments = [
    ['migrate service', /^ {2}migrate:\r?$/m],
    ['migrate deploy command', /prisma\r?\n\s+- migrate\r?\n\s+- deploy/m],
    ['api waits for migration', /api-gateway:[\s\S]*?depends_on:[\s\S]*?migrate:[\s\S]*?condition: service_completed_successfully/m],
    ['api waits for MinIO readiness helper', /api-gateway:[\s\S]*?depends_on:[\s\S]*?minio-ready:[\s\S]*?condition: service_completed_successfully/m],
    ['edge waits for API health', /edge:[\s\S]*?depends_on:[\s\S]*?api-gateway:[\s\S]*?condition: service_healthy/m],
    ['edge waits for web health', /edge:[\s\S]*?depends_on:[\s\S]*?web:[\s\S]*?condition: service_healthy/m],
    ['API release image tag', /x-api-gateway-image: &api-gateway-image fluentops-api-gateway:\$\{FLUENTOPS_IMAGE_TAG:-local\}/m],
    ['web release image tag', /x-web-image: &web-image fluentops-web:\$\{FLUENTOPS_IMAGE_TAG:-local\}[\s\S]*?web:\r?\n\s+image: \*web-image/m],
    ['MinIO readiness helper service', /minio-ready:[\s\S]*?image: \$\{CURL_IMAGE:-curlimages\/curl:8\.11\.1\}[\s\S]*?http:\/\/minio:9000\/minio\/health\/live/m],
    ['MinIO reachable from edge network', /minio:[\s\S]*?networks: \[internal, edge\]/m],
    ['configurable edge HTTP port', /-\s+"\$\{EDGE_HTTP_PORT:-80\}:80"/m],
    ['configurable edge HTTPS port', /-\s+"\$\{EDGE_HTTPS_PORT:-443\}:443"/m],
    ['edge nginx config mount', /infra\/nginx\/edge\.conf\.example|\.\/nginx\/edge\.conf\.example/m],
    ['configurable nginx cert mount', /\$\{NGINX_CERTS_DIR:-\.\/nginx\/certs\}:\/etc\/nginx\/certs:ro/m],
    ['web build arg', /VITE_API_BASE_URL: \$\{VITE_API_BASE_URL:-\/api\/v1\}/m],
    ['stable Postgres volume name', /pg_data:\r?\n\s+name: \$\{FLUENTOPS_VOLUME_PREFIX:-fluentops\}_pg_data/m],
    ['stable MinIO volume name', /minio_data:\r?\n\s+name: \$\{FLUENTOPS_VOLUME_PREFIX:-fluentops\}_minio_data/m],
  ];

  for (const [name, pattern] of requiredFragments) {
    add(pattern.test(compose) ? 'ok' : 'fail', `Production compose has ${name}.`);
  }

  const requiredEdgeFragments = [
    ['public API health route', /location = \/health[\s\S]*?proxy_pass http:\/\/fluentops_api;/m],
    ['WebSocket proxy route', /location \/ws\//m],
    ['API proxy route', /location \/api\//m],
    ['SSE buffering disabled', /proxy_buffering off;/m],
    ['object storage proxy route', /location \/objects\/[\s\S]*?proxy_pass http:\/\/fluentops_minio\//m],
    ['object storage proxy preserves signed host', /location \/objects\/[\s\S]*?proxy_set_header Host\s+minio:9000;/m],
    ['SPA proxy route', /location \//m],
  ];

  for (const [name, pattern] of requiredEdgeFragments) {
    add(pattern.test(edgeConfig) ? 'ok' : 'fail', `Edge nginx config has ${name}.`);
  }

  const requiredDockerignoreFragments = [
    ['node_modules excluded', /^node_modules\r?$/m],
    ['nested node_modules excluded', /^\*\*\/node_modules\r?$/m],
    ['env files excluded', /^\.env\.\*\r?$/m],
    ['nested env files excluded', /^\*\*\/\.env\.\*\r?$/m],
    ['nested bare env files excluded', /^\*\*\/\.env\r?$/m],
    ['production env template retained', /^!\.env\.prod\.example\r?$/m],
    ['nginx certs excluded', /^infra\/nginx\/certs\r?$/m],
    ['local production smoke state excluded', /^\.local-prod-smoke\r?$/m],
    ['git directory excluded', /^\.git\r?$/m],
  ];

  for (const [name, pattern] of requiredDockerignoreFragments) {
    add(pattern.test(dockerignore) ? 'ok' : 'fail', `.dockerignore has ${name}.`);
  }
}

function checkCi() {
  const requiredCiFragments = [
    ['production-ready job', /^\s{2}production-ready:\r?$/m],
    ['BuildKit enabled for production image builds', /DOCKER_BUILDKIT: "1"/m],
    ['production compose contract verification', /node \.\/scripts\/verify-prod\.mjs --compose-only/m],
    ['production compose config rendering', /docker compose -f infra\/docker-compose\.prod\.yml --env-file \.env\.prod\.example config/m],
    ['production compose smoke test', /node \.\/scripts\/prod-smoke\.mjs --timeout-ms 420000/m],
  ];

  for (const [name, pattern] of requiredCiFragments) {
    add(pattern.test(ci) ? 'ok' : 'fail', `CI has ${name}.`);
  }

  const requiredSmokeFragments = [
    ['DB health assertion', /health\.db !== 'up'/m],
    ['Redis health assertion', /health\.redis !== 'up'/m],
    ['object storage health assertion', /health\.storage !== 'up'/m],
    ['object storage proxy assertion', /\/objects\/minio\/health\/live/m],
  ];

  for (const [name, pattern] of requiredSmokeFragments) {
    add(pattern.test(prodSmoke) ? 'ok' : 'fail', `Production smoke has ${name}.`);
  }
}

function checkProductionEnv() {
  if (!existsSync(envFile)) {
    add(
      'fail',
      `Production env file is missing: ${relative(envFile)}`,
      'Create it from .env.prod.example, replace every REPLACE_ME value, then rerun `pnpm verify:prod`.',
    );
    return;
  }

  const env = parseEnvFile(readFileSync(envFile, 'utf8'));
  const required = [
    'POSTGRES_DB',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'REDIS_PASSWORD',
    'JWT_SECRET',
    'REFRESH_SECRET',
    'CORS_ORIGIN',
    'MINIO_ACCESS_KEY',
    'MINIO_SECRET_KEY',
    'MINIO_PUBLIC_URL',
    'AI_PROVIDER',
    'OPENAI_API_KEY',
    'BILLING_PROVIDER',
    'ALIPAY_APP_ID',
    'ALIPAY_PRIVATE_KEY',
    'ALIPAY_PUBLIC_KEY',
    'ALIPAY_GATEWAY',
    'ALIPAY_NOTIFY_URL',
    'EMAIL_PROVIDER',
    'EMAIL_FROM',
    'RESEND_API_KEY',
    'VITE_API_BASE_URL',
    'FLUENTOPS_IMAGE_TAG',
  ];

  for (const key of required) {
    add(env[key] ? 'ok' : 'fail', `Production env sets ${key}.`);
    if (env[key]) {
      add(!isPlaceholder(env[key]) ? 'ok' : 'fail', `${key} is not a template placeholder.`);
    }
  }

  add(env.NODE_ENV === 'production' ? 'ok' : 'fail', 'NODE_ENV is production.');
  add(env.AI_PROVIDER === 'openai' ? 'ok' : 'fail', 'AI_PROVIDER is openai.');
  add(env.BILLING_PROVIDER === 'alipay' ? 'ok' : 'fail', 'BILLING_PROVIDER is alipay.');
  add(env.EMAIL_PROVIDER === 'resend' ? 'ok' : 'fail', 'EMAIL_PROVIDER is resend.');

  add(strongSecret(env.JWT_SECRET) ? 'ok' : 'fail', 'JWT_SECRET is a strong non-default secret.');
  add(strongSecret(env.REFRESH_SECRET) ? 'ok' : 'fail', 'REFRESH_SECRET is a strong non-default secret.');
  add(
    env.JWT_SECRET && env.REFRESH_SECRET && env.JWT_SECRET !== env.REFRESH_SECRET ? 'ok' : 'fail',
    'JWT_SECRET and REFRESH_SECRET differ.',
  );

  add(env.MINIO_ACCESS_KEY !== 'minio' ? 'ok' : 'fail', 'MINIO_ACCESS_KEY is not the development default.');
  add(env.MINIO_SECRET_KEY !== 'minio123456' ? 'ok' : 'fail', 'MINIO_SECRET_KEY is not the development default.');
  add(env.CORS_ORIGIN?.startsWith('https://') ? 'ok' : 'fail', 'CORS_ORIGIN uses https.');
  add(
    env.VITE_API_BASE_URL === '/api/v1' || env.VITE_API_BASE_URL?.startsWith('https://') ? 'ok' : 'fail',
    'VITE_API_BASE_URL is same-host `/api/v1` or an https URL.',
  );
  add(env.MINIO_PUBLIC_URL?.startsWith('https://') ? 'ok' : 'fail', 'MINIO_PUBLIC_URL uses https.');
  add(
    env.ALIPAY_NOTIFY_URL?.includes('/api/v1/billing/alipay/notify') ? 'ok' : 'fail',
    'ALIPAY_NOTIFY_URL targets the live Alipay notify route.',
  );
}

function parseEnvFile(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    env[key] = stripQuotes(rawValue.trim());
  }
  return env;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function strongSecret(value) {
  if (!value || value.length < 24 || isPlaceholder(value)) return false;
  return !new Set([
    'change-me-jwt',
    'change-me-refresh',
    'change-me',
    'secret',
    'changeme',
    'your-jwt-secret-change-in-production',
    'your-refresh-secret-change-in-production',
  ]).has(value);
}

function isPlaceholder(value) {
  return value.includes('REPLACE_ME') || value.includes('example.com') || value.includes('your-openai');
}

function add(level, message, detail) {
  results.push({ level, message, detail });
}

function printResults() {
  for (const result of results) {
    const label = `[${result.level}]`.padEnd(7, ' ');
    console.log(`${label} ${result.message}`);
    if (result.detail) {
      console.log(`        ${result.detail}`);
    }
  }

  const summary = results.reduce(
    (acc, result) => {
      acc[result.level] += 1;
      return acc;
    },
    { ok: 0, warn: 0, fail: 0 },
  );
  console.log(`Summary: ${summary.ok} ok, ${summary.warn} warn, ${summary.fail} fail`);
}

function relative(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
}
