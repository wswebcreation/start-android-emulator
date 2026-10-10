import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** What we remember between runs. */
export interface Config {
  lastEmulator?: string;
  /** false when the user does not want the DNS server override */
  dns?: false | string;
}

export function configFile(): string {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "start-android-emulator", "config.json");
}

/** A missing or broken file is the same as an empty one. */
export function readConfig(): Config {
  try {
    const data: unknown = JSON.parse(readFileSync(configFile(), "utf8"));
    if (typeof data !== "object" || data === null) return {};
    const { lastEmulator, dns } = data as Record<string, unknown>;
    return {
      ...(typeof lastEmulator === "string" ? { lastEmulator } : {}),
      ...(dns === false || typeof dns === "string" ? { dns } : {}),
    };
  } catch {
    return {};
  }
}

/** Merge changes into the saved settings, a key set to undefined is removed. Never throws: not being able to remember is not worth a failed run. */
export function writeConfig(changes: Partial<Config>): void {
  try {
    const next: Record<string, unknown> = { ...readConfig(), ...changes };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    const file = configFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  } catch {
    // read-only home folder or similar, we just do not remember
  }
}
