import { checkbox, select } from "@inquirer/prompts";
import { bold, dim, header, info, ok, settings, todo, warn } from "./ui.ts";

export const dry = (message: string) => info(`[dry run] ${message}`);

export interface Step {
  id: string;
  title: string;
  /** What this step is and why it is needed, shown when it is missing */
  description: string;
  done: boolean;
  /** What the step does, as a short verb phrase for the question: "create Pixel_9_API_37_0" */
  action?: string;
  /** False for something that is nice to have: it does not stop an emulator from starting. Default true. */
  required?: boolean;
  /** Shown behind a step that is already done */
  detail?: string | null;
  apply: () => Promise<boolean>;
}

export interface PlanResult {
  /** Everything is in place, or was set up now */
  ok: boolean;
  /** The ids of the steps that were done now */
  applied: string[];
  declined: boolean;
}

/** The steps that are missing and that stop an emulator from starting. */
export const blocking = (steps: Step[]) => steps.filter((step) => !step.done && step.required !== false);

/** Show what is done and, with its description, what is missing. */
export function showPlan(title: string, steps: Step[]): void {
  console.log(`\n${title}\n`);
  for (const step of steps) {
    if (step.done) {
      ok(`${bold(step.title)}${step.detail ? ` ${dim(step.detail)}` : ""}`);
    } else {
      todo(`${bold(step.title)}, missing`);
      info(step.description);
    }
  }
}

/** Explain what we are going to do, ask once, then do it. */
export async function runPlan(title: string, steps: Step[]): Promise<PlanResult> {
  const missing = steps.filter((step) => !step.done);
  showPlan(title, steps);

  if (missing.length === 0) {
    console.log("\nEverything is already set up.");
    return { ok: true, applied: [], declined: false };
  }

  const chosen = await choose(missing);
  if (chosen.length === 0) {
    warn("Nothing was changed.");
    return { ok: false, applied: [], declined: true };
  }

  const applied: string[] = [];
  for (const step of chosen) {
    header(step.title);
    if (!(await step.apply())) {
      console.log("\nStopped, because this step failed. Fix the problem above and run the setup again.");
      return { ok: false, applied, declined: false };
    }
    applied.push(step.id);
  }
  return { ok: chosen.length === missing.length, applied, declined: false };
}

async function choose(missing: Step[]): Promise<Step[]> {
  console.log();
  if (settings.yes) return missing;

  const only = missing.length === 1 ? missing[0]!.action : undefined;
  const answer = await select({
    message: only ? `${only.charAt(0).toUpperCase()}${only.slice(1)} now?` : `Set up the ${missing.length} missing item${missing.length === 1 ? "" : "s"} now?`,
    choices: [
      { value: "all", name: only ? "Yes, go ahead" : "Yes, set everything up" },
      ...(missing.length > 1 ? [{ value: "some", name: "Let me choose what to install" }] : []),
      { value: "none", name: "No, exit" },
    ],
  });
  if (answer === "all") return missing;
  if (answer === "none") return [];

  const ids = await checkbox({
    message: "Which items?",
    choices: missing.map((step) => ({ value: step.id, name: step.title, checked: true })),
  });
  return missing.filter((step) => ids.includes(step.id));
}
