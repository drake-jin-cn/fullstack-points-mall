## Linked Task

> ⚠️ Required — PRs without a TASK ID should not be approved

- TASK ID: <!-- e.g. TASK-AUTH-0001, separate multiple IDs with commas -->
- Task status (should be in-dev before opening PR): <!-- dev-done -->

---

## Change Type

<!-- Check all that apply -->

- [ ] `feat` New feature
- [ ] `fix` Bug fix
- [ ] `refactor` Refactor (no functional change)
- [ ] `test` Test-related
- [ ] `docs` Documentation / Wiki change

---

## Change Description

<!-- Briefly describe what was done and why -->

---

## Spec Consistency Checklist

<!-- Developer self-check — must complete before opening PR -->

- [ ] I have read all Wiki files listed in the linked TASK's `wiki_refs`
- [ ] Implementation matches every acceptance criterion item by item
- [ ] **This PR does not implement any interface or feature not defined in the Spec**
- [ ] If there are Spec/Wiki changes, a separate Spec PR has been opened (not mixed with business code)

---

## Test Coverage

- [ ] Relevant unit tests updated (Vitest)
- [ ] Bruno API tests verified locally
- [ ] E2E tests updated (if a core business flow is involved)
- [ ] `pnpm run test:task TASK-XXX` passes locally

---

## Reviewer Notes

> Reject approve if:
> - No TASK ID in the PR
> - Implements interfaces not defined in Spec (violates Spec First principle)
> - `.wiki/` changes mixed with business code in the same PR
> - Not all acceptance criteria checkboxes are checked
