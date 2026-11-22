# Owner direction · software-first progression, final device checklist and bounded deferrals

Date: 2026-11-21

## Binding direction

The owner directs that all software implementation and feasible automated/Simulator/IPA validation be completed before real-device acceptance. The user will perform one consolidated final checklist for SideStore install, launch, refresh, overwrite upgrade and available iPhone/iPad/network checks. The agent must not request or perform device actions mid-development and must not let hardware availability block software work. Until that checklist is actually performed, device evidence remains pending/unverified; Simulator/IPA results do not replace it.

The owner also directs the agent to autonomously troubleshoot intermediate problems and, when necessary, defer or skip an individual verification rather than stopping overall progress. Ordinary environment/tool/runner/non-core compatibility issues get up to three targeted attempts; if still blocked, preserve the failed run, record cause/impact/unverified evidence/recovery condition, mark deferred and continue independent software work. Do not claim deferred checks passed, remove failure evidence, or imply an unavailable check was run.

Security-sensitive work is not silently weakened to make progress. Authentication, authorization, project/session ownership, credentials, revocation, approvals, secrets and data integrity remain fail-closed. Implementation/testing may proceed in an isolated fixture, separate worktree, or default-disabled mode when a review/tool is unavailable; do not enable or claim acceptance of that boundary without the needed independent security evidence. A waiver is distinct from a review result.

## Sequencing and status

- M-1 infrastructure remains blocked after locked validation CI 44906133898/1 failed before CocoaPods install. The locally mistyped candidate Gemfile digest was corrected in working records; the exact CI subpredicate was not exposed. Per owner direction no retry is active. The active repo is back at `bootstrap-required`.
- Continue software work through M0–M6 and resolve/defer ordinary blockers under the bounded policy. M0 contract design and synthetic tests are active; independent review/tool evidence may be deferred rather than falsely passed. Security-sensitive services stay disabled until independently reviewed.
- M-1-device real installation/upgrade is moved to one final user-operated checklist after software, automation, IPA and required security work. This is a schedule waiver, not successful device evidence.
- Desktop checkout `C:/pi-GUI` remains dirty and read-only. If desktop code must change, use a separate clean worktree/branch, record exact base commit, read relevant desktop rules, run desktop canonical tests and keep its changes separate.

## Evidence integrity

Keep every deferred/waived item explicitly pending or unverified with recovery conditions. Never convert a waiver, manual self-check or cancelled/failed CI into a pass. Keep merge/main and release permissions unchanged.
