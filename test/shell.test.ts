import assert from "node:assert/strict";
import { test } from "node:test";
import { run, runFile } from "../src/shell.ts";

test("run returns the trimmed output, or null when the command fails", () => {
  assert.equal(run(`"${process.execPath}" -p "1+1"`), "2");
  assert.equal(run("this-command-does-not-exist-123"), null);
});

test("runFile returns output and exit code, and passes input to stdin", () => {
  const ok = runFile(process.execPath, ["-p", "'hi'"]);
  assert.deepEqual(ok, { output: "hi", exitCode: 0 });

  const echo = runFile(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { input: "from stdin" });
  assert.equal(echo.output, "from stdin");

  assert.equal(runFile(process.execPath, ["-e", "process.exit(3)"]).exitCode, 3);
});

test("runFile reports a missing executable as a failure", () => {
  assert.equal(runFile("/does/not/exist").exitCode, 1);
});
