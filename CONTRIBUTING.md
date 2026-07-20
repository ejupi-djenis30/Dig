# Contributing to DIG

DIG is deliberately small: a bounded local Gopher client and a static protocol explorer. A change
should make that scope easier to understand, test, or use.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before opening an issue

Use the issue forms and search for an existing report first. Never post private hostnames, IP
addresses, selectors, search terms, credentials, or server response data. Reproduce the problem
against a public server or the bundled fixture when possible. Otherwise replace identifying values
before you paste a command, screenshot, trace, or log.

Report security problems through [the security policy](SECURITY.md), not a public issue.

## Local setup

Install Node.js 20 or newer, then run:

```bash
npm ci --ignore-scripts
npm run check
npm audit --omit=dev
```

`npm run check` runs the Node test suite and validates the static site. If you edit a workflow, run
[`actionlint`](https://github.com/rhysd/actionlint) locally when it is available.

To exercise the CLI, use a server you are allowed to contact:

```bash
node bin/dig.mjs gopher://example.org/1/
```

The connection is plaintext. Do not use sensitive selectors or queries.

## What a good change includes

- Add a focused regression test for parser, framing, transport, or output behavior.
- Cite the relevant RFC section when protocol behavior changes.
- Keep the absolute deadline, idle timeout, request limit, and response limit intact unless the PR
  explains and tests a safer replacement.
- Treat server bytes, menu fields, URLs, and terminal output as untrusted.
- Keep the hosted explorer static and fixture-backed. It must not become an open network proxy.
- Keep keyboard, reduced-motion, narrow-screen, and offline behavior working in the demo.

Gopher+, TLS, authentication, Telnet sessions, and arbitrary non-UTF-8 selectors are outside the
current implementation. Proposals may discuss them, but should not quietly widen the scope.

## Pull requests

Keep commits narrow and write commit messages that describe the result, such as
`fix: unstuff dot-prefixed text lines`. In the PR, explain what failed before, what now enforces the
behavior, and how you checked it. Confirm that no private target or response data appears in the
branch, test output, screenshots, or PR description.

This repository does not currently grant a reuse license. By submitting a contribution, you
confirm that you have the right to provide it; the repository's licensing status does not change.
