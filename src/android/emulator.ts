import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFile } from "../shell.ts";
import { emulatorBinary } from "./sdk.ts";

/** The emulator often has no wifi without it. */
export const DEFAULT_DNS = "8.8.8.8";

export interface StartOptions {
  name: string;
  wipeData: boolean;
  coldBoot: boolean;
  /** The DNS server, false to use the one of the computer */
  dns: string | false;
}

export function emulatorArgs({ name, wipeData, coldBoot, dns }: StartOptions): string[] {
  return [
    "-avd", name,
    ...(wipeData ? ["-wipe-data"] : []),
    ...(coldBoot ? ["-no-snapshot"] : []),
    ...(dns ? ["-dns-server", dns] : []),
  ];
}

export interface RunningEmulator {
  serial: string;
  booted: boolean;
}

/** The emulator that runs this AVD, found through adb. Null when it is not running. */
export function findRunning(adb: string, avd: string): RunningEmulator | null {
  const devices = runFile(adb, ["devices"]).output;
  for (const [, serial = ""] of devices.matchAll(/^(emulator-\d+)\s+\S+/gm)) {
    // "emu avd name" prints the name on the first line, followed by OK
    const name = runFile(adb, ["-s", serial, "emu", "avd", "name"]).output.split(/\r?\n/)[0]?.trim();
    if (name !== avd) continue;
    const booted = runFile(adb, ["-s", serial, "shell", "getprop", "sys.boot_completed"]).output.trim() === "1";
    return { serial, booted };
  }
  return null;
}

export interface Launched {
  child: ChildProcess;
  logFile: string;
  /** Set when the emulator program stops, with its exit code (or the error that stopped it from starting) */
  exited: { code: number | null; error?: string } | null;
}

/**
 * Start the emulator so that it keeps running after we are gone. Its output goes to a file, not to a pipe:
 * a pipe that nobody reads or that is closed can stop the emulator.
 */
export function launchEmulator(sdk: string, options: StartOptions): Launched {
  const emulator = emulatorBinary(sdk);
  if (!emulator) throw new Error(`The emulator is not installed in ${sdk}`);

  const logFile = join(tmpdir(), `start-android-emulator-${options.name}.log`);
  const log = openSync(logFile, "w");
  let child: ChildProcess;
  try {
    child = spawn(emulator, emulatorArgs(options), {
      detached: true,
      stdio: ["ignore", log, log],
      windowsHide: true,
      env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk },
    });
  } finally {
    closeSync(log);
  }
  const launched: Launched = { child, logFile, exited: null };
  child.on("error", (e) => (launched.exited = { code: null, error: e.message }));
  child.on("exit", (code) => (launched.exited = { code }));
  child.unref();
  return launched;
}

export const lastLines = (file: string, count = 15): string => {
  try {
    return readFileSync(file, "utf8").trim().split(/\r?\n/).slice(-count).join("\n");
  } catch {
    return "";
  }
};

/** Print what the emulator writes to its log file, as it comes. Returns a function that stops it. */
export function followLog(file: string, write: (text: string) => void, interval = 500): () => void {
  let offset = 0;
  const timer = setInterval(() => {
    try {
      if (!existsSync(file) || statSync(file).size <= offset) return;
      const text = readFileSync(file, "utf8");
      write(text.slice(offset));
      offset = text.length;
    } catch {
      // the file is being written, try again next time
    }
  }, interval);
  timer.unref();
  return () => clearInterval(timer);
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Replaced in tests, so they do not really wait */
  sleep?: (ms: number) => Promise<void>;
}

/** Wait until the emulator of this AVD has finished booting (sys.boot_completed), or fail with what went wrong. */
export async function waitForBoot(
  adb: string,
  avd: string,
  launched: Pick<Launched, "logFile" | "exited">,
  { timeoutMs = 5 * 60_000, intervalMs = 2000, sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms)) }: WaitOptions = {},
): Promise<RunningEmulator> {
  for (let waited = 0; waited <= timeoutMs; waited += intervalMs) {
    if (launched.exited) {
      const { code, error } = launched.exited;
      const why = error ?? `exit code ${code}`;
      const tail = lastLines(launched.logFile);
      throw new Error(`The emulator stopped before it was ready (${why}).${tail ? `\n\n${tail}` : ""}\n\nThe full log is in ${launched.logFile}`);
    }
    const running = findRunning(adb, avd);
    if (running?.booted) return running;
    await sleep(intervalMs);
  }
  throw new Error(`${avd} did not finish booting within ${Math.round(timeoutMs / 60_000)} minutes. The log is in ${launched.logFile}`);
}
