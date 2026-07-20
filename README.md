<div align="center">
  <img src="site/assets/dig-lockup.svg" width="360" alt="DIG — Gopher Protocol Explorer" />

  # Follow the protocol, line by line.

  [![CI](https://github.com/ejupi-djenis30/Dig/actions/workflows/ci.yml/badge.svg)](https://github.com/ejupi-djenis30/Dig/actions/workflows/ci.yml)

  DIG is a small Gopher client for the terminal and an interactive protocol explorer for the web. The CLI opens real `gopher://` addresses. The public demo uses an included fixture because browsers cannot create raw TCP connections.

  [Live protocol explorer](https://ejupi-djenis30.github.io/Dig/) · [Watch the demo](site/assets/demo.mp4) · [Run the CLI](#run-the-cli) · [Support](SUPPORT.md) · [Security](SECURITY.md)
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
