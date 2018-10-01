const { spawnSync, execFileSync } = require('child_process');
const { existsSync } = require('fs');
const { cyan, green, red } = require('chalk');
const { prompt } = require('inquirer');

const ANDROID_EMULATOR_PATH = `${process.env.ANDROID_HOME}/tools/emulator`;

console.log(cyan(`
===============================
  Android Emulator CLI Helper
===============================
`));

const emulators = execFileSync(
  'emulator',
  ['-list-avds'],
  { encoding: 'utf8' },
)
  .replace(/\n$/, '')
  .split('\n');

if (emulators.length > 0) {
  prompt([
    {
      type: 'list',
      name: 'emulator',
      message: 'Which emulator do you want to start?',
      choices: emulators,
    },
    {
      type: 'list',
      name: 'wipeData',
      message: 'Do you want to wipe data (delete all user data and copy data from the initial data file)?',
      choices: ['No', 'Yes'],
    },
  ])
    .then((answer) => {
      console.log(green(`
=========================================================
  ${answer.emulator} is being started
  You can close the device with 'Control + C'. 
=========================================================
`));
      try {
        const runOnEmulator = spawnSync(
          ANDROID_EMULATOR_PATH,
          ['-avd', answer.emulator, answer.wipeData === 'Yes' ? '-wipe-data' : '-no-snapshot'],
        );
        console.log(runOnEmulator.stdout.toString());
        process.exit(0);
      } catch (e) {
        if (!existsSync(ANDROID_EMULATOR_PATH)) {
          console.log(red(`
===========================================================
  ${ANDROID_EMULATOR_PATH} 
  does not exist. Did you set your 'ANDROID_HOME' correct?  
===========================================================
`));
        } else {
          console.log(red(`
===========================================================
  The error
  ${e} 
  occured.  
===========================================================
`));
        }
      }
    });
} else {
  console.log(red(`
==================================
  NO ANDROID EMULATORS SPECIFIED
==================================
`));
}

