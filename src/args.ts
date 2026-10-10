import { parseArgs } from "node:util";

export interface Options {
  /** The emulator to start, instead of picking one from a list */
  emulator?: string;
  wipeData: boolean;
  coldBoot: boolean;
  verbose: boolean;
  /** A DNS server to start with, false for --no-dns, undefined when not given (the saved choice or the default is used) */
  dns?: string | false;
  /** Wait until the emulator has booted. --no-wait starts it and returns. */
  wait: boolean;
  /** true for --setup (always show the setup plan), false for --no-setup (never offer it), undefined to offer it when something is missing */
  setup?: boolean;
  /** Only show what is there and what is missing */
  check: boolean;
  /** Answer yes to every question */
  yes: boolean;
  dryRun: boolean;
  /** The Android version, like 37 or 37.0 */
  api?: string;
  /** The two emulators of the Appium + WebdriverIO workshop */
  workshop: boolean;
  help: boolean;
  version: boolean;
}

/** A mistake in how the command was used. The message is meant for the user. */
export class UsageError extends Error {}

export const HELP = `Usage: start-android-emulator [emulator] [options]

Starts an Android emulator. Without an emulator name you can pick one from a list.
If Java, the Android SDK or an emulator is missing, it offers to set them up.

Start options
  --wipe-data        Delete all user data of the emulator before starting
  --cold-boot        Start without using or saving a snapshot
  --dns <ip>         DNS server for the emulator (default: 8.8.8.8, needed when the emulator has no wifi)
  --no-dns           Use the DNS of your computer
  --verbose          Show the output of the emulator while it boots
  --no-wait          Start the emulator and return, without waiting for it to boot

Setup
  --setup            Show the setup plan, also when nothing is missing
  --no-setup         Never offer to install anything, only report what is missing
  --api <level>      Android version to create an emulator for, like 36 or 37.0 (default: the newest)
  --workshop         Set up the two emulators of the Appium + WebdriverIO workshop
  --dry-run          Show what the setup would do, without changing anything

Other
  --check            Only show what is set up and what is missing, exits with 1 when something is missing
  -y, --yes          Answer yes to every question (also needed to set up without a terminal)
  -h, --help         Show this help
  -v, --version      Show the version
`;

const IP = /^[0-9a-f.:]+$/i;

export function parseOptions(argv: string[]): Options {
  // parseArgs can negate a boolean (--no-wait) but not a string option, so --no-dns is taken out first
  const noDns = argv.includes("--no-dns");
  const rest = argv.filter((arg) => arg !== "--no-dns");

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      allowNegative: true,
      options: {
        "wipe-data": { type: "boolean" },
        "cold-boot": { type: "boolean" },
        verbose: { type: "boolean" },
        dns: { type: "string" },
        wait: { type: "boolean" },
        setup: { type: "boolean" },
        check: { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        "dry-run": { type: "boolean" },
        api: { type: "string" },
        workshop: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (e) {
    throw new UsageError(`${(e as Error).message}\n\nRun start-android-emulator --help for the options.`);
  }

  const { values, positionals } = parsed;
  if (positionals.length > 1) throw new UsageError(`Only one emulator can be started at a time, but you gave ${positionals.length}: ${positionals.join(", ")}`);
  if (values.dns !== undefined && noDns) throw new UsageError("Use either --dns <ip> or --no-dns, not both.");
  if (values.dns !== undefined && !IP.test(values.dns)) throw new UsageError(`"${values.dns}" is not an IP address, use for example --dns 8.8.8.8`);
  if (positionals[0] && values.workshop) throw new UsageError("--workshop sets up emulators, it does not start one. Start them afterwards with their name.");

  return {
    emulator: positionals[0],
    wipeData: values["wipe-data"] ?? false,
    coldBoot: values["cold-boot"] ?? false,
    verbose: values.verbose ?? false,
    dns: noDns ? false : values.dns,
    wait: values.wait ?? true,
    setup: values.setup,
    check: values.check ?? false,
    yes: values.yes ?? false,
    dryRun: values["dry-run"] ?? false,
    api: values.api,
    workshop: values.workshop ?? false,
    help: values.help ?? false,
    version: values.version ?? false,
  };
}

/** Any option about how to start: when one is given the user knows what they want, so we do not ask. */
export const hasStartOptions = (o: Options) => o.wipeData || o.coldBoot || o.verbose || o.dns !== undefined;
