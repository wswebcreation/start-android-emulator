import { settings } from "./ui.ts";

/** For library callers: what the --yes and --dry-run flags do for the CLI. Only the options that are passed change. */
export function configure({ yes, dryRun }: { yes?: boolean; dryRun?: boolean }): void {
  if (yes !== undefined) settings.yes = yes;
  if (dryRun !== undefined) settings.dryRun = dryRun;
}
