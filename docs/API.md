# Gateway API

The DIG browser UI and gateway share one origin. The API is intentionally small and does not support CORS.

## Configuration

```http
GET /Dig/api/config
```

Response:

```json
{
  "schemaVersion": 1,
  "mode": "local",
  "requiresAccessToken": false,
  "allowPrivate": false,
  "privateDestinationWarning": null,
  "limits": {
    "requestBytes": 8192,
    "responseBytes": 1048576,
    "timeoutMs": 5000,
    "idleTimeoutMs": 2000
  },
  "homeAddress": "gopher://gopher.floodgap.com/1/",
  "version": "3.0.0"
}
```

The configuration endpoint contains no secret. In hosted mode, `requiresAccessToken` is true.

## Fetch a resource

```http
POST /Dig/api/fetch
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "address": "gopher://example.org/1/",
  "query": "optional search query",
  "includeRaw": false
}
```

`address` is required. `query` is valid for a search item. `includeRaw` is optional and defaults to false. Unknown fields, wrong types, non-JSON content and oversized bodies are rejected.

The Authorization header is required only when the server configuration says so.

## Shared response fields

```json
{
  "schemaVersion": 1,
  "address": "gopher://example.org/1/",
  "kind": "menu",
  "itemType": "1",
  "itemTypeLabel": "Directory",
  "target": {
    "host": "example.org",
    "port": 70,
    "type": "1",
    "selector": "",
    "query": null
  },
  "connection": {
    "family": 4,
    "address": "203.0.113.10",
    "policy": "public",
    "resolvedCount": 1
  },
  "byteLength": 128,
  "sha256": "64 lowercase hexadecimal characters",
  "durationMs": 12.4
}
```

The address above is illustrative. A real documentation-range address is rejected by the destination policy.

## Menu response

`kind` is `menu`. `entries` contains parsed lines with label, selector, host, port, type metadata, validity and a canonical Gopher URL when the item is safe to request. HTTP/HTTPS `URL:` items expose `externalUrl` and require an explicit browser click.

With `includeRaw: true`, menu and text responses also contain:

```json
{
  "raw": {
    "encoding": "base64",
    "data": "...",
    "sha256": "the same digest as the shared response"
  }
}
```

## Text response

`kind` is `text`. `text` contains the decoded, de-framed and dot-unstuffed response. The shared byte count and digest still describe the original bytes received from the server.

## Binary response

```json
{
  "kind": "binary",
  "mediaType": "application/octet-stream",
  "encoding": "base64",
  "data": "...",
  "suggestedFilename": "archive.bin"
}
```

Binary data is already exact and is not duplicated by `includeRaw`.

## External response

An `h` item whose selector contains a valid HTTP or HTTPS `URL:` is returned as `kind: "external"` without opening a Gopher socket or following the link.

## Errors

Errors use:

```json
{
  "error": {
    "code": "DESTINATION_BLOCKED",
    "message": "The destination resolves to a non-public address."
  }
}
```

Common status codes:

| Status | Meaning |
| ---: | --- |
| 400 | Invalid body, URL or search request |
| 401 | Hosted access token missing or invalid |
| 403 | Origin or destination policy blocked the request |
| 413 | Request or Gopher response exceeded a byte limit |
| 415 | Content type is not JSON |
| 422 | Item type cannot be requested |
| 429 | Per-address rate limit reached |
| 502 | Gopher destination could not be reached |
| 503 | Concurrent fetch capacity reached |
| 504 | Total or idle timeout expired |

Internal stacks and transport details are not returned.
