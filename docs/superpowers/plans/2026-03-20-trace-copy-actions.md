# Trace Copy Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `COPY JSON` and `COPY TEXT` actions to the chat trace panel so full traces can be exported for debugging.

**Architecture:** Keep the trace transport unchanged and add pure serialization helpers on the desktop side. The trace panel will call those helpers and use the browser clipboard API, so the same actions work for both live traces and persisted message traces.

**Tech Stack:** React 19, TypeScript, Vite, browser clipboard API

---

### Task 1: Add Pure Trace Serialization Helpers

**Files:**
- Create: `apps/desktop/src/pages/chat-trace.ts`
- Test: `apps/desktop/src/pages/chat-trace.test.ts`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Write minimal implementation for JSON and text serialization**
- [ ] **Step 4: Run test to verify it passes**

### Task 2: Wire Copy Actions Into TracePanel

**Files:**
- Modify: `apps/desktop/src/pages/Chat.tsx`
- Modify: `apps/desktop/src/lib/api.ts`
- Test: `apps/desktop/src/pages/chat-trace.test.ts`

- [ ] **Step 1: Add `COPY JSON` and `COPY TEXT` buttons to `TracePanel`**
- [ ] **Step 2: Use `navigator.clipboard.writeText(...)` with the new serializers**
- [ ] **Step 3: Keep the actions shared for live and persisted trace panels**
- [ ] **Step 4: Run desktop build to verify type safety**
