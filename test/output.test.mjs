import assert from "node:assert/strict";
import test from "node:test";
import { safeTerminalText } from "../src/output.mjs";

test("renders terminal control sequences as inert text", () => {
  assert.equal(
    safeTerminalText("safe\u001b[2J\u0007\rrewrite\r\nnext"),
    "safe\\x1b[2J\\x07\\rrewrite\nnext",
  );
});
