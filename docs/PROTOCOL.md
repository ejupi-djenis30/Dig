# Protocol contract

DIG follows the base Gopher request and URI formats described by
[RFC 1436](https://www.rfc-editor.org/rfc/rfc1436) and
[RFC 4266](https://www.rfc-editor.org/rfc/rfc4266).

## Implemented behavior

- A missing Gopher path resolves to item type `1` and an empty selector.
- Selector dot-segments are preserved. They are protocol data, not HTTP path navigation.
- A first encoded tab (`%09`) separates a search query from the selector.
- The client sends `selector`, an optional tab and query, then CRLF.
- Menu responses stop at a period on its own line. Extra tab-separated menu fields are ignored.
- Text responses have their terminating period line removed before display.
- Binary item types are returned as bytes instead of being decoded as UTF-8.

## Deliberate limits

- Gopher+ fields and forms are rejected.
- Item types must be visible ASCII.
- URI fields are decoded as UTF-8; arbitrary non-UTF-8 selector octets are unsupported.
- Menus are capped at 10,000 entries and requests at 8 KiB.
- The default response cap is 1 MiB. The hard configurable ceiling is 10 MiB.
- The CLI does not follow menu links automatically or execute Telnet items.

The static website parses a committed recording only. Raw TCP is available exclusively through
the local Node.js client.
