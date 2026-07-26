# Security model

## Supported versions

Security fixes target the current default branch. Earlier revisions remain available for project history but are not maintained releases.

## Network modes

| Surface | Default destinations | Private access | Listener protection |
| --- | --- | --- | --- |
| CLI fetch | Public only | Explicit `--allow-private` | Local process |
| Local web gateway | Public only | Explicit `--allow-private` | Loopback bind by default |
| Hosted gateway | Public only | Never | Access token required |
| GitHub Pages | None | None | Static fixture only |

An unauthenticated local gateway cannot bind to a non-loopback address. Hosted mode refuses to start without an access token of at least 16 bytes. The browser sends that token as a Bearer credential and keeps it in `sessionStorage`, not persistent storage.

## SSRF controls

For each destination, DIG:

1. Parses only a bounded `gopher://` URL.
2. Resolves all DNS answers with their address families.
3. Normalizes IPv4-mapped IPv6 before classification.
4. Rejects the entire result set when any answer is non-public, unless a local command explicitly enabled private access.
5. Rejects reserved, documentation, multicast and otherwise unusable ranges even with the local override.
6. Opens the socket to the already validated address instead of resolving the hostname again.

This closes the usual mixed-answer and DNS-rebinding gaps. The hosted policy remains fail-closed.

## Gateway controls

- Fetches use a same-origin POST API. The server does not emit CORS headers.
- Hosted requests require a Bearer token compared through fixed-length SHA-256 digests with a timing-safe comparison.
- JSON request bodies have a strict size limit.
- Concurrent fetches and per-address request rates are bounded.
- Static and API responses carry a restrictive CSP and related browser security headers.
- API errors use stable public codes and omit internal stacks.
- The service worker never handles or stores API responses.
- Binary responses cross the JSON boundary as base64 with media type, filename, size and SHA-256 metadata.

The access token protects the gateway, not the outbound Gopher connection. Put TLS in front of an exposed HTTP gateway and manage the token through a secret store. Do not place the token in a URL, repository, image or shell history.

## Resource limits

The default transport applies:

- 5 second total deadline;
- 2 second idle timeout;
- 8 KiB encoded request cap;
- 1 MiB response cap;
- 10 MiB hard configurable response ceiling;
- 10,000 parsed menu-entry cap.

Interactive text is escaped before terminal display. Binary bytes are refused on an interactive terminal. `--output` uses an atomic name operation and refuses overwrite unless `--force` is explicit; it does not claim filesystem-level durability across power loss.

## Remaining risks

Gopher provides no encryption or server authentication. A server can log the client IP, selector and query, return hostile text, or lie about content type. Treat every response and downloaded file as untrusted. Do not use DIG for secrets or contact a system you are not authorized to reach.

The destination policy reduces SSRF risk but does not turn an internet-facing gateway into a general-purpose public service. Keep it behind authentication, rate limits and a trusted reverse proxy.

## Reporting

Use GitHub private vulnerability reporting when available, or email `info@ejupilabs.com`. Do not include credentials, private hostnames, private response data or working exploit details in a public issue.
