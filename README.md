<div align="center">
  <img src="site/assets/dig-lockup.svg" width="360" alt="DIG — Gopher Protocol Explorer" />

  # Follow the protocol, line by line.

  [![CI](https://github.com/ejupi-djenis30/Dig/actions/workflows/ci.yml/badge.svg)](https://github.com/ejupi-djenis30/Dig/actions/workflows/ci.yml)

  DIG is a bounded Gopher client with a command line, a local web inspector, a small same-origin gateway and a standalone Android app. It opens real `gopher://` resources without hiding selectors, item types, response bytes or limits.

  [Public fixture](https://ejupi-djenis30.github.io/Dig/) · [CLI](#command-line) · [Local explorer](#local-explorer) · [Android](#install-on-mobile) · [Self-hosting](docs/SELF_HOSTING.md) · [API](docs/API.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md)
</div>

## What DIG does

- Opens Gopher resources over a direct TCP connection.
- Parses RFC 1436 menus, text framing and RFC 4266 URLs and search queries.
- Resolves every DNS answer, rejects unsafe mixed results and connects to the validated IP.
- Applies a total deadline, an idle timeout, an 8 KiB request cap and a bounded response.
- Preserves binary bytes and reports the response size and SHA-256 digest.
- Saves exact CLI output through a same-directory temporary file, then exposes the complete target through an atomic name operation.
- Provides menu navigation, search, session history, bookmarks, JSON export and opt-in raw inspection in the local UI.
- Packages the Explorer as a normal Android APK with a native, direct TCP Gopher transport.
- Runs deterministic TCP, unit, integration, Chromium and mobile WebKit tests without contacting an external Gopher server.

The GitHub Pages site uses a committed fixture because browser JavaScript cannot open raw TCP sockets. Start the local gateway when you want the browser interface backed by real Gopher requests, or use the Android APK for direct Gopher access without a gateway.

## Command line

DIG needs a maintained Node.js release (22 or newer) and has no runtime dependencies.

```bash
node bin/dig.mjs gopher://gopher.floodgap.com/1/
node bin/dig.mjs --query "client design" gopher://example.org/7/search
node bin/dig.mjs --output response.bin gopher://example.org/9/archive.bin
node bin/dig.mjs --json gopher://example.org/0/readme
```

Every successful fetch prints a SHA-256 digest and byte count on stderr. `--output` writes the exact response bytes and refuses to replace an existing file unless `--force` is explicit. Binary data is never printed to an interactive terminal.

Private and loopback destinations are blocked by default:

```bash
node bin/dig.mjs --allow-private gopher://127.0.0.1:7070/1
```

That flag changes the trust boundary and prints a warning. Use it only for a target you control.

Install a verified release archive:

```bash
gh release download --repo ejupi-djenis30/Dig --pattern 'dig-gopher-explorer-*.tgz'
archive="$(find . -maxdepth 1 -name 'dig-gopher-explorer-*.tgz' -print -quit)"
gh attestation verify "$archive" --repo ejupi-djenis30/Dig
npm install --global "$archive"
dig-gopher --help
```

Compare the archive with `SHA256SUMS` from the same release before installation.

## Local explorer

Start the browser UI on loopback:

```bash
node bin/dig.mjs serve
```

Open `http://127.0.0.1:4175/Dig/`. Public Gopher destinations are available. To inspect a private fixture or a server on your own network:

```bash
node bin/dig.mjs serve --allow-private
```

The UI stores navigation history in `sessionStorage`, bookmarks in `localStorage` and a hosted access token in `sessionStorage`. It does not send analytics. The service worker never caches API responses.

For a deterministic local session:

```bash
# terminal 1
npm run fixture

# terminal 2
node bin/dig.mjs serve --allow-private
```

Then open `gopher://127.0.0.1:7070/1` in the address bar.

See [self-hosting](docs/SELF_HOSTING.md) for Docker and authenticated hosted mode. The JSON contract is documented in [the API reference](docs/API.md).

## Install on mobile

The standalone Android application is a normal Capacitor 8 APK with package ID `com.ejupilabs.dig`. It contains the Explorer assets locally and opens Gopher resources through the bundled native TCP transport; it is not a remote website wrapper and does not require DIG's HTTP gateway. Android 7.0/API 24 or newer is supported, and the current build targets API 36.

The public website still links to the source repository. Its Android exclusion block is removed while producing the packaged web assets, so that source link is physically absent from the APK rather than merely hidden with CSS. See [the Android build guide](docs/ANDROID.md) for prerequisites, tests, signing and APK verification.

DIG can also be installed as a Progressive Web App from a supported mobile browser. On Android, use the browser's install action when it appears. On iPhone or iPad, open the Share menu and choose **Add to Home Screen**. This browser-installed edition keeps the verified offline fixture; live Gopher browsing requires DIG's authenticated same-origin gateway behind HTTPS because a browser cannot open raw TCP sockets.

## Security boundary

Gopher is plaintext. DIG cannot authenticate a Gopher server or protect selectors and response data in transit.

Hosted mode is not an anonymous proxy. It requires an access token, refuses private destinations, rejects a hostname if any DNS answer is non-public, and connects to the IP it already validated. Local private access requires an explicit flag and visible warning. The gateway accepts fetches only from its own browser origin and never emits CORS headers.

The Android transport always refuses private, loopback, link-local, reserved, documentation and mixed public/private DNS results. There is no Android private-network override. Read [SECURITY.md](SECURITY.md) before installing an APK or exposing the gateway beyond loopback.

## Protocol coverage

DIG implements base Gopher requests, menus, text, search and common binary item types. It does not open Telnet sessions, implement Gopher+, add TLS, or reinterpret arbitrary selector bytes as a filesystem path. UTF-8 is the supported URL field encoding.

The exact behavior and deliberate limits are in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Develop and verify

```bash
npm ci --ignore-scripts
npm run check
npx --no-install playwright install chromium webkit
npm run test:e2e
npm audit --audit-level=moderate
```

`npm run check` covers the protocol, transport, network policy, HTTP API, CLI output, static site and release contracts. The E2E suite starts a real TCP fixture behind the local gateway and blocks browser requests outside its own origin.

Android development additionally requires JDK 21 and Android SDK Platform 36:

```bash
npm run android:sync
cd android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

On Windows, run `.\gradlew.bat` in place of `./gradlew`. For a local release, set `JAVA_HOME` to JDK 21, run `npm run android:signing:init` once, back up the generated `.android-signing` directory securely, then run `npm run android:apk`. The signing material is gitignored and must never be committed. The complete local and CI procedure is in [docs/ANDROID.md](docs/ANDROID.md).

```text
bin/dig.mjs             executable entry point
src/client.mjs          bounded TCP transport
src/network-policy.mjs  DNS and destination policy
src/resource.mjs        JSON-safe resource model
src/http-server.mjs     same-origin local/hosted gateway
src/cli.mjs             fetch and serve commands
site/protocol.mjs       shared URL, menu and text parser
site/                    fixture fallback and live inspector
mobile/                  Android web entry and native bridge
android/                 Capacitor application and native Gopher transport
scripts/gopher-fixture.mjs
test/ and e2e/           unit, integration and browser tests
```

## Release integrity

Release validation keeps the package version, lockfile, CLI output, Android identity and changelog aligned. It checks the exact archive inventory, verifies the signed APK twice, binds its embedded source commit and checksums to the tag, and publishes only the reviewed tag contract. GitHub attestations bind every released asset, including the APK, to the repository, commit, tag and signer workflow.

The package remains private on npm; distribution uses signed GitHub Release artifacts. DIG is available under the [MIT License](LICENSE). Ejupi Labs and DIG contributors share credit for the project.
