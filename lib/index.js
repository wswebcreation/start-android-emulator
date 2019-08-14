#!/usr/bin/env node

import { spawnSync, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { cyan, red, yellow } from 'chalk';
import { prompt } from 'inquirer';
import { join, normalize } from 'path';
import { platform } from 'os'

const OS_TYPE = platform()

const MESSAGE_TYPES = {
	ERROR: 'error',
	NOTIFY: 'notify',
};

(async () => {
	const emulators = getEmulators();
	const questions = [
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
			choices: [ 'No', 'Yes' ],
		},
	];

	logMessage(
		MESSAGE_TYPES.NOTIFY,
		'Android Emulator CLI Helper',
	)

	if (emulators.length > 0) {
		const answers = await prompt(questions);
		startEmulator(answers);
	} else {
		logMessage(
			MESSAGE_TYPES.ERROR,
			'NO ANDROID EMULATORS SPECIFIED',
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
		// Start logging that we start
		logMessage(
			MESSAGE_TYPES.NOTIFY,
			`${ answers.emulator } is being started. You can close the device with 'X'-button on the toolbar of the device.`,
		);

		const options = {}
		
		if (OS_TYPE === 'win32') {
			options.shell = true
		}

		// Start the emulator
		const runOnEmulator = spawnSync(
			normalize(join(process.env.ANDROID_HOME, '/emulator/emulator')), 
			[
				'-avd',
				answers.emulator,
				answers.wipeData === 'Yes' ? '-wipe-data' : '-no-snapshot',
			], 
			options
		);

		console.log(yellow(runOnEmulator.stdout.toString()));

		// Check if there is an error and throw it
		const stderr = runOnEmulator.stderr.toString();
		if (stderr) {
			throw new Error(stderr);
		}
		process.exit(0);
	} catch (e) {
		let errorMessage;

		if (e.message.includes('Cannot read property \'toString\' of null')) {
			errorMessage = 'It looks like the `emulator` has not been set correct in your environment variables. ' +
				'Please check this article on how to fix it.' +
				'\n\n  https://bit.ly/2XD94gV';
		} else if (!existsSync(process.env.ANDROID_HOME)) {
			errorMessage = 'The environment variable `ANDROID_HOME` is not found. Did you set your `ANDROID_HOME` correct?'
		} else {
			errorMessage = `The error\n\n${ e }\n\n  occurred and the emulator couldn't be started.   !Check Google what the problem could be!`;
		}

		// Now log the error message
		logMessage(
			MESSAGE_TYPES.ERROR,
			errorMessage,
		);
	}
}

/**
 * GEt all the emulators that are installed
 *
 * @return {string[]}
 */
function getEmulators() {
	const emulators = execFileSync(
		normalize(join(process.env.ANDROID_HOME, '/emulator/emulator')),
		[ '-list-avds' ],
		{ encoding: 'utf8' },
	)
	.replace(/\n$/, '')
	.split('\n');

	return emulators.filter(e => !!e)
}

/**
 * Print the error message
 *
 * @param {string} type
 * @param {string} message
 */
function logMessage(type, message) {
	const messageType = type === MESSAGE_TYPES.NOTIFY ? cyan : red;
	console.log(messageType(`
============================================================================================================================================
  
  ${ message }
  
============================================================================================================================================
`));
}
