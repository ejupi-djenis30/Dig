# Self-hosting DIG

Start with [the security model](../SECURITY.md). A hosted DIG instance is a network client and must not become an anonymous proxy.

## Loopback development

```bash
node bin/dig.mjs serve
```

The default listener is `127.0.0.1:4175` and accepts public Gopher destinations. Private access requires a visible, explicit override:

```bash
node bin/dig.mjs serve --allow-private
```

An unauthenticated local server cannot bind to a non-loopback address.

## Authenticated hosted mode

Set a random access token of at least 16 bytes through your process manager or secret store:

```bash
export DIG_ACCESS_TOKEN="$(openssl rand -hex 32)"
export DIG_ORIGIN='https://dig.example.com'
node bin/dig.mjs serve --hosted --host 0.0.0.0 --port 4175
```

`openssl rand -hex 32` produces a 256-bit token. Do not put the result in a repository, image, URL or shell history. Put TLS in front of the HTTP listener before sending a token over a network.

Hosted mode:

- requires the Bearer token;
- permits only public Gopher destinations;
- rejects mixed public/private DNS answers;
- connects to the validated IP;
- applies request, response, time, concurrency and rate bounds;
- serves the UI and API from the same origin.

A non-loopback listener refuses to start without an exact browser origin. Hosted deployments also reject non-loopback origins that are not HTTPS; plain HTTP is accepted only for an exact loopback origin used during local operation. Set `DIG_ORIGIN` or pass `--origin https://dig.example.com` behind a TLS reverse proxy.

## Docker Compose

`compose.yaml` publishes the port on host loopback only, drops Linux capabilities, enables `no-new-privileges` and uses a read-only filesystem.

```bash
cp .env.example .env
# Put the output of `openssl rand -hex 32` in DIG_ACCESS_TOKEN inside .env.
docker compose up --build
```

Open `http://127.0.0.1:4175/Dig/`. Compose defaults `DIG_ORIGIN` to that exact origin; override it for a reverse proxy. The image refuses to start without the token. Change the port mapping only after placing an authenticated TLS reverse proxy in front of the container.

The image health endpoint is:

```http
GET /healthz
```

It reports only status, mode and version.

## Environment variables

`scripts/serve-app.mjs` supports:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DIG_HOST` | `127.0.0.1` | HTTP bind address |
| `DIG_PORT` | `4175` | HTTP port |
| `DIG_MODE` | `local` | `local` or `hosted` |
| `DIG_ACCESS_TOKEN` | unset | API Bearer token |
| `DIG_ALLOW_PRIVATE` | `0` | `1` enables private targets in local mode |
| `DIG_ORIGIN` | unset | Exact accepted browser origin |
| `DIG_TIMEOUT_MS` | `5000` | Total Gopher deadline |
| `DIG_IDLE_TIMEOUT_MS` | `2000` | Socket idle timeout |
| `DIG_MAX_BYTES` | `1048576` | Response byte cap |
| `DIG_HOME_ADDRESS` | public default | Initial Gopher URL |

The CLI exposes the same transport limits as flags. Hard ceilings remain enforced in code.

## Reverse proxy checklist

- Terminate TLS and redirect plain HTTP before it reaches the app.
- Emit `Strict-Transport-Security` from the public HTTPS origin after validating the deployment.
- Preserve the original `Origin` header.
- Do not enable CORS.
- Add an outer request-rate and connection limit.
- Keep response buffering limits compatible with DIG's configured byte cap.
- Keep logs free of Authorization headers, selectors, queries and response bodies.
- Rotate the access token after suspected exposure.
- Monitor the process and `/healthz`; never use a Gopher fetch as a health check.
