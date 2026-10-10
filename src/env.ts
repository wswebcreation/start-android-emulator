import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { IS_WIN } from "./shell.ts";

const DEFAULT_BLOCK = "start-android-emulator";

export interface EnvChanges {
  vars?: Record<string, string>;
  paths?: string[];
}

export function shellProfile(): string {
  return basename(process.env.SHELL || "") === "zsh" || process.platform === "darwin"
    ? join(homedir(), ".zshrc")
    : join(homedir(), ".bashrc");
}

/** Make the variables available to the current process, and to child processes. */
export function applyToProcess({ vars = {}, paths = [] }: EnvChanges): void {
  Object.assign(process.env, vars);
  const current = (process.env.PATH || "").split(delimiter);
  const missing = paths.filter((p) => !current.includes(p));
  if (missing.length) process.env.PATH = [...current, ...missing].join(delimiter);
}

const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * Persist variables and PATH entries for future terminals.
 * macOS/Linux: one managed block in the shell profile, rewritten on every run (no duplicates).
 * Windows: user-level environment variables via PowerShell.
 * Each `block` name has its own block, so separate setup steps do not overwrite each other.
 * Returns where it was written.
 */
export function persistEnv({ vars = {}, paths = [], block: name = DEFAULT_BLOCK }: EnvChanges & { block?: string }): string {
  if (IS_WIN) {
    const script = [
      ...Object.entries(vars).map(([k, v]) => `[Environment]::SetEnvironmentVariable(${psQuote(k)}, ${psQuote(v)}, 'User')`),
      '$p = [Environment]::GetEnvironmentVariable("PATH", "User")',
      ...paths.map((p) => `if ($p -notlike ${psQuote(`*${p}*`)}) { $p = "$p;" + ${psQuote(p)} }`),
      '[Environment]::SetEnvironmentVariable("PATH", $p, "User")',
    ].join("; ");
    execFileSync("powershell", ["-NoProfile", "-Command", script], { stdio: "pipe" });
    return "your user environment variables";
  }

  const profile = shellProfile();
  const START = `# >>> ${name} >>>`;
  const END = `# <<< ${name} <<<`;
  const block = [
    START,
    ...Object.entries(vars).map(([k, v]) => `export ${k}="${v}"`),
    ...paths.map((p) => `export PATH="$PATH:${p}"`),
    END,
  ].join("\n");

  const existing = existsSync(profile) ? readFileSync(profile, "utf8") : "";
  const pattern = new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`);
  const next = pattern.test(existing)
    ? existing.replace(pattern, `\n${block}\n`)
    : `${existing}${existing.endsWith("\n") || !existing ? "" : "\n"}\n${block}\n`;
  writeFileSync(profile, next);
  return profile;
}
