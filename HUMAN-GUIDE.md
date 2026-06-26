# Human Collaboration Guide

> **Who this is for:** The human(s) working with AI on this project.
> **Companion doc:** `WORKFLOW.md` is the AI's operating manual — you don't need to read it in detail.

---

## The Core Mental Model

Think of the AI as a **senior developer who works fast but needs your sign-off at key moments**.
Your job is not to review every line of code — it's to make sure the AI is solving the right
problem before it spends hours solving the wrong one.

**You own:** What gets built and whether it's correct.
**AI owns:** How it gets built and code quality.

---

## Your 3 Intervention Points

The workflow has exactly **3 moments where AI stops and waits for you**:

### ⚠️ Gate 1 — Spec + AC Review (Step 3)
**This is the most important one.** Before any code is written, AI presents:
- A **Spec** (technical design: what it's building and why)
- **Acceptance Criteria** (a checklist of what "done" means)

**Your job here:**
- Does the design solve my actual problem? (Not "is the code good?")
- Are there missing scenarios? (What happens when X fails? What about Y edge case?)
- Is the scope right? (Not too much, not too little)

**How long it should take:** 5–15 minutes. If it takes longer, the Spec is too vague — send it back.

**You can:** Edit individual AC items, add missing cases, reject the whole Spec and ask for a rewrite.
**You must not:** Say "looks good" if you haven't actually read it. This gate exists because fixing
a wrong design after implementation costs 10× more time.

---

### ⚠️ Gate 2 — PR Review (your responsibility, AI reminds you)
After `test-pass`, AI will remind you to open a PR. You review the diff before merging.

**What to focus on:** Business logic and data safety. Is the AI doing what the Spec said?
**What to skip:** Formatting, naming, code style — CI and AI handle that.

---

### ⚠️ Gate 3 — Close After Deployment (Step 11)
After you've deployed and confirmed it works in the target environment, manually update the task
status to `closed`. AI cannot do this — it has no visibility into your deployment outcome.

---

## Where AI Tends to Go Wrong

These are the most common failure modes, in order of frequency:

| Failure Mode | What It Looks Like | What to Do |
|---|---|---|
| **Over-scoping** | Builds 3 features when you asked for 1 | Catch at Gate 1 — check "Out of Scope" section of Spec |
| **Thin AC** | Acceptance Criteria only covers the happy path | Add error cases: "what if X is missing?", "what if Y is invalid?" |
| **Silent assumptions** | AI assumes something ambiguous instead of asking | If the Spec contains a decision you didn't discuss, ask "why?" |
| **Forgetting wiki archive** | Moves to next task without archiving Spec | Check `wiki_refs` field in the task file — should not be empty at `test-pass` |
| **Wrong starting point** | Starts implementing before you've confirmed AC | Spec must reach `spec-ready` before any code. If AI starts coding early, stop it. |

---

## How to Give Good Feedback

**When the Spec is wrong:**
> "The approach to X doesn't match what I had in mind. I want [describe intended behavior]. Please revise."

Don't say: "This doesn't look right." AI needs to know *what* is wrong.

**When you want to change scope mid-task:**
Tell AI immediately — the earlier the better. If code has already been written, AI must revert
first before changing the Spec (this is the Mid-Task Amendment process in WORKFLOW.md).
Do not ask AI to "just tweak" code that doesn't match its Spec — that creates drift.

**When something goes wrong:**
Describe what you expected vs what happened. AI will use the systematic-debugging process.
Don't say: "It's broken." Say: "I expected X, but got Y when I did Z."

---

## The Rhythm of a Task

```
You give requirements
    ↓
AI drafts Spec + AC  (few minutes)
    ↓
⚠️  You review  →  approve or revise
    ↓
AI codes + tests  (runs autonomously, no input needed)
    ↓
AI archives to wiki, reports done
    ↓
⚠️  You open PR, review diff, merge
    ↓
⚠️  You deploy, confirm, close task
```

Most of your active time is at the review gates. The implementation phase runs without you.

---

## Signs You Should Interrupt Mid-Task

Don't wait until AI finishes if you notice:

- **Direction is wrong** — AI described a different approach than you intended and is building it
- **Scope is exploding** — AI mentions it's "also adding X and Y while we're here"
- **A blocker you know about** — AI is building toward a constraint it doesn't know exists
- **A better idea occurred to you** — stop AI now; implementing first and pivoting later is wasteful

To interrupt: just send a message. AI will stop, assess the situation, and revert if needed.

---

## Task Status at a Glance

| Status | Meaning | Who acts next |
|--------|---------|---------------|
| `draft` | Task file created | AI (generates Spec) |
| `spec-pending` | Spec written, awaiting review | **You** ⚠️ |
| `spec-ready` | You approved | AI (implements) |
| `in-dev` | AI is coding | AI |
| `dev-done` | Implementation complete | AI (runs tests) |
| `test-pass` | All tests green | **You** ⚠️ (open PR) |
| `closed` | Deployed and confirmed | **You** ⚠️ |

If a task sits at `spec-pending` for a long time, that's a signal you haven't reviewed it yet.

---

## What You Don't Need to Worry About

- Code formatting and style (enforced by Prettier + lint-staged)
- Test coverage (AI writes tests against every AC item)
- Commit message format (enforced by Git hook)
- Task index (`_index.md`) — rebuilt automatically
- Wiki version numbers — AI manages these

If CI is red, AI will fix it. You don't need to debug test failures unless AI explicitly asks.
