import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

const select = mock.fn(async (_options: unknown): Promise<string> => "all");
const checkbox = mock.fn(async (_options: unknown): Promise<string[]> => []);
mock.module("@inquirer/prompts", { namedExports: { select, checkbox, confirm: async () => true } });
const { blocking, runPlan } = await import("../src/plan.ts");
const { settings } = await import("../src/ui.ts");
import type { Step } from "../src/plan.ts";

const calls: string[] = [];
const step = (id: string, overrides: Partial<Step> = {}): Step => ({
  id,
  title: `Step ${id}`,
  description: `About ${id}`,
  done: false,
  apply: async () => {
    calls.push(id);
    return true;
  },
  ...overrides,
});

let output: string[];
beforeEach(() => {
  calls.length = 0;
  output = [];
  settings.yes = false;
  select.mock.resetCalls();
  select.mock.mockImplementation(async () => "all");
  mock.method(console, "log", (...args: unknown[]) => output.push(args.join(" ")));
});
afterEach(() => mock.restoreAll());

test("blocking is what is missing and required, not what is optional or done", () => {
  const steps = [step("a"), step("b", { done: true }), step("c", { required: false })];
  assert.deepEqual(blocking(steps).map((s) => s.id), ["a"]);
});

test("when everything is done nothing is asked", async () => {
  const result = await runPlan("Plan", [step("a", { done: true, detail: "fine" })]);
  assert.deepEqual(result, { ok: true, applied: [], declined: false });
  assert.equal(select.mock.callCount(), 0);
});

test("the plan shows what is done and what is missing, with the description only for what is missing", async () => {
  await runPlan("Plan", [step("a", { done: true, detail: "fine" }), step("b")]);
  const text = output.join("\n");
  assert.match(text, /Step a.*fine/);
  assert.match(text, /Step b.*missing/);
  assert.match(text, /About b/);
  assert.doesNotMatch(text, /About a/);
});

test("saying yes applies every missing step in order", async () => {
  const result = await runPlan("Plan", [step("a"), step("b", { done: true }), step("c")]);
  assert.deepEqual(calls, ["a", "c"]);
  assert.deepEqual(result, { ok: true, applied: ["a", "c"], declined: false });
});

test("saying no changes nothing", async () => {
  select.mock.mockImplementation(async () => "none");
  const result = await runPlan("Plan", [step("a")]);
  assert.deepEqual(calls, []);
  assert.deepEqual(result, { ok: false, applied: [], declined: true });
});

test("the user can choose which steps to do, and then the plan is not complete", async () => {
  select.mock.mockImplementation(async () => "some");
  checkbox.mock.mockImplementation(async () => ["b"]);
  const result = await runPlan("Plan", [step("a"), step("b")]);
  assert.deepEqual(calls, ["b"]);
  assert.deepEqual(result, { ok: false, applied: ["b"], declined: false });
});

test("choosing nothing counts as saying no", async () => {
  select.mock.mockImplementation(async () => "some");
  checkbox.mock.mockImplementation(async () => []);
  assert.equal((await runPlan("Plan", [step("a"), step("b")])).declined, true);
});

test("a single missing step is not offered as a choice", async () => {
  await runPlan("Plan", [step("a")]);
  const options = select.mock.calls[0]!.arguments[0] as { message: string; choices: { value: string }[] };
  assert.deepEqual(options.choices.map((c) => c.value), ["all", "none"]);
  assert.match(options.message, /1 missing item now/);
});

test("without a terminal or with --yes the question is skipped and everything is done", async () => {
  settings.yes = true;
  const result = await runPlan("Plan", [step("a"), step("b")]);
  assert.equal(select.mock.callCount(), 0);
  assert.deepEqual(result.applied, ["a", "b"]);
});

test("the plan stops at the first step that fails", async () => {
  const result = await runPlan("Plan", [step("a", { apply: async () => false }), step("b")]);
  assert.deepEqual(calls, []);
  assert.deepEqual(result, { ok: false, applied: [], declined: false });
  assert.match(output.join("\n"), /Stopped, because this step failed/);
});
