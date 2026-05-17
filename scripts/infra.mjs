import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');
const composeFile = join(repoRoot, 'infra', 'docker-compose.yml');

const command = process.argv[2] ?? 'help';
const extraArgs = process.argv.slice(3);

const services = [
  {
    name: 'postgres',
    detail: 'TCP 127.0.0.1:5432',
    probe: () => probeTcp('127.0.0.1', 5432),
  },
  {
    name: 'redis',
    detail: 'TCP 127.0.0.1:6379',
    probe: () => probeTcp('127.0.0.1', 6379),
  },
  {
    name: 'minio',
    detail: 'GET http://127.0.0.1:9000/minio/health/live',
    probe: () => probeHttp('http://127.0.0.1:9000/minio/health/live'),
  },
];

switch (command) {
  case 'start':
    await ensureDockerCompose();
    await runDockerCompose(['up', '-d', ...extraArgs]);
    await waitForServices();
    break;
  case 'stop':
    await ensureDockerCompose();
    await runDockerCompose(['down', ...extraArgs]);
    break;
  case 'reset':
    await ensureDockerCompose();
    await runDockerCompose(['down', '-v', '--remove-orphans', ...extraArgs]);
    break;
  case 'logs':
    await ensureDockerCompose();
    await runDockerCompose(['logs', '--tail', '200', ...extraArgs]);
    break;
  case 'status':
    await printDockerComposePs();
    process.exit(await printServiceStatus());
    break;
  case 'wait':
    await waitForServices();
    break;
  case 'help':
  default:
    printHelp();
    if (command !== 'help') {
      process.exit(1);
    }
}

async function ensureDockerCompose() {
  const result = spawnSync('docker', ['compose', 'version'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });

  if (result.status === 0) {
    return;
  }

  console.error(
    '[infra] `docker compose` is not available. Install Docker Desktop or provide Postgres/Redis/MinIO manually before using infra:start/stop/reset/logs.',
  );
  process.exit(1);
}

async function runDockerCompose(args) {
  const fullArgs = ['compose', '-f', composeFile, ...args];
  const exitCode = await spawnCommand('docker', fullArgs);
  if (exitCode !== 0) {
    process.exit(exitCode ?? 1);
  }
}

async function printDockerComposePs() {
  const result = spawnSync('docker', ['compose', '-f', composeFile, 'ps'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    console.log('[infra] `docker compose` is not available here. Falling back to local port/HTTP readiness checks only.');
    return;
  }

  const output = `${result.stdout}${result.stderr}`.trim();
  if (output) {
    console.log(output);
  }
}

async function waitForServices() {
  const timeoutMs = Number(process.env.INFRA_WAIT_TIMEOUT_MS ?? '120000');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const statuses = await collectStatuses();
    const allReady = statuses.every((status) => status.ok);
    renderStatuses(statuses);

    if (allReady) {
      console.log('[infra] All local dependencies are ready.');
      return;
    }

    await sleep(1000);
  }

  console.error('[infra] Timed out while waiting for local dependencies to become ready.');
  process.exit(1);
}

async function printServiceStatus() {
  const statuses = await collectStatuses();
  renderStatuses(statuses);
  return statuses.every((status) => status.ok) ? 0 : 1;
}

async function collectStatuses() {
  return Promise.all(
    services.map(async (service) => ({
      name: service.name,
      detail: service.detail,
      ...(await service.probe()),
    })),
  );
}

function renderStatuses(statuses) {
  console.log('[infra] Local dependency status:');
  for (const status of statuses) {
    const label = status.ok ? 'ready' : 'down ';
    console.log(`  - ${status.name.padEnd(8, ' ')} ${label} ${status.detail}`);
  }
}

function probeTcp(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });

    const finalize = (ok, detail) => {
      socket.destroy();
      resolve({ ok, detail });
    };

    socket.setTimeout(1000);
    socket.on('connect', () => finalize(true, `TCP ${host}:${port}`));
    socket.on('timeout', () => finalize(false, `TCP ${host}:${port} timed out`));
    socket.on('error', (error) => finalize(false, `TCP ${host}:${port} ${error.code ?? error.message}`));
  });
}

async function probeHttp(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    });
    return {
      ok: response.ok,
      detail: response.ok ? `HTTP ${response.status} ${url}` : `HTTP ${response.status} ${url}`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: `HTTP ${url} ${error instanceof Error ? error.message : error}`,
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnCommand(commandName, args) {
  return new Promise((resolve) => {
    const child = spawn(commandName, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 1);
    });

    child.on('error', (error) => {
      console.error(`[infra] Failed to start ${commandName}`, error);
      resolve(1);
    });
  });
}

function printHelp() {
  console.log('Usage: node ./scripts/infra.mjs <start|stop|reset|status|logs|wait>');
  console.log('');
  console.log('  start   docker compose up -d, then wait for Postgres, Redis, and MinIO readiness');
  console.log('  stop    docker compose down');
  console.log('  reset   docker compose down -v --remove-orphans');
  console.log('  status  print docker compose ps when available, then run local readiness probes');
  console.log('  logs    docker compose logs --tail 200');
  console.log('  wait    poll local readiness probes only');
}
