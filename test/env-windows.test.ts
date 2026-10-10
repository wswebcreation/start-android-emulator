import assert from "node:assert/strict";
import { mock, test } from "node:test";

const execFileSync = mock.fn();
mock.module("node:child_process", { namedExports: { execFileSync } });
mock.module("../src/shell.ts", { namedExports: { IS_WIN: true } });
const { persistEnv } = await import("../src/env.ts");

test("on Windows the variables are saved as user environment variables through PowerShell", () => {
  const where = persistEnv({ vars: { ANDROID_HOME: "C:\\Android\\Sdk" }, paths: ["C:\\Android\\Sdk\\platform-tools"] });

  assert.equal(where, "your user environment variables");
  const [file, args] = execFileSync.mock.calls[0]!.arguments as [string, string[]];
  assert.equal(file, "powershell");
  assert.deepEqual(args.slice(0, 2), ["-NoProfile", "-Command"]);
  assert.match(args[2]!, /SetEnvironmentVariable\('ANDROID_HOME', 'C:\\Android\\Sdk', 'User'\)/);
  assert.match(args[2]!, /notlike '\*C:\\Android\\Sdk\\platform-tools\*'/, "a PATH entry is only added when it is not there yet");
});

test("a quote in a value cannot break out of the PowerShell string", () => {
  persistEnv({ vars: { JAVA_HOME: "C:\\Users\\O'Neil\\jdk" } });

  const [, args] = execFileSync.mock.calls.at(-1)!.arguments as [string, string[]];
  assert.match(args[2]!, /SetEnvironmentVariable\('JAVA_HOME', 'C:\\Users\\O''Neil\\jdk', 'User'\)/);
});
