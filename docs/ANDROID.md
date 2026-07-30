# Android application

DIG 3.2.1 includes a standalone Android application. Capacitor packages the reviewed Explorer assets, while an app-local Java plugin performs Gopher I/O over a direct TCP socket. The APK does not load DIG from a remote web server and does not use the HTTP gateway.

## Build contract

| Property | Value |
| --- | --- |
| Capacitor | 8.4.2 |
| Application ID | `com.ejupilabs.dig` |
| Minimum Android version | API 24 (Android 7.0) |
| Compile and target SDK | API 36 |
| Minimum supported WebView | 120 |
| Packaged web directory | `dist/android` |
| Native permission | `android.permission.INTERNET` |

Changing the application ID or release signing identity after distribution creates a different application and prevents normal updates. Settle both before publishing the first public APK.

## Runtime architecture

The Android web entry registers the `DigGopher` Capacitor plugin before loading the Explorer. Requests cross that local bridge as structured values; the plugin validates the host, port, selector, item type and optional search query, then opens a raw Gopher TCP connection from the device. Responses return as bounded base64 plus byte count, duration, connection address and SHA-256 metadata. Menu and text parsing stays shared with the web client.

The Android transport:

- resolves every DNS answer and rejects the complete set if any address is not public;
- blocks private, loopback, link-local, carrier-grade NAT, reserved, documentation, benchmark and multicast ranges, including their IPv6 equivalents;
- connects to the already validated address instead of resolving the hostname a second time;
- has no private-network override;
- limits a request to 8 KiB and a response to 1 MiB;
- applies a 10 second total deadline and a 2 second idle timeout;
- permits at most four concurrent requests and sixteen queued requests;
- closes the active socket when a request is cancelled; and
- saves binary responses through Android's document picker without requesting broad storage access.

Gopher itself remains plaintext and unauthenticated. The network security configuration prevents cleartext WebView navigation, but it cannot add encryption or identity to the native Gopher socket.

## Source-link exclusion

The public site intentionally retains its **Source** link. `npm run build:android:web` copies the site into `dist/android`, removes the one block delimited by `android-exclude:source`, and fails unless exactly one such block exists. It also fails if the resulting Android HTML still contains the link.

This is a build-time removal. The APK does not rely on CSS, runtime JavaScript or a WebView condition to hide the source link. Do not manually edit `dist/android` or `android/app/src/main/assets/public`; both are generated outputs.

## Prerequisites

Install:

- the maintained Node.js version required by the repository;
- JDK 21;
- Android SDK Platform 36;
- Android SDK Build Tools 36.0.0; and
- Android SDK Platform Tools.

Accept the Android SDK licenses and point Gradle at the SDK with either `ANDROID_HOME` or an untracked `android/local.properties` file:

```properties
sdk.dir=C\:\\Users\\you\\AppData\\Local\\Android\\Sdk
```

On Windows PowerShell, select JDK 21 for the current shell before invoking Gradle:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

Paths vary by machine. Do not commit `android/local.properties`.

## Synchronize and test

Install reviewed development dependencies and regenerate the native assets:

```bash
npm ci --ignore-scripts
npm run android:sync
```

`android:sync` first rebuilds `dist/android`, then runs `cap sync android`. Run it after every change under `site/`, `mobile/` or the Capacitor configuration.

Gradle resolves in strict lock mode. The reviewed lock state under `android/gradle/dependency-locks/`, together with `android/buildscript-gradle.lockfile`, covers every project configuration and every project buildscript classpath, including the generated Capacitor and Cordova bridge projects. The locking hook lives in the repository-owned `android/settings.gradle`; it does not patch generated files or dependencies below `node_modules`. A normal build fails if dependency resolution drifts from the checked-in files. When a reviewed dependency update is intentional, run the complete Android task set with `--write-locks`, inspect every changed coordinate and commit the generated lockfiles. Do not edit lock entries by hand.

Run the JavaScript bridge and packaging tests from the repository root:

```bash
node --test test/native-transport.test.mjs
node --test test/android-bundle.test.mjs
npm run check
```

Then run native unit tests, lint and a debug build:

```bash
cd android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

Use `.\gradlew.bat` on Windows. The installable debug APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`; it is development-signed and is not a production release artifact.

## Build and sign a release

For a new local release identity, set `JAVA_HOME` to JDK 21 and run once:

```bash
npm run android:signing:init
```

The command creates `.android-signing/dig-release.p12` and `.android-signing/release-signing.properties` with locally generated credentials. Both are gitignored, and the command refuses to replace either file. Back up the complete `.android-signing` directory to a secure, access-controlled location immediately: losing this key prevents direct updates to APKs already installed under `com.ejupilabs.dig`.

With that local identity present, produce the signed release:

```powershell
$env:DIG_SOURCE_COMMIT = git rev-parse HEAD
npm run android:apk
Remove-Item Env:DIG_SOURCE_COMMIT
```

The command synchronizes the Android assets, runs `testDebugUnitTest`, `lintRelease` and `assembleRelease`, then copies the signed APK and its SHA-256 file to:

```text
release/android/DIG-3.2.1.apk
release/android/DIG-3.2.1.apk.sha256
```

For CI or another controlled signing host, do not copy `release-signing.properties` into the repository. Provide all four values from the platform's secret store:

- `DIG_ANDROID_KEYSTORE_PATH`
- `DIG_ANDROID_KEYSTORE_PASSWORD`
- `DIG_ANDROID_KEY_ALIAS`
- `DIG_ANDROID_KEY_PASSWORD`

`DIG_ANDROID_KEYSTORE_PATH` must identify the provisioned keystore file on that host. The build fails closed when only part of the configuration is present or when the keystore cannot be read. Never echo these values, pass passwords as literal command arguments, include them in an artifact, or expose them in CI logs.

The GitHub Actions release workflow uses these repository secret names:

- `DIG_ANDROID_KEYSTORE_BASE64`: the complete PKCS#12 keystore encoded as one standard Base64 value.
- `DIG_ANDROID_KEYSTORE_PASSWORD`: the keystore password.
- `DIG_ANDROID_KEY_ALIAS`: the dedicated DIG release alias.
- `DIG_ANDROID_KEY_PASSWORD`: the private-key password.

The workflow decodes the keystore only into its temporary runner directory with mode `0600`, never
prints it and removes the temporary file in an `always()` cleanup step. A tag build and a manual
rehearsal with `expected_tag` both fail before Android compilation if any required secret is absent.
Normal pull-request and `main` checks do not receive or use signing secrets.

Configure the keystore without writing its Base64 representation to the terminal:

```powershell
$keystore = Resolve-Path '.android-signing\dig-release.p12'
[Convert]::ToBase64String([IO.File]::ReadAllBytes($keystore)) |
  gh secret set DIG_ANDROID_KEYSTORE_BASE64 --repo ejupi-djenis30/Dig
```

Set the remaining three secrets from the protected
`.android-signing/release-signing.properties` values through standard input as well. Do not place
their values in command history. GitHub exposes only secret names after configuration; values
cannot be read back.

Running Gradle's `assembleRelease` directly without either complete signing source may produce an unsigned APK, but `npm run android:apk` intentionally refuses to publish one.

## Verify the APK

Verify the signature, package metadata and permissions before distribution:

```powershell
$buildTools = Join-Path $env:ANDROID_HOME 'build-tools\36.0.0'
$apk = Resolve-Path 'release\android\DIG-3.2.1.apk'
& "$buildTools\apksigner.bat" verify --verbose --print-certs `
  $apk
& "$buildTools\aapt2.exe" dump badging `
  $apk
```

The expected package is `com.ejupilabs.dig`, the minimum SDK is 24, the target SDK is 36 and
`INTERNET` is the only app-requested Android permission. AndroidX also contributes the
signature-protected `com.ejupilabs.dig.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`; the release
verifier rejects any other permission. The accepted release certificate SHA-256 is
`15a35456cf92a58c39072bc0306df0843467f529daf361460c15d201a2705f87`;
`npm run android:apk` rejects any other signing identity.

Every signed APK also contains `assets/public/release-source.json`. The build writes the exact
40-character source commit into that file before Capacitor synchronization. The tag publication
job downloads the candidate, independently rechecks the APK with Android build-tools, compares the
embedded commit with the tag target and verifies the standalone and global checksum manifests
before requesting attestations or creating an immutable release.

Also rebuild the Android web bundle and run its exclusion test:

```bash
npm run build:android:web
node --test test/android-bundle.test.mjs
```

The public `site/index.html` must retain the source link, while `dist/android/index.html` must not contain its anchor or repository URL.
