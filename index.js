import { spawn, execFileSync } from "child_process";
import { existsSync } from "fs";
import { select } from "@inquirer/prompts";
import { join, normalize } from "path";
import { platform } from "os";

const OS_TYPE = platform();

const MESSAGE_TYPES = {
  ERROR: "error",
  NOTIFY: "notify",
};

(async () => {
  logMessage(MESSAGE_TYPES.NOTIFY, "\nAndroid Emulator CLI Helper\nBy: @wswebcreation\n");
  const emulators = getEmulators();
  if (emulators.length > 0) {
    const emulator = await select({
      message: "Which emulator do you want to start?",
      choices: emulators,
    });
    const wipeData = await select({
      message:
        "Do you want to wipe data (delete all user data and copy data from the initial data file)?",
      choices: [
        { value: "No", name: "No" },
        { value: "Yes", name: "Yes" },
      ],
    });
    const dnsServer = await select({
      message:
        "Do you want to start with `-dns-server 8.8.8.8` (Needed when the Emulator doesn't has wifi)?",
      choices: [
        { value: "No", name: "No" },
        { value: "Yes", name: "Yes" },
      ],
    });
    const logBooting = await select({
      message:
        "Do you want to log the booting process?",
      choices: [
        { value: "No", name: "No" },
        { value: "Yes", name: "Yes" },
      ],
    });

    startEmulator({
      emulator,
      wipeData,
      dnsServer,
      logBooting,
    });
  } else {
    logMessage(
      MESSAGE_TYPES.ERROR,
      "\nNo Android Emulators found!\nPlease create an emulator in Android Studio first.\n",
    );
  }
})();

/**
 * Start the emulator based on all the answers
 *
 * @param answers {object} All the answers
 * @param answers.emulator {string} The emulator name
 * @param answers.wipeData {string} If the emulator needs to be cleaned yes or no
 */
function startEmulator(answers) {
  try {
    logMessage(
      MESSAGE_TYPES.NOTIFY,
      `Launching ${answers.emulator}...`,
    );

    const options = {};
    if (OS_TYPE === "win32") {
      options.shell = true;
    }
    const emulatorProcess = spawn(
      normalize(join(process.env.ANDROID_HOME, "/emulator/emulator")),
      [
        "-avd",
        answers.emulator,
        answers.wipeData === "Yes" ? "-wipe-data" : "-no-snapshot",
      ].concat(answers.dnsServer === "Yes" ? ["-dns-server", "8.8.8.8"] : []),
      options,
    );
    emulatorProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (answers.logBooting === "Yes") {
        console.log(output);
      }
      const readyRegex = /boot completed/i;
      if (readyRegex.test(output)) {
        logMessage(
          MESSAGE_TYPES.NOTIFY,
          `Launching ${answers.emulator} completed.`,
        );
        process.exit();
      }
    });
    
    emulatorProcess.stderr.on('data', (data) => {
      if (answers.logBooting === "Yes") {
        const output = data.toString();
        console.log(output);
      }
    });
    
    emulatorProcess.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
      logMessage(
        MESSAGE_TYPES.ERROR,
        `Child process exited with code ${code}. Check the logs for more information.`,
      );
    });
  } catch (e) {
    let errorMessage;

    if (e.message.includes("Cannot read property 'toString' of null")) {
      errorMessage =
        "It looks like the `emulator` has not been set correct in your environment variables. " +
        "Please check this article on how to fix it." +
        "\n\n  https://bit.ly/2XD94gV";
    } else if (!existsSync(process.env.ANDROID_HOME)) {
      errorMessage =
        "The environment variable `ANDROID_HOME` is not found. Did you set your `ANDROID_HOME` correct?";
    } else {
      errorMessage = `The error\n\n${e}\n\n  occurred and the emulator couldn't be started.   !Check Google what the problem could be!`;
    }

    // Now log the error message
    logMessage(MESSAGE_TYPES.ERROR, errorMessage);
    process.exit();
  }
}

/**
 * Get all the emulators that are installed
 *
 * @return {string[]}
 */
function getEmulators() {
  const emulatorsOutput = execFileSync(
    normalize(join(process.env.ANDROID_HOME, "/emulator/emulator")),
    ["-list-avds"],
    { encoding: "utf8" },
  );
  const emulators = emulatorsOutput
    .split("\n")
    .filter((line) => !!line && !line.startsWith("INFO"))
    .map((emulator) => ({ name: emulator, value: emulator }));

  return emulators;
}

/**
 * Print the error message
 *
 * @param {string} type
 * @param {string} message
 */
function logMessage(type, message) {
  const CYAN = "\x1b[36m";
  const RED = "\x1b[31m";
  const YELLOW = "\x1b[33m";
  const RESET = "\x1b[0m";

  const color = type === MESSAGE_TYPES.NOTIFY ? CYAN : RED;
  console.log(`${color}${message}${RESET}`);
}
