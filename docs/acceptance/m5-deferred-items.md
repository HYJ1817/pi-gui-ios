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

## D2. Contract copy drift (P2 repair)

The earlier “aligned exports” conclusion was not a mechanical parity check.
P2 found and restored two missing mobile guards from desktop
`60d243a24b3ced198bd2e9ccaeb1e66f6129ba7e`: canonical device `serviceId`
binding and rejection of ordinary events using reserved ID `stream-reset`.
Negative/positive controls cover both; historical reports remain unchanged.

Offline `tests/remote-contract.test.mjs` now checks the immutable desktop pin
in `tests/fixtures/remote-protocol-pin.json`. The shared
`scripts/lib/protocol-copy.mjs` uses installed TypeScript's parser/printer,
removes comments/source-position formatting, and maps only the two known
`CONTRACT_URL` literals. Other strings, operators and regexes remain checked;
JSON remains byte-exact. This is copy-drift detection, not semantic-equivalence
proof. Integration additionally checks the actual desktop branch/HEAD/clean
worktree and both source/JSON copies before running its suites.

To update: review the cross-repository contract change and ADR, obtain both
raw files with `git show` from the trusted desktop commit, and reproduce the
fixture's raw/normalized hashes with the shared helper. Review its commit,
normalizer and TypeScript version; never regenerate a failing pin from the
mobile copy. Run the contract test, `npm test`, and
`node scripts/desktop-remote-verify.mjs` with `PI_GUI_DESKTOP_WORKTREE` pointing
to the verified checkout. No desktop changes, dependency upgrade or production
hookup belongs to this repair.

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

## D5. SSE write backpressure misread (NIT-1, security round-3)

**Facts.** `_writeBytes` in the desktop event-stream treats `res.write() === false`
as a write failure and closes the stream. In Node, `false` is only a
backpressure hint — the bytes are still queued and delivered. Under modest
backpressure streams close spuriously. Availability-only, pre-existing
semantics the round-2 refactor consolidated; the revocation notice is
unaffected (already queued at write time). Empirically reproduced by the
round-3 security review (1MB write returns false yet all bytes deliver).

**Why deferred.** The one-line fix (drop the `=== false` failure branch and
rely on the `writableLength` ceiling check already present) would invalidate
the round-3 review binding, which must certify the exact final tree. Batching
the fix with any future hardening round costs less than a full review cycle
for a nit. Impact in practice is rare: frames are capped at 64 KiB and kernel
buffers rarely fill at SSE rates.

**Recovery condition.** Apply the one-line fix in the next desktop hardening
pass together with a regression test that fills the socket buffer and asserts
the stream survives.
