# Security model

## Supported versions

Security fixes target the current default branch. Earlier revisions remain available for project history but are not maintained releases.

## Network modes

| Surface | Default destinations | Private access | Listener protection |
| --- | --- | --- | --- |
| CLI fetch | Public only | Explicit `--allow-private` | Local process |
| Local web gateway | Public only | Explicit `--allow-private` | Loopback bind by default |
| Hosted gateway | Public only | Never | Access token required |
| Android APK | Public only | Never | No inbound listener |
| GitHub Pages | None | None | Static fixture only |

An unauthenticated local gateway cannot bind to a non-loopback address. Hosted mode refuses to start without an access token of at least 16 bytes and rejects a non-loopback browser origin unless it uses HTTPS. The browser sends that token as a Bearer credential and keeps it in `sessionStorage`, not persistent storage.

The Android APK packages the Explorer locally and uses its bundled Capacitor plugin for direct Gopher TCP. It does not navigate to a remote DIG website, run an HTTP gateway or accept inbound connections.

## SSRF controls

For each destination, DIG:

1. Parses only a bounded `gopher://` URL.
2. Resolves all DNS answers with their address families.
3. Normalizes IPv4-mapped IPv6 before classification.
4. Rejects the entire result set when any answer is non-public, unless a local CLI or local gateway command explicitly enabled private access.
5. Rejects reserved, documentation, multicast and otherwise unusable ranges even with the local override.
6. Opens the socket to the already validated address instead of resolving the hostname again.

This closes the usual mixed-answer and DNS-rebinding gaps. The hosted and Android policies remain fail-closed; the Android application exposes no private-network override.

## Gateway controls

- Fetches use a same-origin POST API. The server does not emit CORS headers.
- Hosted requests require a Bearer token compared through fixed-length SHA-256 digests with a timing-safe comparison.
- JSON request bodies have a strict size limit.
- Concurrent fetches and per-address request rates are bounded.
- Static and API responses carry a restrictive CSP and related browser security headers.
- API errors use stable public codes and omit internal stacks.
- The service worker never handles or stores API responses.
- Binary responses cross the JSON boundary as base64 with media type, filename, size and SHA-256 metadata.

The access token protects the gateway, not the outbound Gopher connection. Put a TLS reverse proxy in front of the gateway, configure its exact HTTPS origin and manage the token through a secret store. Do not place the token in a URL, repository, image or shell history.

## Android controls

- The native bridge accepts only bounded, typed request fields and rejects line breaks, NUL bytes, malformed ports, unsupported item types and invalid search inputs.
- The executor permits at most four active and sixteen queued Gopher requests.
- Cancellation interrupts the task and closes its active socket.
- Native errors use bounded public codes and messages instead of returning Java stacks.
- Binary bytes cross the bridge as bounded base64 with size, digest and connection metadata, then use Android's document picker for explicit saves.
- The manifest requests only `android.permission.INTERNET`; document saves do not require broad storage permission.
- WebView debugging, remote server navigation, cleartext WebView traffic and Android backup are disabled in the release configuration.
- The public website's source link is physically excluded from generated APK assets and is checked by the Android bundle test.

The Android destination sees the device's public network address. The policy prevents access to private and special-purpose destinations, but it does not conceal public requests.

## Resource limits

The CLI and gateway default transport applies:

- 5 second total deadline;
- 2 second idle timeout;
- 8 KiB encoded request cap;
- 1 MiB response cap;
- 10 MiB hard configurable response ceiling;
- 10,000 parsed menu-entry cap.

The Android native transport applies:

- 10 second total deadline;
- 2 second idle timeout;
- 8 KiB encoded request cap;
- 1 MiB response cap;
- four concurrent and sixteen queued request cap; and
- immediate socket closure when a request is cancelled.

Interactive text is escaped before terminal display. Binary bytes are refused on an interactive terminal. `--output` uses an atomic name operation and refuses overwrite unless `--force` is explicit; it does not claim filesystem-level durability across power loss.

## Remaining risks

Gopher provides no encryption or server authentication. A server can log the client IP, selector and query, return hostile text, or lie about content type. Treat every response and downloaded file as untrusted. Do not use DIG for secrets or contact a system you are not authorized to reach.

The destination policy reduces SSRF risk but does not turn an internet-facing gateway into a general-purpose public service. Keep it behind authentication, rate limits and a trusted reverse proxy.

Install Android APKs only from a trusted release channel and verify their signing certificate. Keep the release keystore and credentials outside the repository and CI logs, back them up securely, and use the same signing identity for every update.

## Reporting

Use GitHub private vulnerability reporting when available, or email `info@ejupilabs.com`. Do not include credentials, private hostnames, private response data or working exploit details in a public issue.
