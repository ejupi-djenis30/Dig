<div align="center">
  <img src="site/assets/dig-lockup.svg" width="360" alt="DIG — Gopher Protocol Explorer" />

  # Follow the protocol, line by line.

  DIG is a small Gopher client for the terminal and an interactive protocol explorer for the web. The CLI opens real `gopher://` addresses. The public demo uses an included fixture because browsers cannot create raw TCP connections.

  [Live protocol explorer](https://ejupi-djenis30.github.io/Dig/) · [Watch the demo](site/assets/demo.mp4) · [Run the CLI](#run-the-cli) · [Read the parser](site/protocol.mjs)
</div>

## What works

- Parses Gopher menu lines without hiding malformed input.
- Fetches real Gopher resources over TCP from the Node.js CLI.
- Caps response size and connection time so a server cannot hold the process forever.
- Renders a deterministic, keyboard-friendly fixture on GitHub Pages.
- Explains every item type, selector, host and port as you navigate.

## Run the CLI

```bash
git clone https://github.com/ejupi-djenis30/Dig.git
cd Dig
npm test
node bin/dig.mjs gopher://gopher.floodgap.com/1/
```

Use only servers you trust. The CLI makes a direct network connection to the host in the URL. The web demo never connects to a Gopher server.

## Structure

```text
bin/dig.mjs          interactive terminal client
src/client.mjs       bounded TCP transport
site/protocol.mjs    shared URL and menu parser
site/                static GitHub Pages experience
test/                parser and transport tests
```

## Project history

The repository began as a Flutter interface prototype by Djenis Ejupi and project contributors. Version 2 replaces committed build output and platform scaffolding with a working, testable protocol core. Git history keeps the original authorship intact.

No license is granted by this repository. Contact the contributors before reusing the code.
