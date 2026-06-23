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
const HOOKS_SRC_DIR = __dirname;
const HOOKS_TO_INSTALL = ['commit-msg', 'pre-commit'];
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

  let installed = 0;
  for (const hookName of HOOKS_TO_INSTALL) {
    const src = path.join(HOOKS_SRC_DIR, hookName);
    if (!fs.existsSync(src)) continue; // skip hooks not yet created
    const dest = path.join(hooksDir, hookName);
    fs.copyFileSync(src, dest);
    try { fs.chmodSync(dest, 0o755); } catch { /* ignore on Windows */ }
    installed++;
  }

  console.log(`  ✓ ${label} (${installed} hook(s))`);
  return true;
}

// ─── main ─────────────────────────────────────────────────────────────────────
console.log('\nInstalling git hooks (commit-msg, pre-commit)...\n');

const missingHooks = HOOKS_TO_INSTALL.filter(h => !fs.existsSync(path.join(HOOKS_SRC_DIR, h)));
if (missingHooks.length === HOOKS_TO_INSTALL.length) {
  console.error(`✗ No hook source files found in ${HOOKS_SRC_DIR}`);
  process.exit(1);
}
if (missingHooks.length > 0) {
  console.warn(`  ⚠ Some hooks not found and will be skipped: ${missingHooks.join(', ')}`);
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
