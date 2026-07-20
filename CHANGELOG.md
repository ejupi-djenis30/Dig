# Changelog

## 2.1.3 — 2026-07-20

- Reconfirm a newly created GitHub draft by its unique ID with bounded backoff before uploading.
- Fail closed when draft visibility times out or GitHub returns duplicate, conflicting, or non-empty state.

## 2.1.2 — 2026-07-20

- Use one UTF-8 byte-ordering rule to generate and verify release checksum manifests.
- Reject mixed-case asset inventories that do not follow the canonical release order.

## 2.1.1 — 2026-07-20

- Make the skip link reliably visible and usable for keyboard navigation.
- Tie the stylesheet, application script and service-worker cache to one release version.
- Prefer fresh static assets while retaining the last verified offline response as a fallback.
- License DIG under MIT with contributor approval and enable the reviewed publication gate.
- Recover only contract-bound drafts and reconcile interrupted release transitions safely.
- Validate the complete release workflow through a fail-closed YAML AST contract.
- Extract real release sections and top-level notes through a CommonMark AST.
- Allow safe release recovery after reviewed `main` advances beyond the tagged commit.
- Pin CI and Pages runners and Node.js patches, with Pages deployment privileges isolated from build.

## 2.1.0 — 2026-07-19

- Preserve Gopher selector dot-segments and support RFC 4266 search URLs.
- Add absolute and idle network deadlines, cancellation, request bounds and binary-safe responses.
- Escape untrusted terminal controls and refuse binary output to an interactive terminal.
- Bound menu parsing and expose malformed destinations without aborting the whole menu.
- Add an installable, offline-capable static protocol explorer.
- Pin CI and Pages actions to reviewed commit SHAs and add weekly Dependabot coverage.

## 2.0.0 — 2026-07-19

- Replace the visual-only Flutter prototype with a working Node.js Gopher client.
- Add a shared protocol parser, deterministic Pages demonstration, tests and CI.
