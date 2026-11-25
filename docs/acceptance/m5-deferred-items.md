# M5 deferred items — honest deferral records

These are real gaps found during the M5 review rounds that are recorded
here as **deferred**, not resolved. Nothing in this file is pass evidence.
Every item names its recovery condition.

## D1. Production publish pipeline (IMPORTANT-2, functional round-2)

**Facts.** In the desktop production composition root (`server.js`), the
event-stream `publish` function is never wired to any domain event source:
conversation activity (message completion, lifecycle transitions, approval
requests) never reaches `stream.publish` outside tests. Additionally
`domain.mjs` `conversationItems()` hardcodes `messages: []`, so
`runtime.snapshot` cannot return real conversation content and a client
recovering after any reset cannot rebuild message state. The desktop
runtime-registry *does* retain bounded per-owner event buffers
(`runtime-registry.js events(expected, cursor)`), so a bridge is feasible
without new infrastructure.

**Impact.** End-to-end green tests are genuine but exercise injected test
surfaces; production end-to-end coverage of the publish path does not
exist. A mobile client against a production desktop would receive resets
and expiries correctly, but no live conversation frames.

**Why deferred.** Implementing the bridge requires mapping pi runtime
event shapes (response/tool/exec messages) to the closed contract event
vocabulary and verifying against a live pi backend — desktop-domain work
beyond the transport-security milestone, with user-visible behavioral
risk if wrong. The wiring surface is unambiguous (composition root), the
registry buffers already provide the source.

**Recovery condition.** A dedicated milestone with a live pi-backend
integration rig: bridge events → publish per conversation owner, fill
`conversationItems().messages` from the authoritative transcript source,
and add a production-path integration test that drives a real runtime
rather than injected harnesses.

## D2. Contract copy drift risk (hygiene)

**Facts.** `scripts/lib/remote-protocol-contract.mjs` is *not* byte-identical
to the desktop `server/remote/protocol.mjs` — the mobile copy is a
minified-build variant (no JSDoc header, different layout). The functional
exports are aligned (both suites pass against each copy), but no mechanical
gate currently compares the two. A silent divergence in either copy would
split mobile/desktop validation.

**Recovery condition.** Add a normalization-aware copy check (strip
comments/whitespace, compare token streams) to `tests/remote-contract.test.mjs`
or the integration suite, and establish the copy-update procedure in the
desktop contract-change ADR process.

## D3. Self-signed certificate lifetime (INFORMATIONAL-1, security round-2)

**Facts.** Desktop mints the TLS identity for 365 days with no rotation or
renewal path. Expiry causes hard lockout: the pinned fingerprint changes on
any re-mint, so devices must re-pair. This is fail-closed and correct, but a
calendared operational hazard.

**Recovery condition.** Rotation design (overlapping acceptance window or
re-pair UX) — belongs with D1's production-readiness milestone.

## D4. Pairing budget ordering (NIT-4 — accepted as designed)

**Facts.** The per-peer IP budget is charged before the per-session attempt
budget, so a single-IP attacker with many sessions spends the IP budget
without spending session budgets. Total guessing stays within the designed
envelope (per-peer × per-window and global caps bind regardless), and the
security review confirmed guessing resistance held.

**Decision.** Accepted as designed: the session budget still bounds
per-session guessing, the peer/global budgets bound aggregate guessing, and
reordering would only re-partition the same total budget. Recorded so a
future reviewer does not re-file it.

## Related deferrals

Device-network evidence remains deferred per `device-network-deferral.md`
(ADR 0006): the one-time user-operated device checklist performs SideStore
install + network acceptance. Simulator success is never device evidence.
