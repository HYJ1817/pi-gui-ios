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

## D2. Contract copy drift risk (hygiene; P2 repair)

**Historical finding.** The earlier record described different formatting
and inferred aligned exports from passing suites. That was not a mechanical
parity guarantee. P2 inspection of desktop `HYJ1817/pi-gui` at
`60d243a24b3ced198bd2e9ccaeb1e66f6129ba7e` found two missing mobile guards:
a device binding must carry the canonical `serviceId` derived from the
trusted service fingerprint, and an ordinary event envelope must reject
`conversationId: 'stream-reset'`. Prior reports and their conclusions remain
historical; this repair does not restamp their evidence.

**P2 repair.** The mobile validator now matches those exact desktop guards,
including validation order and the `service_identity_invalid` / `unauthorized`
request failure. Synthetic request fixtures carry the current service ID;
negative tests cover missing/old bindings without consuming a nonce, and
a correctly shaped/signed ordinary frame with the reserved ID. Valid current
bindings, ordinary conversation IDs and reset frames are positive controls.
The cohesive contract file and protocol capabilities remain intact.

**Copy gate.** Canonical offline `npm test` includes
`tests/remote-contract.test.mjs`, which compares the mobile copy's normalized
SHA256 and the contract JSON's byte SHA256 to
`tests/fixtures/remote-protocol-pin.json`. There is no network fetch or
full desktop source fixture. The shared `scripts/lib/protocol-copy.mjs`
uses the installed TypeScript 6.0.3 parser/printer with `removeComments`,
LF output and synthesized source positions (so incidental line breaks do
not affect the digest). Only the two known string literals in
`const CONTRACT_URL = new URL(..., import.meta.url)` map to the desktop
`'./contract-v1.json'` location. Unknown paths/syntax fail closed; operators,
other strings and regexes are retained. This is a normalized-copy guard,
not a claim of general semantic equivalence. Mutation tests accept
comments/formatting but detect operator, string, regex and either missing
guard. Contract JSON comparison deliberately remains byte-exact.

The immutable pin was independently derived from `git show` of the exact
desktop commit above:

- `server/remote/protocol.mjs` byte SHA256:
  `02ab15771127374c2574af5692ea5d5e90f4b7e56ea5ff9c76a412c99f384c58`.
- `typescript-printer-synthesized-v1` normalized SHA256:
  `b9dbb606c7fa3bc731b5c19032d25c0a5d0c606df2c53c4c2577b00319c95f8b`.
- `server/remote/contract-v1.json` byte SHA256 (also the mobile JSON):
  `4c24021fd588e35ce8ffe25f4eb0c49ace0e42cae2e7116f0e5f0df58c154d9a`.

The audit's exploratory normalized digest (`0ac6fa408abbff4e646a51cfe8d3949131f2d743ee4f5e46b712f91a84e07e7b`)
is not reused as this helper's pin: normalization settings are part of the
pin and must be reproducible. `scripts/desktop-remote-verify.mjs` first
checks the registered desktop repo/commit against the fixture, verifies its
worktree branch/HEAD/cleanliness, then runs both actual source copies through
the same helper and compares both JSON files before running desktop suites.
Offline synthetic worktrees exercise the preflight and copy/JSON failures.

**Update procedure.** For an intentional contract change, review both
repositories and the existing contract-change ADR together. Obtain a trusted
full desktop commit; verify its branch, HEAD and clean status, then read
`git show <commit>:server/remote/protocol.mjs` and
`git show <commit>:server/remote/contract-v1.json` as raw bytes. Reconcile the
mobile validator/JSON and regressions as one change. From those desktop
bytes compute `sha256(bytes)` and
`protocolCopySha256(protocolBytes.toString('utf8'))` using the shared helper;
review the fixture's commit, byte hashes, normalized hash, normalizer ID and
TypeScript version explicitly. Never regenerate expectations from the mobile
copy or silently replace the pin on a test failure. A TypeScript upgrade
also requires reviewing/reproducing the normalized pin from that desktop
commit. Align the registered desktop pin through its normal owner, then run
`node --test tests/remote-contract.test.mjs`, canonical `npm test`, and
`node scripts/desktop-remote-verify.mjs` against that verified desktop
worktree (`PI_GUI_DESKTOP_WORKTREE` selects it). This seam's focused tests
are not new full-suite, Native CI, production-hookup or device evidence.

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
