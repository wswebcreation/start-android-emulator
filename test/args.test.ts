import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageError, hasStartOptions, parseOptions } from "../src/args.ts";

test("without arguments everything is off, and we wait for the boot", () => {
  assert.deepEqual(parseOptions([]), {
    emulator: undefined,
    wipeData: false,
    coldBoot: false,
    verbose: false,
    dns: undefined,
    wait: true,
    setup: undefined,
    check: false,
    yes: false,
    dryRun: false,
    api: undefined,
    create: [],
    device: undefined,
    skin: undefined,
    help: false,
    version: false,
  });
});

test("an emulator name and the start options", () => {
  const o = parseOptions(["Pixel_9_API_37_0", "--wipe-data", "--cold-boot", "--verbose", "--no-wait"]);
  assert.equal(o.emulator, "Pixel_9_API_37_0");
  assert.deepEqual([o.wipeData, o.coldBoot, o.verbose, o.wait], [true, true, true, false]);
});

test("the DNS server can be set, or switched off", () => {
  assert.equal(parseOptions(["--dns", "1.1.1.1"]).dns, "1.1.1.1");
  assert.equal(parseOptions(["--dns", "2001:4860:4860::8888"]).dns, "2001:4860:4860::8888");
  assert.equal(parseOptions(["--no-dns"]).dns, false);
  assert.equal(parseOptions([]).dns, undefined);
});

test("setup is forced with --setup, forbidden with --no-setup, and left to the program otherwise", () => {
  assert.equal(parseOptions(["--setup"]).setup, true);
  assert.equal(parseOptions(["--no-setup"]).setup, false);
  assert.equal(parseOptions([]).setup, undefined);
});

test("the short flags and the setup options", () => {
  const o = parseOptions(["-y", "--api", "36", "--dry-run", "--check"]);
  assert.deepEqual([o.yes, o.api, o.dryRun, o.check], [true, "36", true, true]);
  assert.equal(parseOptions(["-h"]).help, true);
  assert.equal(parseOptions(["-v"]).version, true);
});

test("mistakes in the command are explained", () => {
  assert.throws(() => parseOptions(["--nope"]), (e) => e instanceof UsageError && /--nope[\s\S]*--help/.test(e.message));
  assert.throws(() => parseOptions(["--dns"]), UsageError);
  assert.throws(() => parseOptions(["a", "b"]), /Only one emulator.*a, b/);
  assert.throws(() => parseOptions(["--dns", "1.1.1.1", "--no-dns"]), /either --dns <ip> or --no-dns/);
  assert.throws(() => parseOptions(["--dns", "google"]), /"google" is not an IP address/);
  assert.throws(() => parseOptions(["Pixel", "--create", "A"]), /--create sets up emulators/);
  assert.throws(() => parseOptions(["--create", "a b"]), /"a b" is not a valid emulator name/);
  assert.throws(() => parseOptions(["--skin", "pixel_10"]), /add --create/);
});

test("emulators to create can be repeated, with a device and a skin", () => {
  const o = parseOptions(["--create", "A_{api}", "--create", "B_{api}", "--device", "pixel_9", "--skin", "pixel_10"]);
  assert.deepEqual([o.create, o.device, o.skin], [["A_{api}", "B_{api}"], "pixel_9", "pixel_10"]);
});

test("any option about how to start means we do not ask about it", () => {
  assert.equal(hasStartOptions(parseOptions([])), false);
  for (const flag of [["--wipe-data"], ["--cold-boot"], ["--verbose"], ["--no-dns"], ["--dns", "1.1.1.1"]]) {
    assert.equal(hasStartOptions(parseOptions(flag)), true, flag.join(" "));
  }
  assert.equal(hasStartOptions(parseOptions(["--no-wait", "--api", "36"])), false);
});
