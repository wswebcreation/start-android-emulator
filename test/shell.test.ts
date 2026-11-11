import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteWinArg, run, runFile, runFileAsync, spawnTarget, winCommandLine } from "../src/shell.ts";

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

test("runFileAsync gives the same answers without blocking, and never rejects", async () => {
  assert.deepEqual(await runFileAsync(process.execPath, ["-p", "'hi'"]), { output: "hi", exitCode: 0 });
  assert.equal((await runFileAsync(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { input: "from stdin" })).output, "from stdin");
  assert.equal((await runFileAsync(process.execPath, ["-e", "process.exit(3)"])).exitCode, 3);
  assert.equal((await runFileAsync("/does/not/exist")).exitCode, 1);

  // The event loop keeps running while the program does: a timer fires before a 300 ms program is done
  let ticked = false;
  const timer = setTimeout(() => (ticked = true), 50);
  await runFileAsync(process.execPath, ["-e", "setTimeout(() => {}, 300)"]);
  clearTimeout(timer);
  assert.equal(ticked, true);
});

test("quoteWinArg leaves plain arguments alone and quotes what cmd.exe would split or interpret", () => {
  assert.equal(quoteWinArg("--install"), "--install");
  assert.equal(quoteWinArg("platform-tools"), "platform-tools");
  assert.equal(quoteWinArg("system-images;android-37.0;google_apis;x86_64"), '"system-images;android-37.0;google_apis;x86_64"');
  assert.equal(quoteWinArg("C:\\Users\\Jan Jansen\\Sdk"), '"C:\\Users\\Jan Jansen\\Sdk"');
  assert.equal(quoteWinArg("--sdk_root=C:\\Sdk"), '"--sdk_root=C:\\Sdk"');
  for (const ch of ["&", "^", "|", "<", ">", "%", "(", ")", ","]) assert.equal(quoteWinArg(`a${ch}b`), `"a${ch}b"`);
  assert.equal(quoteWinArg(""), '""');
});

test("quoteWinArg doubles an embedded double quote", () => {
  assert.equal(quoteWinArg('say "hi"'), '"say ""hi"""');
  assert.equal(quoteWinArg('a"b'), '"a""b"');
});

test("winCommandLine always quotes the program and quotes arguments when needed", () => {
  assert.equal(
    winCommandLine("C:\\Android Sdk\\sdkmanager.bat", ["--install", "system-images;android-37.0;google_apis;x86_64"]),
    '"C:\\Android Sdk\\sdkmanager.bat" --install "system-images;android-37.0;google_apis;x86_64"',
  );
});

test("spawnTarget runs the program directly outside Windows and through cmd.exe /d /s /c on Windows", () => {
  assert.deepEqual(spawnTarget("/sdk/avdmanager", ["-k", "a;b"], false), { command: "/sdk/avdmanager", args: ["-k", "a;b"] });
  const win = spawnTarget("C:\\sdk\\avdmanager.bat", ["create", "-k", "system-images;x"], true);
  assert.deepEqual(win.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(win.args[3], '""C:\\sdk\\avdmanager.bat" create -k "system-images;x""');
  assert.equal(win.windowsVerbatimArguments, true);
});
