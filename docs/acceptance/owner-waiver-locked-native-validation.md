# Owner waiver · locked native validation only (withdrawn)

## Authorization and scope

The repository owner authorized one trial of the macOS candidate from CI 44901616612 with the independent review skipped, solely to test locked dependency installation. The waiver did **not** create independent-review/security/handoff evidence, accept M-1, or authorize merge, release, SideStore, or real-device operation.

The one attempt was CI 44906133898. It stopped immediately in locked dependency preparation before CocoaPods install. The public diagnostic was generic. Local comparison identified a malformed manually transcribed Gemfile digest (62 characters instead of the candidate's 64-character hash); the corrected value was checked against the original candidate artifact. Per the owner's instruction to stop spending time on M-1, no retry will be launched in this turn.

The waiver is withdrawn/consumed. The active repository has been returned to `bootstrap-required` and the unreviewed lock set removed. The original candidate files remain in the ignored local artifact directory `artifacts/ci-44901616612-lock-candidates/`; no lock is marked approved in the repository.

## Manual checks (not independent review)

- Candidate run 44901616612 completed the real POSIX suite (336/336), prebuild, CocoaPods install and 21,043-file / 7,735-link inventory before its deliberate bootstrap exit 78.
- The exact RN facade exception in that inventory was two namespace links to a single byte-hashed file. A local recheck matched the full link inventory to the finite Hermes, npm-bin and CocoaPods-header policies.
- Candidate Gemfile.lock and Podfile.lock copies passed the fixed Ruby 3.3.8/Bundler 2.6.9 semantic validator (`NATIVE_LOCKS_SAFE`).
- The generated Podfile hash is not locally recomputable because the transient CI file is not uploaded.

These author-side checks do not replace independent security review, a successful locked installation, native build, Simulator UI, device IPA, or M-1 acceptance.

## Forward work

Continue only with non-gating M0 architecture research/proposal documents. `docs/decisions/0005-remote-protocol-v1-proposal.md` is a draft, not a frozen API, implementation authorization, or M0 acceptance. M-1-infrastructure remains blocked; M-1-device and formal M0 remain pending. Do not change task dependencies or claim M-1 passed.
