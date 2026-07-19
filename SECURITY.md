# Security model

## Supported versions

Security fixes target the current default branch. Earlier Git revisions are retained for project
history and are not maintained releases.

The website is a static protocol demonstration. It reads only the fixture files shipped with this repository and performs no network requests after load.

The command-line client opens a plaintext TCP connection to the host supplied by its user. It can
reach loopback, private, and public addresses because it is a local client rather than a hosted
proxy. Do not point it at services you are not authorized to access, and do not put secrets in a
selector or search query.

The transport applies a five-second absolute deadline, a shorter idle timeout, an 8 KiB encoded
request limit, and a one-megabyte default response limit. Interactive text output escapes terminal
control sequences, and binary resources are refused when stdout is a terminal. `--raw` and
redirected output are intentionally byte-oriented; treat files from unknown servers as untrusted.

Gopher provides no transport encryption or server authentication. DIG does not claim to make the
protocol safe for sensitive data.

Report a vulnerability through GitHub private vulnerability reporting when it is available, or
email `info@ejupilabs.com`. Do not include credentials or private server contents in a public issue.
