import { randomBytes } from "node:crypto";
import {
  link,
  lstat,
  open,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

async function ensureOutputDirectory(directory) {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory()) {
    throw new Error(`The output parent is not a directory: ${directory}`);
  }
}

/**
 * Publish complete bytes from a same-directory temporary file.
 *
 * Without force, a hard-link operation makes the final name visible atomically
 * and fails if it already exists. With force, rename replaces the old name.
 */
export async function writeFileAtomic(path, data, options = {}) {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("--output requires a file path.");
  }
  const target = resolve(path);
  const directory = dirname(target);
  await ensureOutputDirectory(directory);
  const suffix = randomBytes(8).toString("hex");
  const temporary = join(
    directory,
    `.${basename(target)}.${process.pid}.${suffix}.tmp`,
  );
  let handle;
  let temporaryExists = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    temporaryExists = true;
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;

    if (options.force === true) {
      await rename(temporary, target);
    } else {
      try {
        await link(temporary, target);
      } catch (error) {
        if (error?.code === "EEXIST") {
          throw new Error(
            `Refusing to overwrite ${target}. Use --force to replace it.`,
          );
        }
        throw error;
      }
      await unlink(temporary);
    }
    temporaryExists = false;
    return target;
  } finally {
    await handle?.close().catch(() => {});
    if (temporaryExists) await unlink(temporary).catch(() => {});
  }
}
