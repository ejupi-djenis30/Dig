# Security model

The website is a static protocol demonstration. It reads only the fixture files shipped with this repository and performs no network requests after load.

The command-line client opens a TCP connection to the host supplied by its user. It enforces a five-second timeout, a one-megabyte response limit and strict `gopher://` URL parsing. Do not point it at internal services you are not authorized to access.

Please report a vulnerability privately through GitHub's security advisory feature. Do not include credentials or private server contents in an issue.
