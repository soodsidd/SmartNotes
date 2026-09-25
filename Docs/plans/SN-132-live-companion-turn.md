# SN-132 — Live companion turn survives page switch / PWA teardown

**Status:** implementation plan (adapted from Ascent Vector Comms/work-item chat)
**Risk:** high · **Scope:** companion (AI sidebar) live-turn lifecycle

---

## Problem

A running companion turn is currently owned by the mounted page UI. When the
user switches pages, backgrounds the app, or closes/reopens the mobile PWA, the
client **cancels** the turn (`/api/chat/cancel`) and/or drops the local
`activeTurnIdRef`, so streaming state is lost and, on return, no reattach
happens. This violates the principle that a running response is a *server-owned
live assistant turn with durable run metadata*, not a UI lifecycle.

## AV source materials consulted (required by brief)

Adapted rather than reinvented — see these Ascent Vector references:

- `docs/unified-work-item-chat-architecture.md` — the **Run / RunEvent** model:
  run state is authoritative for process/recovery and points back to a chat
  turn; **run events must be replayable by sequence number after reconnect**
  (§ RunEvent rules); ACs "Browser reload during a run reattaches to the same
  turn" and "Sidecar restart recovers terminal state from durable run rows".
- `docs/unified-work-item-chat-implementation.md`, `docs/chat-requirements.md`,
  `docs/chat-send-reliability-plan.md` — canonical session + first-class turn +
  server-authoritative live-run lookup + reconnectable stream.
- `src/features/chat/useChatStore.ts`, `chatReattachPlan.ts`,
  `providers/sidecar.ts` (+ tests) — client reattach/resume-on-reconnect shape.
- `server/chatSessionLiveRun.mjs`, `server/storage.mjs`
  (`createRunStore`/`findByChatTurn`/`run_events`),
  `server/__tests__/orphanedChatTurnRecovery.test.mjs`,
  `chatTurnReconciliation.test.mjs` — durable run row linked to the chat turn,
  live-run lookup, and startup reconciliation.

## Key finding: the server is already AV-shaped

The Smart Notes chat runtime (`packages/cli-chat/index.js`, wired in
`server.js` via `createChatModule`) **already implements the durable live-run
half of the AV pattern**:

- **Durable run row + run events:** each turn is a persisted job record
  (`createJobRecord`/`savePersistedJobRecord`) whose events are **sequenced and
  persisted** (`emitTurnEvent` → `persistJobEvent`, `seq = job.nextSeq++`). The
  provider runs as a **server-owned spawned process** (`job.proc`) independent
  of any client.
- **Server-authoritative live-run lookup:** `GET /api/chat/history` returns
  `active_turns: listActiveTurnSummaries(scopeKey)` (running turns with
  `turn_id` + `last_seq`); `GET /api/chat/sessions/:id` returns the durable
  transcript for reconciliation (`loadSessionDetail`).
- **Reconnectable stream (replay by seq):** socket `chat_resume {turn_id,
  last_seq}` → `replayTurnEvents` re-emits missed `chat_event`s and a
  `chat_resume_ack {status, replayed, last_seq}`.
- **Startup reconciliation:** `recoverInterruptedJobs` marks `running` records
  as `interrupted` on boot and emits terminal `status`+`done` events — the
  "server restarted mid-turn" case.

So the fix is **almost entirely client-side**: stop treating the mounted page as
the turn owner, and use the resume/reconcile machinery that already exists.

## The client bug (notebook-shell-reliable.tsx)

1. Effect on `draft?.path` (page switch) calls `cancelActiveTurn()` →
   `POST /api/chat/cancel`, killing the live provider process.
2. Effect on companion close (`aiOpen` false, Keep off) also calls
   `cancelActiveTurn()`.
3. The socket effect only listens to live `chat_event` filtered by the in-memory
   `activeTurnIdRef`; it **never emits `chat_resume`**, so a reconnect or a
   return-to-page does not replay missed events.
4. No durable pointer ties "the live turn" to a page+scope, so after a full PWA
   teardown the returning client cannot find the turn to reattach.

## Design

Introduce a **durable active-turn pointer** stored in the canonical per-page
companion sidecar (`<page-stem>.companion.json`), which already is the canonical
page/scope chat session (SN-80). The pointer is the client-side analogue of
`runs.chat_turn_id` + `last_seq`:

```
CompanionActiveTurn {
  turnId: string;             // server turn_id / chat_id (the run id)
  assistantMessageId: string; // transcript anchor for streaming
  lastSeq: number;            // highest applied chat_event seq (resume cursor)
  startedAt: number;
}
```

Stored on `CompanionScopeSession.activeTurn` (and mirrored on the volatile
sessionStorage session). It is written **as soon as a turn is created**,
independent of the Keep toggle, and **cleared on any terminal event**
(done/error/cancelled/interrupted). Because it lives in the vault sidecar it
survives PWA process teardown.

### Lifecycle changes

- **Send:** after `/send` returns `turn_id`, persist the active-turn pointer for
  the current page+scope; set `lastSeq = -1`.
- **Stream:** in the `chat_event` handler, advance `lastSeq = event.seq` and
  (debounced) persist it. On terminal event, clear the pointer and fold the
  final assistant message into the durable transcript.
- **Detach (navigation / component unmount / companion close):** replace the
  `cancelActiveTurn()` calls with `detachActiveTurn()` — persist the pointer and
  clear local observer refs only. **No `/api/chat/cancel`.** (`reset-session`
  only clears provider-session continuity and does not kill the process, but we
  also skip it while a turn is live to avoid disturbing `--resume`.)
- **Explicit cancel (Stop button):** unchanged — still `POST /api/chat/cancel`
  and records the terminal cancelled state; clears the pointer.
- **Reattach (socket connect + entering a page/scope with a pointer):**
  1. Look up server truth: `GET /api/chat/history` `active_turns`.
  2. If the pointer's `turnId` is still running → restore the assistant
     placeholder, set `aiTurnActive`, and emit `chat_resume {turn_id, last_seq}`
     to replay missed events into the transcript.
  3. If the pointer exists but the turn is no longer active → reconcile from
     `GET /api/chat/sessions/:turnId`, fold the final/terminal message into the
     transcript, clear the pointer (covers "completed while app was closed" and
     "server restarted → interrupted").
- **SN-80 guard:** the Keep-off navigation/close cleanup (`clearCompanionScope
  OnPage` / `deleteCompanionSessions`) must **not** delete a sidecar that holds
  a live `activeTurn` pointer; cleanup is deferred until the turn reaches a
  terminal state.

### Files

- `src/lib/ai-sidebar.ts` — types + normalize + `setCompanionActiveTurn` helper.
- `src/components/notebook-shell-reliable.tsx` — lifecycle wiring above.
- Tests: `tests/ai-sidebar-active-turn.test.ts` (pure helpers + reducer),
  server resume/reconcile coverage if feasible.
- `Docs/sysdoc/smart-notes.md` — document the durable live-turn + reattach
  contract in the companion persistence section.

## Acceptance-criteria mapping

| AC | Mechanism |
|----|-----------|
| Navigate A→B, turn not interrupted | detach-only on page switch; no cancel |
| Background / close PWA, turn continues | server-owned `job.proc`; pointer in vault sidecar |
| Reopen & return to A while running → reattach | `chat_resume` replay from persisted `last_seq` |
| Return after completion while closed → saved to A | reconcile via `/sessions/:id`, fold into scope transcript |
| Follows AV pattern | canonical page/scope session, first-class turn, durable run row, live-run lookup, reconnectable seq events |
| Unmount detaches only; explicit cancel stops | `detachActiveTurn` vs `handleAiCancel` |
| Server restart mid-turn → explicit terminal | `recoverInterruptedJobs` + reconcile shows interrupted |

## Out of scope / owner-side

- Manual verification with a deliberately slow companion response on a real
  mobile/PWA device (no device in CI). Steps documented in the closeout.
