<div align="center">
  <img src="site/assets/dig-lockup.svg" width="360" alt="DIG — Gopher Protocol Explorer" />

  # Follow the protocol, line by line.

  [![CI](https://github.com/ejupi-djenis30/Dig/actions/workflows/ci.yml/badge.svg)](https://github.com/ejupi-djenis30/Dig/actions/workflows/ci.yml)

  DIG is a small Gopher client for the terminal and an interactive protocol explorer for the web. The CLI opens real `gopher://` addresses. The public explorer uses an included fixture because browsers cannot create raw TCP connections.

  [Live protocol explorer](https://ejupi-djenis30.github.io/Dig/) · [Run the CLI](#run-the-cli) · [Verify a release](#release-integrity) · [Read the parser](site/protocol.mjs) · [Support](SUPPORT.md) · [Security](SECURITY.md)
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

Install the tested archive from the [latest release](https://github.com/ejupi-djenis30/Dig/releases/latest):

```bash
gh release download --repo ejupi-djenis30/Dig --pattern 'dig-gopher-explorer-*.tgz'
archive="$(find . -maxdepth 1 -name 'dig-gopher-explorer-*.tgz' -print -quit)"
gh attestation verify "$archive" --repo ejupi-djenis30/Dig
npm install --global "$archive"
dig-gopher gopher://gopher.floodgap.com/1/
```

Compare the archive digest with the release's `SHA256SUMS` before installing it. The package needs
Node.js 20 or newer; CI verifies Node.js 20 and 22. It opens a direct, unencrypted TCP connection
to the requested Gopher server.

To work from source instead:

```bash
git clone https://github.com/ejupi-djenis30/Dig.git
cd Dig
npm ci --ignore-scripts
npm test
node bin/dig.mjs gopher://gopher.floodgap.com/1/
```

Inspect the available limits and raw-output mode with `node bin/dig.mjs --help`.

Use only servers you trust and are authorized to reach. The CLI makes a direct, unencrypted
network connection to the host in the URL, including local or private addresses. Redirect binary
items to a file; DIG refuses to print them directly to a terminal. The web explorer never connects to
a Gopher server.

## Release integrity

Every release candidate is built twice from a synchronized stable version and the resulting
archives must be byte-for-byte identical. It is then installed in a clean prefix and smoke-tested
through the published `dig-gopher` command. Volatile SBOM metadata is removed and two independently
generated documents must also match byte for byte. The release bundle contains the npm
archive, a CycloneDX SBOM, dependency evidence, the exact source commit, release metadata and a
complete `SHA256SUMS` manifest. Tagged releases are accepted only when the tag matches the project
version and the tagged commit remains contained in reviewed `main`. Once publication is authorized,
GitHub attests every release asset, including `SHA256SUMS`, and verifies the OIDC identity, source
commit, tag ref and signer workflow. The publisher binds its draft to an exact source, checksum
manifest and changelog contract. Release headings and notes come from a CommonMark AST, so examples,
quotes and raw HTML cannot impersonate a release section. The workflow itself is read as a YAML AST:
duplicate or shadow keys, aliases, explicit tags, unexpected jobs, permission shortcuts and unpinned
actions fail closed. The publisher can recover interrupted creates, uploads and promotions without
adopting a foreign draft, even after reviewed `main` advances beyond the tagged commit. Before
promotion it rechecks the remote tag, default-branch ancestry, release ID and complete asset
inventory. GitHub must report the result as latest and immutable. Rerunning the publisher succeeds
without mutation only when that immutable release still matches the same contract, ID, assets, sizes
and digests.

CI and Pages run on pinned Ubuntu and exact Node.js patch releases. Pages builds the tested static
artifact with read-only source access; only its separate deployment job receives `pages: write` and
an OIDC token. YAML and CommonMark parsers are exact-pinned development dependencies and are not
shipped as CLI runtime dependencies.

DIG is licensed under MIT. Release publication still fails closed unless the repository contains the
canonical `LICENSE`, package and lockfile metadata declare `MIT`, and the reviewed publication gate
remains enabled. A tag alone cannot bypass those checks.

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

The repository began as a Flutter interface prototype by Djenis Ejupi with project contributors. Version 2 replaces committed build output and platform scaffolding with a working, testable protocol core. Shared work is credited collectively.

DIG is available under the [MIT License](LICENSE).
