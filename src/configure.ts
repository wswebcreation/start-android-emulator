import { settings } from "./ui.ts";

/** For library callers: what the --yes, --dry-run and --debug flags do for the CLI. Only the options that are passed change. */
export function configure({ yes, dryRun, debug }: { yes?: boolean; dryRun?: boolean; debug?: boolean }): void {
  if (yes !== undefined) settings.yes = yes;
  if (dryRun !== undefined) settings.dryRun = dryRun;
  if (debug !== undefined) settings.debug = debug;
}
