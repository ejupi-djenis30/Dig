import { Buffer } from "node:buffer";

export function compareReleaseAssetNames(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
