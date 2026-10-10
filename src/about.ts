/** What the tool does and the commands to try first. Shown under the banner on every run, and at the top of --help. */
export const INTRO = ["Start an Android emulator from your terminal.", "No Java or Android SDK yet? We set it up for you."];

export const COMMANDS: [command: string, what: string][] = [
  ["start-android-emulator [emulator]", "Pick an emulator, or start one by name"],
  ["start-android-emulator --check", "See what is set up and what is missing"],
  ["start-android-emulator --setup", "Install what is missing"],
];

/** The pointer to the rest. Only on the run, --help is where it points to. */
export const MORE: [string, string] = ["start-android-emulator --help", "All options"];

const width = Math.max(...[...COMMANDS, MORE].map(([command]) => command.length));

export const commandLine = ([command, what]: [string, string], paint = (_: "command" | "what", text: string) => text) =>
  `  ${paint("command", command)}${" ".repeat(width - command.length + 2)}${paint("what", what)}`;

/** The text of --help above the options: what it does and the commands to try first. */
export const aboutText = () => [...INTRO, "", ...COMMANDS.map((c) => commandLine(c))].join("\n");
