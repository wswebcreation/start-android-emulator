import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

const select = mock.fn(async (_options: unknown): Promise<string> => "all");
mock.module("@inquirer/prompts", { namedExports: { select, checkbox: async () => [], confirm: async () => true, input: async () => "" } });
const api = await import("../src/index.ts");
const { settings } = await import("../src/ui.ts");
import type { Step } from "../src/index.ts";

afterEach(() => {
  mock.restoreAll();
  select.mock.resetCalls();
});

test("the index exports what a consumer needs to build and run its own plan", () => {
  for (const name of ["planAndroid", "runPlan", "dry", "configure", "persistEnv", "applyToProcess", "relaunchWithProxy", "launchEmulator", "waitForBoot", "findRunning", "adbBinary", "namedTarget", "inspect", "main"]) {
    assert.equal(typeof (api as Record<string, unknown>)[name], "function", name);
  }
});

test("configure changes only the options that are passed", () => {
  api.configure({ yes: true, dryRun: true });
  assert.deepEqual({ ...settings }, { yes: true, dryRun: true });
  api.configure({ yes: false });
  assert.deepEqual({ ...settings }, { yes: false, dryRun: true });
  api.configure({ dryRun: false });
  assert.equal(settings.dryRun, false);
});

test("configure({ yes }) decides whether runPlan asks", async () => {
  mock.method(console, "log", () => {});
  const step: Step = { id: "x", title: "X", description: "x", done: false, action: "do x", apply: async () => true };

  api.configure({ yes: true });
  assert.equal((await api.runPlan("Plan", [step])).ok, true);
  assert.equal(select.mock.callCount(), 0);

  api.configure({ yes: false });
  assert.equal((await api.runPlan("Plan", [step])).ok, true);
  assert.equal(select.mock.callCount(), 1);
});

test("configure({ dryRun }) is what a step sees when it is applied", async () => {
  mock.method(console, "log", () => {});
  const seen: boolean[] = [];
  const step: Step = { id: "x", title: "X", description: "x", done: false, apply: async () => (seen.push(settings.dryRun), true) };
  api.configure({ yes: true, dryRun: true });
  await api.runPlan("Plan", [step]);
  api.configure({ dryRun: false });
  await api.runPlan("Plan", [step]);
  assert.deepEqual(seen, [true, false]);
});
