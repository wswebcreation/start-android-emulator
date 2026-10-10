import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";

const runFile = mock.fn((file: string, _args: string[]) => ({ output: "", exitCode: file === "tar" ? 1 : 0 }));
mock.module("../src/shell.ts", { namedExports: { IS_WIN: true, IS_MAC: false, runFile } });
const { extractArchive } = await import("../src/download.ts");

const dir = mkdtempSync(join(tmpdir(), "start-android-emulator-extract-win-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test("on Windows the fallback for a .zip is PowerShell, with quotes escaped", async () => {
  await extractArchive("C:\\Users\\O'Neil\\tools.zip", join(dir, "out"));
  const [file, args] = runFile.mock.calls[1]!.arguments as [string, string[]];
  assert.equal(file, "powershell");
  assert.match(args[2]!, /Expand-Archive -LiteralPath 'C:\\Users\\O''Neil\\tools\.zip'/);
});
