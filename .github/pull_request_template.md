## What changed

Describe the user-visible or protocol-level result. Keep the scope explicit.

## Why

Explain the failure, limitation, or maintenance need this change addresses.

## Verification

- [ ] `npm ci --ignore-scripts`
- [ ] `npm run check`
- [ ] `npm audit --omit=dev --audit-level=high`
- [ ] Keyboard, reduced-motion, narrow-screen, and offline behavior checked when the site changed
- [ ] No private hostnames, selectors, search terms, credentials, or server responses included
- [ ] Release metadata updated together when the version changed

## Security boundaries

State whether the change affects network destinations, request/response limits, terminal output,
binary handling, URL parsing, service-worker caching, or release permissions. Write “None” only
after checking each boundary.
