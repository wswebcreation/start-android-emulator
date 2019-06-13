#!/usr/bin/env node

const { resolve } = require('path');
const { statSync } = require('fs');
const cwd = process.cwd();

const nodeModuleName = 'start-android-emulator';
const localInstall = resolve(cwd, 'node_modules', nodeModuleName);
const parentPath = resolve(cwd, '..');
const dir = __dirname;
const folder = cwd.replace(parentPath, '').substring(1);

let isLocalVersion = false;

let printCyan, printMagenta, printGreen;

printCyan = printMagenta = printGreen = function (message) {
  return message;
};

try {
  const chalk = require('chalk');
  printMagenta = chalk.magenta;
  printCyan = chalk.cyan;
  printGreen = chalk.green;
}
catch (e) {
  console.log('Error loading chalk, output will be boring.');
}

try {
  isLocalVersion = statSync(localInstall).isDirectory();
} catch (e) {
}

// project version
if (folder === nodeModuleName) {
  console.log(`${nodeModuleName}: using ${printMagenta('project version ' + require(resolve('package.json')).version)}`);
  require(resolve('./'));
}

// local version
else if (isLocalVersion) {
  console.log(`${nodeModuleName}: using ${printCyan('local installed version ' + require(resolve(localInstall, 'package.json')).version)}`);
  require(resolve(localInstall, './'));
}

// global version
else {
  console.log(`${nodeModuleName}: using ${printGreen('global installed version ' + require(resolve(dir, '../package.json')).version)}`);
  require(resolve(dir, '../'));
}
