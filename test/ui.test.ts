import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { bold, fail, info, ok, startSpinner, todo, warn } from "../src/ui.ts";

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
let lines: string[];
beforeEach(() => {
  lines = [];
  mock.method(console, "log", (...args: unknown[]) => lines.push(plain(args.join(" "))));
});
afterEach(() => mock.restoreAll());

test("a symbol, a space and the text, flush left like the questions", () => {
  ok("fine");
  fail("broken");
  warn("careful");
  todo("missing");
  assert.deepEqual(lines, ["✔ fine", "✘ broken", "⚠ careful", "○ missing"]);
});

test("what belongs to a line is indented under its text", () => {
  info("more about it");
  assert.deepEqual(lines, ["  more about it"]);
  assert.equal(plain(bold("x")), "x");
});

const fakeTerminal = (isTTY: boolean) => {
  const written: string[] = [];
  return { stream: { isTTY, write: (text: string) => written.push(text) } as unknown as NodeJS.WriteStream, written };
};

test("the spinner redraws one line, and clears it when it stops so the next line starts clean", async () => {
  const { stream, written } = fakeTerminal(true);
  const stop = startSpinner("Waiting...", stream);
  await new Promise((resolve) => setTimeout(resolve, 250));
  stop();

  const drawn = written.slice(0, -1).map(plain);
  assert.ok(drawn.length >= 2, "it is redrawn");
  assert.ok(drawn.every((text) => /^\r[\u2800-\u28ff] Waiting\.\.\. \d+s$/.test(text)), drawn[0]);
  assert.equal(written.at(-1), "\r\x1b[2K", "the line is cleared at the end");
  assert.equal(lines.length, 0, "nothing was printed as a line");
});

test("without a terminal the spinner prints its text once and does not draw", () => {
  const { stream, written } = fakeTerminal(false);
  const stop = startSpinner("Waiting...", stream);
  stop();
  assert.deepEqual(lines, ["  Waiting..."]);
  assert.equal(written.length, 0);
});
