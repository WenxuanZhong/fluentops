import { existsSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const repoRoot = join(__dirname, '..');
const targetDir = join(repoRoot, '.pnpm-bin');
const unixBin = join(targetDir, 'pnpm');
const windowsBin = join(targetDir, 'pnpm.cmd');
const powershellBin = join(targetDir, 'pnpm.ps1');

const unixContent = `#!/bin/sh
exec corepack pnpm "$@"
`;
const windowsContent = `@echo off\r\ncorepack pnpm %*\r\n`;
const powershellContent = `#!/usr/bin/env pwsh
corepack pnpm $args
`;

mkdirSync(targetDir, { recursive: true });

let wroteAnything = false;

if (!existsSync(unixBin)) {
  writeFileSync(unixBin, unixContent);
  chmodSync(unixBin, 0o755);
  wroteAnything = true;
}

if (!existsSync(windowsBin)) {
  writeFileSync(windowsBin, windowsContent);
  wroteAnything = true;
}

if (!existsSync(powershellBin)) {
  writeFileSync(powershellBin, powershellContent);
  chmodSync(powershellBin, 0o755);
  wroteAnything = true;
}

if (wroteAnything) {
  console.log(`[ensure-pnpm] pnpm wrappers installed to ${targetDir}`);
}
