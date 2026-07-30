# Changelog

## 3.2.1 — 2026-07-30

- Stabilize the mobile explorer panel controls and add regression coverage for narrow Chromium and WebKit layouts.
- Publish scoped discovery metadata, a security contact, a sitemap and a direct link to the latest reviewed release on GitHub Pages.
- Require every release tag to be annotated, signed and reported as verified by GitHub before the publisher can create or modify a release.
- Include the referenced operating documentation in the CLI archive and publish canonical repository, issue and project-page metadata with the package.
- Add a project-scoped not-found page and extend automated dependency updates to the Android Gradle build.

## 3.2.0 — 2026-07-29

- Add a standalone Android application with direct, bounded Gopher TCP transport and no remote web dependency.
- Remove the Source link from the packaged Android assets while retaining it on the public website.
- Add Android destination policy, cancellation, timeout, build and bundle regression coverage.
- Make the explorer installable and usable as a mobile PWA with safe-area layouts, touch navigation, offline recovery, explicit updates and iOS assets.
- Add mobile Chromium and WebKit coverage, a privacy disclosure and production checks for install metadata and screenshots.
- Harden hosted origin validation, loopback matching, IPv6 documentation ranges and container runtime configuration.
- Publish the signed Android APK only after its application identity, version, permissions, certificate, embedded source commit and checksums pass independent verification.

## 3.1.0 — 2026-07-26

- Make the explorer installable and usable as a mobile PWA with safe-area layouts, touch navigation, offline recovery, explicit updates and iOS assets.
- Add mobile Chromium and WebKit coverage, a privacy disclosure and production checks for install metadata and screenshots.
- Harden hosted origin validation, loopback matching, IPv6 documentation ranges and container runtime configuration.

## 3.0.0 — 2026-07-26

- Add a real same-origin Gopher gateway with DNS pinning, fail-closed hosted SSRF policy and deterministic TCP integration tests.
- Turn the web explorer into a live local client with search, history, bookmarks, export, raw inspection and binary downloads.
- Add atomic CLI output, explicit private-network access, SHA-256 reporting, authenticated hosted mode and Docker self-hosting.

## 2.1.4 — 2026-07-20

- Credit shared work collectively without publishing individual contributor identities.
- Rebuild the Pages hero on a measured, symmetric protocol map with responsive keyboard support.
- Keep release metadata, offline assets and the command-line version aligned after the privacy rewrite.

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
