#!/usr/bin/env node
/**
 * install.js — installs .git-hooks/commit-msg into root repo + all submodules.
 *
 * Run once after cloning:
 *   pnpm run hooks:install
 *
 * Also runs automatically via the `prepare` script on `pnpm install`.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOOK_SRC = path.join(__dirname, 'commit-msg');
const GITMODULES = path.join(ROOT, '.gitmodules');

// ─── parse .gitmodules ────────────────────────────────────────────────────────
function parseSubmodulePaths() {
  if (!fs.existsSync(GITMODULES)) return [];
  const content = fs.readFileSync(GITMODULES, 'utf-8');
  const paths = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*path\s*=\s*(.+)/);
    if (m) paths.push(m[1].trim());
  }
  return paths;
}

// ─── install hook into one repo ───────────────────────────────────────────────
function installHook(repoRoot, label) {
  const gitDir = path.join(repoRoot, '.git');
  if (!fs.existsSync(gitDir)) {
    console.log(`  ⚠ skipped ${label} — no .git directory found at ${repoRoot}`);
    return false;
  }

  // Handle .git as a file (worktree or submodule alternate)
  let hooksDir;
  const gitStat = fs.statSync(gitDir);
  if (gitStat.isFile()) {
    // .git file contains "gitdir: <path>"
    const gitFileContent = fs.readFileSync(gitDir, 'utf-8').trim();
    const m = gitFileContent.match(/^gitdir:\s*(.+)/);
    if (!m) {
      console.log(`  ⚠ skipped ${label} — cannot parse .git file`);
      return false;
    }
    const realGitDir = path.resolve(repoRoot, m[1]);
    hooksDir = path.join(realGitDir, 'hooks');
  } else {
    hooksDir = path.join(gitDir, 'hooks');
  }

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const dest = path.join(hooksDir, 'commit-msg');
  fs.copyFileSync(HOOK_SRC, dest);

  // chmod +x (no-op on Windows but harmless)
  try {
    fs.chmodSync(dest, 0o755);
  } catch {
    // ignore on platforms that don't support chmod
  }

  console.log(`  ✓ ${label}`);
  return true;
}

// ─── main ─────────────────────────────────────────────────────────────────────
console.log('\nInstalling commit-msg hook...\n');

if (!fs.existsSync(HOOK_SRC)) {
  console.error(`✗ Hook source not found: ${HOOK_SRC}`);
  process.exit(1);
}

let successCount = 0;
let totalCount = 0;

// root repo
totalCount++;
if (installHook(ROOT, 'root repo')) successCount++;

// submodules
const submodulePaths = parseSubmodulePaths();
for (const subPath of submodulePaths) {
  const subRoot = path.join(ROOT, subPath);
  totalCount++;
  if (installHook(subRoot, subPath)) successCount++;
}

console.log(`\n${successCount}/${totalCount} repo(s) configured.\n`);

if (successCount < totalCount) {
  console.warn('Some repos were skipped — run `git submodule update --init` if submodules are not checked out yet.\n');
}
