import { confirm } from "@inquirer/prompts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

export const say = (msg = "") => console.log(msg);

export const ok = (msg: string) => say(`  ${GREEN}✔${RESET}  ${msg}`);
export const fail = (msg: string) => say(`  ${RED}✘${RESET}  ${msg}`);
export const warn = (msg: string) => say(`  ${YELLOW}⚠${RESET}  ${msg}`);
export const todo = (msg: string) => say(`  ${YELLOW}○${RESET}  ${msg}`);
export const info = (msg: string) => say(`     ${DIM}${msg}${RESET}`);
export const header = (msg: string) => say(`\n${BOLD}${CYAN}${msg}${RESET}`);
export const bold = (msg: string) => `${BOLD}${msg}${RESET}`;
export const green = (msg: string) => `${GREEN}${msg}${RESET}`;
export const red = (msg: string) => `${RED}${msg}${RESET}`;
export const yellow = (msg: string) => `${YELLOW}${msg}${RESET}`;
export const cyan = (msg: string) => `${CYAN}${msg}${RESET}`;
export const dim = (msg: string) => `${DIM}${msg}${RESET}`;

/** Set by the CLI from the flags. Without a terminal nobody can answer, so the defaults are taken. */
export const settings = {
  yes: !process.stdin.isTTY,
  dryRun: false,
};

/** Ask a yes/no question. With --yes (or no TTY) the default answer is taken. */
export async function ask(message: string, defaultValue = true): Promise<boolean> {
  if (settings.yes) return defaultValue;
  return confirm({ message, default: defaultValue });
}
