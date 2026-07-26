# Protocol contract

DIG follows the base request and menu format in [RFC 1436](https://www.rfc-editor.org/rfc/rfc1436) and the URI rules in [RFC 4266](https://www.rfc-editor.org/rfc/rfc4266).

## URL handling

- Only `gopher://` URLs are accepted.
- A missing path means item type `1` with an empty selector.
- The first path character selects the item type.
- Selector dot-segments remain protocol data; DIG does not normalize them as HTTP paths.
- A first encoded tab (`%09`) separates a type `7` search query from its selector.
- Credentials, fragments, malformed percent escapes, control characters and Gopher+ fields are rejected.
- IPv6 literals must use brackets.
- Ports must be between 1 and 65535.
- UTF-8 is the supported encoding for URL fields. Arbitrary non-UTF-8 selector octets are outside the current contract.

## Request framing

The client sends:

```text
selector [ TAB query ] CR LF
```

The encoded request is capped at 8 KiB. Search items require a non-empty query. The transport opens one TCP connection, writes one request and reads one bounded response.

## Response handling

### Menus

A menu line has five relevant fields:

```text
type + label TAB selector TAB host TAB port
```

Extra fields are ignored. Malformed lines remain visible to the inspector but are not requestable. Parsing stops at a period on its own line. A menu cannot exceed 10,000 entries.

Supported requestable menu families include text (`0`), directory (`1`), error text (`3`), common binary types (`4`, `5`, `6`, `9`, `g`, `I`, `s`, `d`, `P`), search (`7`) and redundant servers (`+`). Information, Telnet, TN3270 and unknown types are inspection-only. An `h` item is requestable only as an explicit HTTP or HTTPS link when its selector begins with `URL:`.

### Text

For text and error-text resources, DIG removes the final period line and reverses RFC 1436 dot stuffing. A line beginning with two periods loses exactly one leading period.

### Binary

Binary bytes are never decoded as UTF-8. The CLI writes them only to redirected stdout or `--output`. The HTTP API returns base64 plus the byte count, SHA-256 digest, media type and suggested filename.

### Raw inspection

Menu and text responses expose decoded data by default. `includeRaw: true` adds the byte-exact response as base64 with the same SHA-256 digest. Binary responses already contain byte-exact base64 and are not duplicated.

## Transport limits

Defaults:

| Limit | Default | Hard ceiling |
| --- | ---: | ---: |
| Total deadline | 5,000 ms | 60,000 ms |
| Idle timeout | 2,000 ms | 60,000 ms |
| Response bytes | 1 MiB | 10 MiB |
| Request bytes | 8 KiB | 8 KiB |

The total deadline uses a monotonic clock and remains effective even if a server drips data. The idle timer closes a connection that stops making progress. AbortSignal cancellation destroys the socket.

## Deliberate exclusions

DIG does not implement Gopher+, Telnet/TN3270 sessions, TLS, server authentication, automatic external-link opening or recursive crawling.
