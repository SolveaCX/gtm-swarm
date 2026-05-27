# ContentOS Run Step Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ContentOS step execution return quickly, reject duplicate runs, and let the wizard poll existing state until the background job finishes.

**Architecture:** Add a small in-process job registry in `server/contentos-jobs.js` that starts `runContentOSStep` in the background and tracks one active job per `slug:step`. The API route returns `202` when a run starts or is already running, while the wizard polls `/state` and renders `running`, `done`, or `failed`.

**Tech Stack:** Next.js route handlers, Node.js `node:test`, existing filesystem/DB ContentOS state.

---

### Task 1: Background Job Registry

**Files:**
- Create: `server/contentos-jobs.js`
- Test: `server/contentos-jobs.test.js`
- Modify: `server/contentos.js`

- [ ] Write tests for starting a job once, preventing duplicate runner calls, clearing after completion, and persisting failed status.
- [ ] Run `node --test server/contentos-jobs.test.js` and confirm it fails because the module does not exist.
- [ ] Implement `startContentOSStepJob`, `getContentOSStepJob`, and failure-state helpers.
- [ ] Run `node --test server/contentos-jobs.test.js` and confirm it passes.

### Task 2: API Route

**Files:**
- Modify: `app/api/contentos/[slug]/run-step/route.ts`

- [ ] Change POST to call `startContentOSStepJob(slug, step)` instead of awaiting `runContentOSStep`.
- [ ] Return `202` with `{ ok: true, status: "running" }` for started and already-running jobs.
- [ ] Keep validation and LLM credential checks unchanged.

### Task 3: Wizard Polling

**Files:**
- Modify: `app/wizard/[slug]/page.tsx`

- [ ] Add `failed` to `StepInfo.status`.
- [ ] After run POST returns, poll `/state` every 2 seconds.
- [ ] Stop polling when the selected step reaches `done` or `failed`.
- [ ] Keep run buttons disabled while any job is running.

### Task 4: Verification

- [ ] Run `node --test server/contentos-jobs.test.js server/contentos.test.js`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Confirm no unrelated dirty files were modified.
