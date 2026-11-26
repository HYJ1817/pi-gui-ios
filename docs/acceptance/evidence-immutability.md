# Evidence immutability accounting (FSEC-006)

## What happened

Before the FSEC remediation round, evidence reports and their output logs
were written to canonical paths (`docs/acceptance/local-<kind>.json`,
`local-<kind>-output.txt`) that each rebuild overwrote in place. The control
authority's evidence entries record `(path, sha256)` pairs; entries from
earlier rebuild generations therefore referenced bytes that no longer exist
at their recorded paths. The final independent security review (2026-11-26,
commit 25a7a869) measured this: 326 of 472 historical references mismatched
their recorded digests.

**No acceptance validation was ever bypassed**: the gate checks the LATEST
evidence entry per kind at validation time, and every completed task's latest
entries were re-imported and verified intact at the time of completion.
What was lost is the historical audit trail — the bytes of superseded
evidence generations.

## Accounting of unrecoverable references

Historical evidence entries predating revision 1815 (control) cannot be
reconstructed: their report/log bytes were overwritten by design-permitted
regeneration cycles. They are hereby explicitly accounted as
**unrecoverable-historical**, neither trusted nor relied upon. Current
acceptance decisions rest exclusively on evidence imported after the
immutability redesign below, all of which is content-addressed.

## The redesign (this commit forward)

1. `scripts/verify.mjs` output logs are content-addressed:
   `docs/acceptance/logs/<sha256>.log` — identical output shares one immutable
   file; differing output can never overwrite a referenced log.
2. `agent-task.mjs evidence` copies the imported report bytes into the
   content-addressed store `.agent/evidence/<sha256>.json` BEFORE recording
   the reference. The authority path always points at bytes identical to what
   was validated at import time; scratch clones and canonical report paths
   may be freely regenerated without breaking any reference.
3. Records carry `originalPath` for provenance (where the bytes came from),
   while `path` is the immutable store location.

## Discipline correction

Completed tasks whose evidence invalidates (source fingerprint drift) must
return to `testing` IMMEDIATELY when the invalidation occurs, not lazily at
the next validation run. The M0–M4 tasks were reverted to testing during
this round before any re-completion; re-acceptance requires the full gate
to pass again on the final tree.
