<div align="center">
  <img src="site/assets/dig-lockup.svg" width="360" alt="DIG — Gopher Protocol Explorer" />

  # Follow the protocol, line by line.

  [![CI](https://github.com/ejupi-djenis30/Dig/actions/workflows/ci.yml/badge.svg)](https://github.com/ejupi-djenis30/Dig/actions/workflows/ci.yml)

  DIG is a small Gopher client for the terminal and an interactive protocol explorer for the web. The CLI opens real `gopher://` addresses. The public demo uses an included fixture because browsers cannot create raw TCP connections.

  [Live protocol explorer](https://ejupi-djenis30.github.io/Dig/) · [Watch the demo](site/assets/demo.mp4) · [Run the CLI](#run-the-cli) · [Verify a release](#release-integrity) · [Read the parser](site/protocol.mjs)
</div>

## What works

- Parses Gopher menu lines without hiding malformed input.
- Fetches real Gopher resources over TCP from the Node.js CLI.
- Enforces an absolute deadline, an idle timeout, an 8 KiB request cap and a bounded response.
- Parses RFC 4266 search URLs without collapsing selector dot-segments.
- Keeps binary bytes intact and neutralizes terminal control sequences in interactive output.
- Renders a deterministic, keyboard-friendly fixture on GitHub Pages.
- Installs the protocol explorer for repeat offline visits when service workers are available.
- Explains every item type, selector, host and port as you navigate.

## Run the CLI

```bash
git clone https://github.com/ejupi-djenis30/Dig.git
cd Dig
npm test
node bin/dig.mjs gopher://gopher.floodgap.com/1/
```

Inspect the available limits and raw-output mode with `node bin/dig.mjs --help`.

Use only servers you trust and are authorized to reach. The CLI makes a direct, unencrypted
network connection to the host in the URL, including local or private addresses. Redirect binary
items to a file; DIG refuses to print them directly to a terminal. The web demo never connects to
a Gopher server.

## Release integrity

Every release candidate is built twice from a synchronized stable version and the resulting
archives must be byte-for-byte identical. It is then installed in a clean prefix and smoke-tested
through the published `dig-gopher` command. Volatile SBOM metadata is removed and two independently
generated documents must also match byte for byte. The release bundle contains the npm
archive, a CycloneDX SBOM, dependency evidence, the exact source commit, release metadata and a
complete `SHA256SUMS` manifest. Tagged releases are accepted only when the tag matches the project
version and points to the current reviewed `main` commit. GitHub then attests every release asset,
including `SHA256SUMS`, and verifies the OIDC identity, source commit, tag ref and signer workflow.
A tested cross-platform publisher uploads the bundle to a draft, rechecks the current `main` tip and
remote tag, and compares the complete remote inventory and digests before promotion. GitHub must
report the published result as both latest and immutable. A failed pre-publication verification
removes only the exact candidate draft; a published release is never deleted or rewritten.

This integrity evidence does not grant a software license. The repository remains `UNLICENSED`
until all contributors agree on licensing terms.

## Structure

```text
bin/dig.mjs          interactive terminal client
src/client.mjs       bounded TCP transport
site/protocol.mjs    shared URL and menu parser
site/                static GitHub Pages experience
test/                parser and transport tests
```

## Protocol boundaries

DIG implements the base request, menu, text and search-URL behavior used by this project. It does
not implement Gopher+, Telnet sessions, TLS, authentication or automatic downloads. Selectors are
decoded as UTF-8 strings, so arbitrary non-UTF-8 selector octets are outside the current scope.
See [the protocol notes](docs/PROTOCOL.md) for the exact invariants and standards references.

## Project history

The repository began as a Flutter interface prototype by Djenis Ejupi and NobodyToListen. Version 2 replaces committed build output and platform scaffolding with a working, testable protocol core. Git history keeps the original authorship intact.

No license is granted by this repository. Contact the contributors before reusing the code.
