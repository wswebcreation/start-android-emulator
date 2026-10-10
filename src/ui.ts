import { confirm } from "@inquirer/prompts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

export const say = (msg = "") => console.log(msg);

// Flush left, like the questions of Inquirer, so everything on the screen lines up: a symbol, a space, the text.
// What belongs to a line (the details, the explanation) is indented under its text.
export const ok = (msg: string) => say(`${GREEN}✔${RESET} ${msg}`);
export const fail = (msg: string) => say(`${RED}✘${RESET} ${msg}`);
export const warn = (msg: string) => say(`${YELLOW}⚠${RESET} ${msg}`);
export const todo = (msg: string) => say(`${YELLOW}○${RESET} ${msg}`);
export const info = (msg: string) => say(`  ${DIM}${msg}${RESET}`);
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

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** One line with a spinner and the seconds that passed. Without a terminal it prints the text once. */
export function startSpinner(text: string, stream: NodeJS.WriteStream = process.stdout): () => void {
  if (!stream.isTTY) {
    info(text);
    return () => {};
  }
  const started = Date.now();
  let frame = 0;
  const draw = () => stream.write(`\r\x1b[2K${CYAN}${FRAMES[frame++ % FRAMES.length]}${RESET} ${DIM}${text} ${Math.round((Date.now() - started) / 1000)}s${RESET}`);
  draw();
  const timer = setInterval(draw, 100);
  return () => {
    clearInterval(timer);
    stream.write("\r\x1b[2K");
  };
}
