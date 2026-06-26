# Task File Template

Copy this file to `.tasks/<domain>/TASK-<DOMAIN>-<SEQNO>.md` and fill in fields progressively
as the task moves through the workflow. Fields marked with the step number indicate when to fill them.

---

```markdown
---
id: TASK-AUTH-0001                        # Step 1
title: ""                                 # Step 1: one-line summary of what this task does
status: draft                             # updated each step — see status flow in WORKFLOW.md
priority: high                            # Step 1: high | medium | low
assignee: ""                              # optional: GitHub username
created: YYYY-MM-DD                       # Step 1
updated: YYYY-MM-DD                       # Step 1
depends_on: []                            # Step 1: prerequisite task IDs, e.g. [TASK-AUTH-0001]
services: []                              # Step 7: repos touched, e.g. [frontend, bff, core]
code_files: []                            # Step 7: all added/modified file paths
test_refs: []                             # Step 7: all test file paths
wiki_refs: []                             # Step 2: fill if an existing wiki spec is being implemented
                                          # Step 10: fill/confirm after archiving this task's spec to .wiki/
---

## Raw Requirements

(Step 1 — paste the original requirement text here, unmodified)

## Spec

(Step 2 — AI fills this in. Keep after archiving to wiki; it records original rationale.)

### Background

(Why does this need to be done? What is the current problem?)

### Goals

(What specific outcomes does this task achieve? One per line.)

### Out of Scope

(Explicitly list what this task does NOT do, to prevent scope creep.)

### Technical Design

(Key decisions: API contracts, data flow, file structure, libraries chosen. Include code snippets,
SQL, or type definitions where helpful.)

### Affected Files

| File Path | Change |
|-----------|--------|
| (to be filled) | add / modify / delete |

## Acceptance Criteria

(Step 2 — AI drafts; Step 3 — human edits/approves. Cover happy path, error cases, edge cases,
and security constraints. Each item becomes a test target.)

- [ ] AC-01
- [ ] AC-02

## Status Change History

| Time | Previous Status | New Status | Actor | Notes |
|------|-----------------|------------|-------|-------|
| YYYY-MM-DD | — | draft | AI | Task created from raw requirements |
```
