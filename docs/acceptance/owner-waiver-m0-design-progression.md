# Owner waiver · M0 design-only progression while M-1 remains blocked

Date: 2026-11-21

## Decision

The owner explicitly directed us not to remain stuck on M-1 if the locked validation did not work, and to continue. This authorizes **design-only progression of M0** despite M-1 infrastructure and M-1-device evidence being incomplete.

This is a sequence waiver, **not** a claim that M-1 passed, not acceptance of M-1, not proof that a native build/UI/IPA/SideStore flow works, and not a waiver of M0's own protocol/security review gates. The control record will retain the M-1 block and mark the M0 task as in progress with the M-1-device dependency waived for design work only.

## Scope allowed now

- Read the fixed desktop/mobile source baselines and produce the M0 architecture, protocol, ownership, security and compatibility proposal.
- Use synthetic fixtures for protocol-contract work.
- Obtain independent functional/security review before freezing M0 or starting M1 remote implementation.

## Still prohibited / gated

- No desktop implementation or edits to `C:/pi-GUI`; its checkout is dirty and remains read-only.
- No M1 remote-service implementation until M0 protocol/security contract is complete and independently reviewed.
- No real-device operation, SideStore install, main merge, release, or publication.
- No more M-1 locked CI retries under this waiver. The failed attempt 44906133898 remains recorded; its candidate hashes were withdrawn from the active repository.

## Current design artifact

`docs/decisions/0005-remote-protocol-v1-proposal.md` is a draft. It is source-grounded but does not freeze API v1, satisfy M0 evidence, or replace a threat-model review. M0 may be accepted only after its required unit, protocol-contract, independent-review and independent-security evidence passes.
