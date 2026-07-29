# DIG Privacy Notice

**Effective date: July 26, 2026**

This notice describes the privacy behavior built into DIG's standalone Android application, mobile web application and Progressive Web App (PWA). DIG may be self-hosted or provided by another operator. A hosted operator's server-side processing, logs, and privacy terms are separate from the client-side behavior described here.

## Data stored on your device

DIG stores the following application data in storage associated with DIG's browser or Android WebView origin:

- **Session history** in `sessionStorage`.
- **Gateway access token**, when one is configured in the web or PWA edition, in `sessionStorage`.
- **Bookmarks** in `localStorage`.

DIG does not provide its own cloud synchronization for this data. Android application backup is disabled. Session history and bookmarks are not separately uploaded as account data. If you open a saved or previous Gopher location, its selector or query is sent again as part of that request. When web gateway authentication is required, the access token is sent to the same-origin gateway as a Bearer credential.

Browser and WebView storage are not secure vaults. People or software with access to your device, browser profile, app data or DIG's origin may be able to access locally stored data. Avoid saving sensitive information, and do not use DIG on an untrusted or shared device without clearing its data afterward.

## Network requests and the Gopher protocol

The standalone Android application connects directly from the device to the requested public Gopher server over TCP. It does not send Gopher requests through DIG's HTTP gateway. Before connecting, the app resolves every DNS answer, refuses the complete result when any answer is private or otherwise non-public, and connects to the address it validated. There is no Android private-network override.

The web and PWA editions send live fetch requests to a gateway on the same origin as the app. The gateway then connects to the requested Gopher server. The public GitHub Pages edition uses a local fixture and makes no remote Gopher request.

Gopher is a plaintext protocol and does not provide encryption or server authentication. In the Android application, the Gopher destination sees the device's public network address; the destination, selector, search query and response content can be visible to the destination server and network intermediaries. In a gateway-backed web deployment, that information can also be visible to the gateway operator. Protection between a browser and its same-origin gateway depends on that deployment's HTTPS configuration.

Do not use DIG to send passwords, personal data, confidential information, or other secrets over Gopher.

## Analytics, advertising, and tracking

DIG does not include analytics, advertising, behavioral profiling, or third-party tracking in the application. It does not send local session history or bookmarks to analytics or advertising providers.

This does not prevent a gateway or hosting operator, an app distribution platform, a network provider, or a Gopher server from observing or recording information available to it as described in this notice.

## Hosted deployments and server logs

An operator hosting DIG or its same-origin gateway may keep access, error, security, or infrastructure logs. Depending on that operator's configuration, logs may contain information such as an IP address, timestamp, user agent, request path, response status, or operational security event. This hosted processing does not apply to direct Gopher requests made by the standalone Android application.

DIG does not control an independent operator's logging, retention, disclosure, or security practices. Consult the operator's privacy notice or contact the operator for details. Gopher servers you contact may also apply their own logging and privacy practices.

## Retention and deletion

- Data in `sessionStorage` is intended for the current browser tab or session. The browser controls its exact lifetime, and features such as crash recovery or session restoration may retain it longer than expected.
- Bookmarks in `localStorage` remain until they are deleted or DIG's site data is cleared.
- You can remove all locally stored DIG data through your browser's controls for clearing site data for DIG's origin. Uninstalling a PWA may not, by itself, clear the browser's site data.
- On Android, clearing DIG's storage or uninstalling the application removes its app-private WebView data. Files you explicitly save through Android's document picker are separate documents and remain until you delete them from their chosen location.
- Server logs or records held by a hosting operator, gateway operator, network provider, or Gopher server cannot be deleted through DIG. Contact the relevant operator about retention, deletion, or applicable privacy rights.

## Security

Use a trusted DIG deployment and a secure device. Treat every Gopher response and downloaded file as untrusted. For DIG's security model and instructions for privately reporting a vulnerability, see the [DIG Security Policy](https://github.com/ejupi-djenis30/Dig/security/policy).

## Changes to this notice

A revised notice may be published when DIG's privacy behavior changes. The effective date at the top identifies the version of this notice.

## Contact

For privacy or security questions about DIG, email [info@ejupilabs.com](mailto:info@ejupilabs.com). If you use a deployment operated by someone else, contact that operator about its server-side processing and logs.
