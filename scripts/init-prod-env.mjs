import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const help = args.includes('--help') || args.includes('-h');

const templateFile = join(repoRoot, '.env.prod.example');
const targetFile = join(repoRoot, '.env.prod');

if (help) {
  console.log(`Usage: node ./scripts/init-prod-env.mjs [--force] [--dry-run]

Creates .env.prod from .env.prod.example and fills local secrets with random values.
Provider credentials, public domains, and notification URLs remain as placeholders.

Options:
  --force    Overwrite an existing .env.prod.
  --dry-run  Validate generation without writing .env.prod.`);
  process.exit(0);
}

if (existsSync(targetFile) && !force && !dryRun) {
  console.error('[init-prod-env] .env.prod already exists. Use --force to overwrite it.');
  process.exit(1);
}

const replacements = {
  FLUENTOPS_IMAGE_TAG: `local-${timestamp()}`,
  POSTGRES_PASSWORD: secret(32),
  JWT_SECRET: secret(48),
  REFRESH_SECRET: secret(48),
  REDIS_PASSWORD: secret(32),
  MINIO_ACCESS_KEY: `fluentops_${token(12)}`,
  MINIO_SECRET_KEY: secret(32),
};

const template = readFileSync(templateFile, 'utf8');
const output = applyReplacements(template, replacements);

if (!dryRun) {
  writeFileSync(targetFile, output);
}

console.log(
  `[init-prod-env] ${dryRun ? 'Dry run generated' : 'Created'} .env.prod with random values for: ${Object.keys(replacements).join(', ')}.`,
);
console.log(
  '[init-prod-env] Fill the remaining REPLACE_ME/example.com provider and domain values, then run `pnpm verify:prod`.',
);

function applyReplacements(content, values) {
  let next = content;
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (!pattern.test(next)) {
      throw new Error(`[init-prod-env] Template is missing ${key}`);
    }
    next = next.replace(pattern, `${key}=${value}`);
  }
  return next;
}

function secret(bytes) {
  return randomBytes(bytes).toString('base64url');
}

function token(bytes) {
  return randomBytes(bytes).toString('hex');
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join('');
}
