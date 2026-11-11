import { execSync, spawn, spawnSync } from "node:child_process";
import { platform } from "node:os";
import { debug } from "./ui.ts";

export const IS_MAC = platform() === "darwin";
export const IS_WIN = platform() === "win32";

export interface RunResult {
  output: string;
  exitCode: number;
}

export interface RunFileOptions {
  env?: NodeJS.ProcessEnv;
  /** Written to stdin, for tools that ask questions */
  input?: string;
  /** Show the output in the terminal instead of capturing it */
  inherit?: boolean;
  timeout?: number;
}

const NEEDS_QUOTES = /[\s;&^|<>%(),="]/;

/**
 * Quote one argument for cmd.exe. Plain arguments stay as they are. Anything cmd.exe or the batch file would split or
 * interpret (";" in "system-images;android-37.0;google_apis;x86_64", "&", spaces, ...) goes between double quotes, with an
 * embedded " doubled, which is how both cmd.exe and the C runtime read a quote inside a quoted argument.
 */
export function quoteWinArg(arg: string): string {
  if (arg !== "" && !NEEDS_QUOTES.test(arg)) return arg;
  return `"${arg.replaceAll('"', '""')}"`;
}

/** The command line for `cmd.exe /d /s /c`: the program is always quoted (paths with spaces), the arguments when needed. */
export function winCommandLine(file: string, args: string[]): string {
  return [`"${file}"`, ...args.map(quoteWinArg)].join(" ");
}

/**
 * How to start a program. The SDK tools are .bat files on Windows, so they run through cmd.exe. We build the command line
 * ourselves and pass it verbatim: with `shell: true` Node only joins the arguments with spaces (no quoting, and DEP0190).
 * The outer quotes are removed again by /s.
 */
export function spawnTarget(file: string, args: string[], win = IS_WIN): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (!win) return { command: file, args };
  return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${winCommandLine(file, args)}"`], windowsVerbatimArguments: true };
}

/** Run a command line and return its output, or null when it fails. */
export function run(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const output = execSync(cmd, { stdio: "pipe", encoding: "utf8", env }).trim();
    debug(`$ ${cmd}\n${output}`);
    return output;
  } catch (e) {
    debug(`$ ${cmd}\nfailed: ${(e as Error).message.trim()}`);
    return null;
  }
}

/**
 * Run an executable with arguments (no shell quoting issues for paths with spaces).
 * On Windows the SDK tools are .bat files, so they run through cmd.exe, see spawnTarget.
 */
export function runFile(file: string, args: string[] = [], { env = process.env, input, inherit = false, timeout }: RunFileOptions = {}): RunResult {
  const target = spawnTarget(file, args);
  const started = Date.now();
  const result = spawnSync(target.command, target.args, {
    windowsVerbatimArguments: target.windowsVerbatimArguments,
    encoding: "utf8",
    env,
    input,
    timeout,
    stdio: inherit ? ["pipe", "inherit", "inherit"] : "pipe",
  });
  // A program that cannot start has no output, only an error: keep the reason so a failure is never silent
  const output = ((result.stdout || "") + (result.stderr || "") || (result.error ? result.error.message : "")).trim();
  debugRun(file, args, output, result.status ?? 1, started, inherit);
  return { output, exitCode: result.status ?? 1 };
}

/** The debug log of one program run: what we started, how it ended, and what it said. */
function debugRun(file: string, args: string[], output: string, exitCode: number, started: number, inherit = false): void {
  debug(`$ ${[file, ...args].join(" ")}\nexit code ${exitCode} after ${Date.now() - started} ms${inherit ? ", its output was shown above" : output ? `\n${output}` : ", no output"}`);
}

/**
 * Like runFile, but the program runs next to us instead of in front of us, so a spinner keeps turning while we wait.
 * Always resolves: a program that cannot start is a failed run with the reason as its output.
 */
export function runFileAsync(file: string, args: string[] = [], { env = process.env, input, timeout }: Omit<RunFileOptions, "inherit"> = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    let output = "";
    const started = Date.now();
    const done = (result: RunResult) => {
      debugRun(file, args, result.output, result.exitCode, started);
      resolve(result);
    };
    const target = spawnTarget(file, args);
    const child = spawn(target.command, target.args, { env, windowsVerbatimArguments: target.windowsVerbatimArguments, timeout, stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => done({ output: error.message, exitCode: 1 }));
    child.on("close", (code) => done({ output: output.trim(), exitCode: code ?? 1 }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
