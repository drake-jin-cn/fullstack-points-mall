---
id: TASK-INFRA-0006
title: "OpenAPI contract validation — implement check:spec-api in root package.json"
status: draft
priority: low
services:
  - root
assignee: ""
created: 2026-06-25
updated: 2026-06-25
depends_on: []
wiki_refs: []
code_files: []
test_refs: []
---

## Raw Requirements

`[root]` The `check:spec-api` script in root `package.json` is currently a no-op placeholder.
Once the inter-service HTTP interfaces are stable, this script should validate that each service's
actual implementation conforms to a shared OpenAPI spec, catching field-level mismatches
(e.g. a field expected by the BFF but not returned by the shop service) before code is committed.

Candidate tooling: Spectral (OpenAPI linting), or per-service OpenAPI generation + diff check.

## Notes

- Do not implement until inter-service API contracts are stable
- Each service should own its own OpenAPI spec file (e.g. `openapi.yaml` in the service root)
- The root `check:spec-api` script should aggregate and validate all specs
- Can also be wired into the pre-commit hook alongside existing formatters
