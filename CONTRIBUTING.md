# Contributing to DIG

DIG is a bounded Gopher client, gateway and inspector. Changes should make the protocol easier to use or verify without weakening its network boundary.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before opening an issue

Search existing reports and use the issue forms. Never post private hostnames, IP addresses, selectors, queries, credentials, response data or network traces. Reproduce against the deterministic fixture when possible, and report security problems through [the security policy](SECURITY.md).

## Local setup

Install Node.js 20 or newer:

```bash
npm ci --ignore-scripts
npm run check
npx --no-install playwright install chromium
npm run test:e2e
npm audit --audit-level=moderate
```

`npm run check` covers unit and integration tests, static-site validation and the exact release contract. The E2E suite starts a real TCP fixture, routes the browser through the local gateway, blocks browser traffic outside its own origin and checks the 320-pixel layout.

Try the deterministic system manually:

```bash
# terminal 1
npm run fixture

# terminal 2
node bin/dig.mjs serve --allow-private
```

Open `http://127.0.0.1:4175/Dig/`, then request `gopher://127.0.0.1:7070/1`.

## What a good change includes

- Add a focused regression test for parser, framing, destination policy, transport, API or output behavior.
- Cite the RFC section when protocol behavior changes.
- Keep total, idle, request, response, concurrency and parsing limits intact unless the change proves a safer replacement.
- Treat DNS answers, server bytes, menu fields, URLs, JSON and terminal output as untrusted.
- Keep hosted mode authenticated and public-address-only.
- Keep private access explicit, local and visibly warned.
- Preserve keyboard use, reduced motion, narrow screens and the static fixture fallback.
- Do not add analytics or cache API responses in the service worker.

Gopher+, TLS, Telnet sessions and arbitrary non-UTF-8 selectors remain outside the implementation unless a proposal defines and tests a new security contract.

## Pull requests

Keep commits narrow and describe the outcome, for example `fix: pin validated DNS address for connect`. Explain what failed, what now enforces the behavior and which checks you ran. Confirm that no private target, token or response data appears in the branch, screenshots, logs or PR description.

Release metadata must stay aligned across `package.json`, `package-lock.json`, the CLI version, cache-busted site assets and `CHANGELOG.md`. Publication remains a separate, reviewed workflow.

By submitting a contribution, you confirm that you have the right to provide it and agree that it will be licensed under the [MIT License](LICENSE).
