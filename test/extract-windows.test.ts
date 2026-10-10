import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";

const runFile = mock.fn((file: string, _args: string[]) => ({ output: "", exitCode: file === "tar" ? 1 : 0 }));
const calls = () => runFile.mock.calls.map((c) => c.arguments as [string, string[]]);
mock.module("../src/shell.ts", { namedExports: { IS_WIN: true, IS_MAC: false, runFile } });
const { extractArchive } = await import("../src/download.ts");

const dir = mkdtempSync(join(tmpdir(), "start-android-emulator-extract-win-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test("on Windows the fallback for a .zip is PowerShell, with quotes escaped", async () => {
  await extractArchive("C:\\Users\\O'Neil\\tools.zip", join(dir, "out"));
  const [file, args] = calls().at(-1)!;
  assert.equal(file, "powershell");
  assert.match(args[2]!, /Expand-Archive -LiteralPath 'C:\\Users\\O''Neil\\tools\.zip'/);
});

test("on Windows a tar that takes C: for a remote host is retried with --force-local", async () => {
  runFile.mock.resetCalls();
  runFile.mock.mockImplementationOnce(() => ({ output: "tar: Cannot connect to C: resolve failed", exitCode: 2 }), 0);
  runFile.mock.mockImplementationOnce(() => ({ output: "", exitCode: 0 }), 1);

  await extractArchive("C:\\sdk\\skins\\pixel_9.tar.gz", join(dir, "skin"));

  assert.deepEqual(calls().map(([file]) => file), ["tar", "tar"]);
  assert.deepEqual(calls()[1]![1].slice(0, 2), ["--force-local", "-xf"]);
});
