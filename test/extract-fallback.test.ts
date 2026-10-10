import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";

type Call = [string, string[]];

const runFile = mock.fn((file: string, _args: string[]) => ({ output: "", exitCode: file === "tar" ? 1 : 0 }));
mock.module("../src/shell.ts", { namedExports: { IS_WIN: false, IS_MAC: false, runFile } });
const { extractArchive } = await import("../src/download.ts");

const dir = mkdtempSync(join(tmpdir(), "start-android-emulator-extract-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const calls = () => runFile.mock.calls.map((c) => c.arguments as Call);

test("a .zip that tar cannot read is unpacked with unzip", async () => {
  runFile.mock.resetCalls();
  await extractArchive("/a/tools.zip", join(dir, "out1"));
  assert.deepEqual(calls().map(([file]) => file), ["tar", "unzip"]);
  assert.deepEqual(calls()[1]![1], ["-q", "-o", "/a/tools.zip", "-d", join(dir, "out1")]);
});

test("a .tar.gz that tar cannot read is an error, there is no fallback", async () => {
  runFile.mock.resetCalls();
  await assert.rejects(extractArchive("/a/jdk.tar.gz", join(dir, "out3")), /Could not extract \/a\/jdk\.tar\.gz/);
  assert.deepEqual(calls().map(([file]) => file), ["tar"]);
});

test("when the fallback fails too, the error says so", async () => {
  runFile.mock.resetCalls();
  runFile.mock.mockImplementationOnce(() => ({ output: "tar: bad", exitCode: 1 }), 0);
  runFile.mock.mockImplementationOnce(() => ({ output: "unzip: command not found", exitCode: 127 }), 1);
  await assert.rejects(extractArchive("/a/tools.zip", join(dir, "out4")), /unzip: command not found/);
});
