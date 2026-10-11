import { execSync, spawn, spawnSync } from "node:child_process";
import { platform } from "node:os";

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

/** Run a command line and return its output, or null when it fails. */
export function run(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    return execSync(cmd, { stdio: "pipe", encoding: "utf8", env }).trim();
  } catch {
    return null;
  }
}

/**
 * Run an executable with arguments (no shell quoting issues for paths with spaces).
 * On Windows the SDK tools are .bat files, so they need a shell.
 */
export function runFile(file: string, args: string[] = [], { env = process.env, input, inherit = false, timeout }: RunFileOptions = {}): RunResult {
  const result = spawnSync(IS_WIN ? `"${file}"` : file, args, {
    encoding: "utf8",
    env,
    input,
    timeout,
    shell: IS_WIN,
    stdio: inherit ? ["pipe", "inherit", "inherit"] : "pipe",
  });
  const output = ((result.stdout || "") + (result.stderr || "")).trim();
  return { output, exitCode: result.status ?? 1 };
}

/**
 * Like runFile, but the program runs next to us instead of in front of us, so a spinner keeps turning while we wait.
 * Always resolves: a program that cannot start is a failed run with the reason as its output.
 */
export function runFileAsync(file: string, args: string[] = [], { env = process.env, input, timeout }: Omit<RunFileOptions, "inherit"> = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(IS_WIN ? `"${file}"` : file, args, { env, shell: IS_WIN, timeout, stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => resolve({ output: error.message, exitCode: 1 }));
    child.on("close", (code) => resolve({ output: output.trim(), exitCode: code ?? 1 }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
