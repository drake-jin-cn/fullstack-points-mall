#!/usr/bin/env node
/**
 * run-task-tests.js
 *
 * Run tests by task ID or status, with optional automatic status update.
 *
 * Usage:
 *   node .tests/scripts/run-task-tests.js TASK-F001
 *   node .tests/scripts/run-task-tests.js TASK-F001 TASK-B001
 *   node .tests/scripts/run-task-tests.js --status=dev-done
 *   node .tests/scripts/run-task-tests.js --status=dev-done --update-status
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const TASKS_DIR = path.join(ROOT, '.tasks');

// ─── Parse CLI arguments ────────────────────────────────────────────────────

const args = process.argv.slice(2);
const statusFlag = args.find(a => a.startsWith('--status='));
const updateStatus = args.includes('--update-status');
const targetStatus = statusFlag ? statusFlag.split('=')[1] : null;
const targetIds = args.filter(a => !a.startsWith('--'));

// ─── Read task files ────────────────────────────────────────────────────────

function parseTaskFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\n([\s\S]+?)\n---/);
  if (!match) return null;

  // Minimal YAML parser — supports only this project's frontmatter format
  const yaml = match[1];
  const task = { _filePath: filePath, _content: content };

  yaml.split('\n').forEach(line => {
    const kv = line.match(/^(\w+):\s*(.+)/);
    if (kv) task[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  });

  // Parse array fields
  ['wiki_refs', 'code_files', 'test_refs', 'depends_on'].forEach(key => {
    const listMatch = yaml.match(new RegExp(`${key}:\\s*\\n((?:\\s+-[^\\n]+\\n?)+)`));
    if (listMatch) {
      task[key] = listMatch[1]
        .split('\n')
        .filter(l => l.trim().startsWith('-'))
        .map(l => l.replace(/^\s*-\s*/, '').trim());
    } else {
      task[key] = task[key] === '[]' ? [] : task[key] ? [task[key]] : [];
    }
  });

  return task;
}

function getAllTasks() {
  return fs.readdirSync(TASKS_DIR)
    .filter(f => f.startsWith('TASK-') && f.endsWith('.md'))
    .map(f => parseTaskFile(path.join(TASKS_DIR, f)))
    .filter(Boolean);
}

// ─── Select target tasks ────────────────────────────────────────────────────

let tasks = getAllTasks();

if (targetStatus) {
  tasks = tasks.filter(t => t.status === targetStatus);
  if (tasks.length === 0) {
    console.log(`\n✅  No tasks with status "${targetStatus}".\n`);
    process.exit(0);
  }
} else if (targetIds.length > 0) {
  tasks = tasks.filter(t => targetIds.includes(t.id));
  const found = tasks.map(t => t.id);
  const missing = targetIds.filter(id => !found.includes(id));
  if (missing.length > 0) {
    console.warn(`\n⚠️  Task(s) not found: ${missing.join(', ')}\n`);
  }
} else {
  console.error('\n❌  Specify a task ID or --status=<status>\n');
  process.exit(1);
}

// ─── Group by test type and run ─────────────────────────────────────────────

function classifyTestRef(ref) {
  if (ref.includes('.spec.ts') && ref.includes('e2e')) return 'playwright';
  if (ref.endsWith('.bru')) return 'bruno';
  if (ref.endsWith('.test.ts') || ref.endsWith('.test.js')) return 'vitest';
  return 'unknown';
}

function runVitest(testFiles) {
  console.log('\n🧪  Running Vitest unit tests...');
  const result = spawnSync(
    'npx', ['vitest', 'run', ...testFiles],
    { stdio: 'inherit', cwd: ROOT }
  );
  return result.status === 0;
}

function runBruno(bruFiles) {
  console.log('\n🌐  Running Bruno API tests...');
  // Bruno CLI must run from the collection root (where bruno.json lives).
  // Collection root is .tests/api/; file paths in test_refs are relative to
  // the repo root, so we strip the ".tests/api/" prefix to get the collection-
  // relative path.
  const COLLECTION_ROOT = path.join(ROOT, '.tests', 'api');
  const bruBin = path.join(ROOT, 'node_modules', '.bin', 'bru');

  let allPass = true;
  for (const ref of bruFiles) {
    const absPath = path.isAbsolute(ref) ? ref : path.join(ROOT, ref);
    const relToCollection = path.relative(COLLECTION_ROOT, absPath);
    const result = spawnSync(
      bruBin, ['run', relToCollection, '--env', 'local'],
      { stdio: 'inherit', cwd: COLLECTION_ROOT }
    );
    if (result.status !== 0) allPass = false;
  }
  return allPass;
}

function runPlaywright(specFiles) {
  console.log('\n🎭  Running Playwright E2E tests...');
  const result = spawnSync(
    'npx', ['playwright', 'test', ...specFiles.map(f => path.join(ROOT, f))],
    { stdio: 'inherit', cwd: ROOT }
  );
  return result.status === 0;
}

// ─── Update task status ─────────────────────────────────────────────────────

function updateTaskStatus(task, newStatus, failSummary = '') {
  const now = new Date().toISOString().split('T')[0];
  let content = task._content;

  // 更新 frontmatter 中的 status 和 updated
  content = content.replace(/^status: \S+/m, `status: ${newStatus}`);
  content = content.replace(/^updated: \S+/m, `updated: ${now}`);

  // 追加状态变更历史
  const historyRow = `| ${now} | ${task.status} | ${newStatus} | script | test:task run${failSummary ? ' - ' + failSummary : ''} |`;
  content = content.replace(
    /(\| Time \| Previous Status \| New Status \| Actor \| Notes \|\n\|[-|]+\|\n)/,
    `$1${historyRow}\n`
  );

  fs.writeFileSync(task._filePath, content, 'utf8');
  console.log(`\n📝  Task ${task.id} status updated: ${task.status} → ${newStatus}`);
}

function refreshIndex() {
  // 重新读取所有任务，更新 _index.md
  const allTasks = getAllTasks();
  const byStatus = {};
  const statuses = ['draft', 'spec-ready', 'in-dev', 'dev-done', 'test-fail', 'test-pass', 'closed'];
  statuses.forEach(s => byStatus[s] = allTasks.filter(t => t.status === s));

  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const total = allTasks.length;

  const statsRows = statuses.map(s => `| ${s} | ${(byStatus[s] || []).length} |`).join('\n');

  const renderTable = (tasks) => {
    if (!tasks.length) return '| (none) | | | |\n';
    return tasks.map(t => `| ${t.id} | ${t.title} | ${t.service} | ${t.updated} |`).join('\n') + '\n';
  };

  const content = `# Task Overview Index

> ⚠️ This file is maintained automatically by the \`test:task\` script and AI. **Do not edit directly.**
> Last updated: ${now} | Total: ${total} tasks

---

## Status Summary

| Status | Count |
|--------|-------|
${statsRows}
| **Total** | **${total}** |

---

## 🟡 dev-done (implemented, awaiting tests)

| ID | Title | Services | Updated |
|----|-------|----------|---------|
${renderTable(byStatus['dev-done'])}
---

## 🔴 test-fail (tests failed, fix required)

| ID | Title | Services | Updated |
|----|-------|----------|---------|
${renderTable(byStatus['test-fail'])}
---

## 🔵 in-dev (in development)

| ID | Title | Services | Updated |
|----|-------|----------|---------|
${renderTable(byStatus['in-dev'])}
---

## 🟠 spec-ready (pending development)

| ID | Title | Services | Updated |
|----|-------|----------|---------|
${renderTable(byStatus['spec-ready'])}
---

## ⚪ draft (draft)

| ID | Title | Services | Updated |
|----|-------|----------|---------|
${renderTable(byStatus['draft'])}
---

## 🟢 test-pass (tests passed)

| ID | Title | Services | Updated |
|----|-------|----------|---------|
${renderTable(byStatus['test-pass'])}
---

## ✅ closed (closed)

| ID | Title | Services | Updated |
|----|-------|----------|---------|
${renderTable(byStatus['closed'])}`;  

  fs.writeFileSync(path.join(TASKS_DIR, '_index.md'), content, 'utf8');
  console.log('\n📋  _index.md refreshed');
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log(`\n🚀  Running tests for ${tasks.length} task(s): ${tasks.map(t => t.id).join(', ')}`);
console.log('='.repeat(60));

const results = {};

for (const task of tasks) {
  console.log(`\n▶  ${task.id}：${task.title}`);

  const testRefs = task.test_refs || [];
  if (testRefs.length === 0) {
    console.log('   ⚠️  No test_refs for this task — skipping');
    results[task.id] = { pass: null, reason: 'no test_refs' };
    continue;
  }

  const vitestFiles = testRefs.filter(r => classifyTestRef(r) === 'vitest');
  const brunoFiles = testRefs.filter(r => classifyTestRef(r) === 'bruno');
  const playwrightFiles = testRefs.filter(r => classifyTestRef(r) === 'playwright');

  let passed = true;
  let failSummary = '';

  if (vitestFiles.length > 0 && !runVitest(vitestFiles)) {
    passed = false;
    failSummary += 'Vitest failed ';
  }
  if (brunoFiles.length > 0 && !runBruno(brunoFiles)) {
    passed = false;
    failSummary += 'Bruno failed ';
  }
  if (playwrightFiles.length > 0 && !runPlaywright(playwrightFiles)) {
    passed = false;
    failSummary += 'Playwright failed ';
  }

  results[task.id] = { pass: passed, failSummary: failSummary.trim() };

  if (updateStatus) {
    const newStatus = passed ? 'test-pass' : 'test-fail';
    updateTaskStatus(task, newStatus, failSummary.trim());
  }
}

// ─── Summary output ──────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log('📊  Test Results Summary\n');

let passCount = 0, failCount = 0, skipCount = 0;

for (const [id, result] of Object.entries(results)) {
  if (result.pass === null) {
    console.log(`  ⚠️  ${id}  skipped (${result.reason})`);
    skipCount++;
  } else if (result.pass) {
    console.log(`  ✅  ${id}  passed`);
    passCount++;
  } else {
    console.log(`  ❌  ${id}  failed - ${result.failSummary}`);
    failCount++;
  }
}

console.log(`\n  passed: ${passCount}  failed: ${failCount}  skipped: ${skipCount}`);

if (updateStatus) {
  refreshIndex();
}

process.exit(failCount > 0 ? 1 : 0);
