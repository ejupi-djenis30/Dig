import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const signingDirectory = resolve(repositoryRoot, ".android-signing");
const keystorePath = resolve(signingDirectory, "dig-release.p12");
const propertiesPath = resolve(signingDirectory, "release-signing.properties");

function assertConfined(path) {
  const pathFromRoot = relative(repositoryRoot, path);
  if (
    pathFromRoot === ""
    || pathFromRoot === ".."
    || pathFromRoot.startsWith(`..${sep}`)
  ) {
    throw new Error(`Refusing to write outside the repository: ${path}`);
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(
        `keytool failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`
        + (errorOutput.trim() ? `: ${errorOutput.trim()}` : ""),
      ));
    });
  });
}

async function protectSigningDirectory() {
  if (process.platform !== "win32") {
    await chmod(signingDirectory, 0o700);
    return;
  }
  const account = [process.env.USERDOMAIN, process.env.USERNAME]
    .filter(Boolean)
    .join("\\");
  if (!account) {
    throw new Error("Could not identify the current Windows account for signing-file ACLs.");
  }
  const aclScript = `
$ErrorActionPreference = "Stop"
$path = $env:DIG_ANDROID_SIGNING_ACL_PATH
$owner = New-Object System.Security.Principal.NTAccount($env:DIG_ANDROID_SIGNING_ACCOUNT)
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($owner)
$inheritance = [System.Security.AccessControl.InheritanceFlags]"ContainerInherit, ObjectInherit"
$propagation = [System.Security.AccessControl.PropagationFlags]::None
$allow = [System.Security.AccessControl.AccessControlType]::Allow
foreach ($identity in @(
  $env:DIG_ANDROID_SIGNING_ACCOUNT,
  "NT AUTHORITY\\SYSTEM",
  "BUILTIN\\Administrators"
)) {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $identity,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance,
    $propagation,
    $allow
  )
  [void]$acl.AddAccessRule($rule)
}
[System.IO.Directory]::SetAccessControl($path, $acl)
`;
  await run("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    aclScript,
  ], {
    env: {
      ...process.env,
      DIG_ANDROID_SIGNING_ACCOUNT: account,
      DIG_ANDROID_SIGNING_ACL_PATH: signingDirectory,
    },
  });
}

assertConfined(signingDirectory);
assertConfined(keystorePath);
assertConfined(propertiesPath);

if (await exists(keystorePath) || await exists(propertiesPath)) {
  throw new Error(
    "Android release signing already exists. Refusing to replace the app's update identity.",
  );
}

const javaHome = process.env.JAVA_HOME;
if (!javaHome) {
  throw new Error("JAVA_HOME must point to JDK 21 before creating Android signing.");
}

const keytool = join(javaHome, "bin", process.platform === "win32" ? "keytool.exe" : "keytool");
if (!await exists(keytool)) {
  throw new Error(`keytool was not found under JAVA_HOME: ${keytool}`);
}

await mkdir(signingDirectory, { recursive: true, mode: 0o700 });
await protectSigningDirectory();

const password = randomBytes(36).toString("base64url");
const keyAlias = "dig-release";
const passwordEnvironment = {
  ...process.env,
  DIG_ANDROID_GENERATED_STORE_PASSWORD: password,
  DIG_ANDROID_GENERATED_KEY_PASSWORD: password,
};

await run(keytool, [
  "-genkeypair",
  "-keystore",
  keystorePath,
  "-storetype",
  "PKCS12",
  "-storepass:env",
  "DIG_ANDROID_GENERATED_STORE_PASSWORD",
  "-keypass:env",
  "DIG_ANDROID_GENERATED_KEY_PASSWORD",
  "-alias",
  keyAlias,
  "-keyalg",
  "RSA",
  "-keysize",
  "3072",
  "-sigalg",
  "SHA256withRSA",
  "-validity",
  "10000",
  "-dname",
  "CN=DIG, OU=Mobile, O=Ejupi Labs, L=Zurich, C=CH",
], { env: passwordEnvironment });

const storeFile = relative(resolve(repositoryRoot, "android", "app"), keystorePath)
  .split(sep)
  .join("/");
const properties = [
  `storeFile=${storeFile}`,
  `storePassword=${password}`,
  `keyAlias=${keyAlias}`,
  `keyPassword=${password}`,
  "",
].join("\n");

await writeFile(propertiesPath, properties, { encoding: "utf8", mode: 0o600, flag: "wx" });
await chmod(propertiesPath, 0o600);
await protectSigningDirectory();

console.log(`Created Android release signing in ${signingDirectory}`);
console.log("Back up both files securely. Losing this key prevents updates to directly distributed APKs.");
