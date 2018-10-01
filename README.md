# start-android-emulator

A simple library to start an Android emulator on your local machine (currently only Mac is supported) when you already installed / downloaded Android emulators on your local machine

## What can it do?
This module gives you the opportunity to start of of the installed Android emulators on you local machine from the command line like below

> It relies on the `ANDROID_HOME` environment variable to be set correct!

> **Currently only MAC is supported**

![start-android-emualtor](./assets/start-android-emulator.gif)

## Install
Advice is to install is globally with `npm install -g start-android-emulator`.

## Usage
After installing it globally it can be used with the following command `start-android-emulator`.

## FAQ
### No emulators are found
If no emulators are found open Android Studio and add one. See Google how to do this

### I'm getting an error that my `ANDROID_HOME` has not been set correct
When trying to start my emulator I get this log

```bash
===========================================================
  /Users/wswebcreation/Library/Android/sdk/tools/emulator
  does not exist. Did you set your 'ANDROID_HOME' correct?
===========================================================
```

Just check the `ANDROID_HOME` variable and check if it has been set to the correct folder where the emulators would be found.
