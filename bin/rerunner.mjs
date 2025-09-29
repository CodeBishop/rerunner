#!/usr/bin/env node

import blessed from 'blessed';
import { exec, spawn, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import readline from 'readline';

const execAsync = promisify(exec);
const repoRoot = process.cwd();
const CONFIG_FILENAME = '.rerunner.json';
const CONFIG_SEARCH_PATHS = [
  repoRoot,
  resolve(repoRoot, 'build'),
  resolve(repoRoot, 'config')
];

// Check if this is macOS
if (process.platform !== 'darwin') {
  console.log('Error: This script only works on macOS');
  process.exit(1);
}

function findConfigFile() {
  for (const searchPath of CONFIG_SEARCH_PATHS) {
    const configPath = resolve(searchPath, CONFIG_FILENAME);
    try {
      readFileSync(configPath, 'utf8');
      return configPath;
    } catch {
      // Continue searching
    }
  }
  return null;
}

function getAppName() {
  const configPath = findConfigFile();
  if (!configPath) {
    const scriptName = path.basename(process.argv[1]);
    throw new Error(`Config file ${CONFIG_FILENAME} not found. Run '${scriptName} init' to create one.`);
  }

  let cfg;
  try {
    const raw = readFileSync(configPath, 'utf8');
    cfg = JSON.parse(raw);
  } catch (e) {
    throw new Error(`get-app-name: failed to load ${configPath}:\n${e.message}`);
  }

  const name = cfg?.appName;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`get-app-name: appName missing or empty in ${configPath}`);
  }
  return name;
}

async function isAppRunning(appName) {
  try {
    const { stdout } = await execAsync(`pgrep -f "${appName}"`);
    return stdout.trim().length > 0;
  } catch (error) {
    return false;
  }
}

async function isAppInstalled(appName) {
  try {
    await fs.access(`/Applications/${appName}.app`);
    return true;
  } catch {
    return false;
  }
}

// Determine expected file extension for current OS
function getFileExt() {
  switch (process.platform) {
    case 'darwin':
      return 'dmg';
    case 'win32':
      return 'exe';
    case 'linux':
      return 'AppImage';
    default:
      return 'unknown';
  }
}

// Detect Apple Silicon mac
function getArchSuffix() {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return '-arm64';
  }
  return '';
}

function getInstallerPath() {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  } catch (e) {
    throw new Error(`get-installer-path: failed to load package.json: ${e.message}`);
  }

  const appName = getAppName();
  const verNumber = pkg.version;
  const archSuffix = getArchSuffix();
  const fileExt = getFileExt();

  const installerPath = resolve(
    repoRoot,
    'dist',
    `${appName}-${verNumber}${archSuffix}.${fileExt}`
  );

  return installerPath;
}

async function getFileAge(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return Math.floor((Date.now() - stats.mtime.getTime()) / 1000);
  } catch {
    return null;
  }
}

function formatAge(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

async function killApp(appName) {
  try {
    await execAsync(`pkill -f "${appName}"`);
    // Wait a moment for the app to fully close
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (error) {
    // App might not be running, that's ok
  }
}

async function installFromDmg(dmgPath, appName) {
  // Verify the DMG file exists
  try {
    await fs.access(dmgPath);
  } catch (error) {
    throw new Error(`DMG file not found: ${dmgPath}`);
  }

  console.log(`Mounting DMG: ${dmgPath}`);

  // Mount the DMG
  const { stdout } = await execAsync(`hdiutil attach "${dmgPath}"`);
  console.log('hdiutil output:', stdout);

  // Find the mount point - look for /Volumes/... at the end of lines
  const mountPointMatch = stdout.match(/\/Volumes\/[^\s]+(?:\s[^\s\/]*)*$/m);
  const mountPoint = mountPointMatch ? mountPointMatch[0].trim() : null;

  if (!mountPoint) {
    throw new Error('Failed to find mount point in hdiutil output');
  }

  console.log('Mount point:', mountPoint);

  try {
    const appInDmg = `${mountPoint}/${appName}.app`;
    const installedApp = `/Applications/${appName}.app`;

    console.log('Looking for app at:', appInDmg);

    // Verify the app exists in the DMG
    try {
      await fs.access(appInDmg);
    } catch (error) {
      throw new Error(`App not found in DMG: ${appInDmg}`);
    }

    // Remove existing app if it exists
    try {
      await execAsync(`rm -rf "${installedApp}"`);
      console.log('Removed existing app');
    } catch {
      // App might not exist, that's ok
    }

    // Copy the app to Applications
    console.log('Copying app to Applications...');
    await execAsync(`cp -R "${appInDmg}" "/Applications/"`);
    console.log('App copied successfully');
  } finally {
    // Always unmount the DMG
    console.log('Unmounting DMG...');
    await execAsync(`hdiutil detach "${mountPoint}"`);
  }
}

function runYarnCommand(command) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yarn', [command], { stdio: 'inherit' });
    proc.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`yarn ${command} failed with code ${code}`));
      }
    });
  });
}

async function runApp(appName) {
  const appPath = `/Applications/${appName}.app`;
  const executablePath = `${appPath}/Contents/MacOS/${appName}`;
  
  // Check if app is installed
  try {
    await fs.access(appPath);
  } catch (error) {
    throw new Error(`${appName}.app not found in Applications folder`);
  }
  
  // Check if executable exists
  try {
    await fs.access(executablePath);
  } catch (error) {
    throw new Error(`Executable not found at ${executablePath}`);
  }
  
  // Run the app (equivalent to bash exec)
  const proc = spawn(executablePath, [], { 
    stdio: 'inherit'
  });
  
  proc.on('close', (code) => {
    process.exit(code || 0);
  });
}

async function promptForInput(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function initConfig() {
  console.log('Creating .rerunner.json configuration file...\n');
  
  const appName = await promptForInput('Enter the app name: ');
  
  if (!appName) {
    console.error('App name is required');
    process.exit(1);
  }

  const config = {
    appName: appName
  };

  const configPath = resolve(repoRoot, CONFIG_FILENAME);
  
  try {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log(`✓ Created ${configPath}`);
    console.log(`App name: ${appName}`);
  } catch (error) {
    console.error(`Failed to create config file: ${error.message}`);
    process.exit(1);
  }
}

async function main() {
  // Handle init command
  if (process.argv[2] === 'init') {
    await initConfig();
    return;
  }
  let appName;
  let installerPath;
  let installerExists = false;
  let installerAge = null;
  let appRunning = false;
  let appInstalled = false;

  // Make initial determinations
  try {
    appName = getAppName();
    installerPath = getInstallerPath();
    installerAge = await getFileAge(installerPath);
    installerExists = installerAge !== null;
    appRunning = await isAppRunning(appName);
    appInstalled = await isAppInstalled(appName);
  } catch (error) {
    if (error.message.includes('Config file .rerunner.json not found')) {
      console.log('.rerunner.json config file not found, use init to create one.');
      console.log('Run: rerunner init');
      console.log('  OR');
      console.log('Run: npx rerunner init');
      process.exit(0);
    } else {
      console.error('Error during initialization:', error.message);
    }
    process.exit(1);
  }

  // Create blessed screen
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Reinstall App',
    cursor: {
      artificial: true,
      shape: 'line',
      blink: true,
    },
  });

  // Hide cursor
  screen.program.hideCursor();

  // State
  let runRebuild = true; // Always default to true
  let runAfterInstall = true;

  function render() {
    screen.children.forEach(child => screen.remove(child));

    const box = blessed.box({
      top: 1,
      left: 2,
      width: '90%',
      height: '90%',
      content: '',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
      },
      tags: true,
    });

    let content = `App: ${appName}\n`;
    content += `Installer: ${path.basename(installerPath)}\n\n`;

    // Build checkbox
    if (!installerExists) {
      // No installer - build is required (checked, greyed out, not toggleable)
      content += `{gray-fg}[✓] [B]uild the app (required - no installer found){/}\n`;
    } else {
      // Installer exists - build is optional
      const buildStatus = runRebuild ? '{green-fg}[✓]{/}' : '[ ]';
      const buildAge = ` {gray-fg}(${formatAge(installerAge)} old){/}`;
      content += `${buildStatus} [B]uild the app${buildAge}\n`;
    }

    // Run checkbox
    const runStatus = runAfterInstall ? '{green-fg}[✓]{/}' : '[ ]';
    content += `${runStatus} [R]un the app\n\n`;

    // Status indicators
    if (appInstalled) {
      content += '{yellow-fg}APP WILL BE OVERWRITTEN{/}\n';
    } else {
      content += 'App not currently installed\n';
    }

    if (appRunning) {
      content += '{red-fg}APP WILL BE KILLED{/}\n';
    } else {
      content += 'App not currently running\n';
    }

    content += '\n';
    content += 'Press {cyan-fg}[Q]{/} to quit, {cyan-fg}[Enter]{/} to proceed\n';
    content += 'Press {cyan-fg}[B]{/} to toggle build, {cyan-fg}[R]{/} to toggle run';

    box.setContent(content);
    screen.append(box);
    screen.render();
  }

  // Key handling
  screen.key(['q', 'C-c'], () => {
    screen.program.showCursor();
    process.exit(0);
  });

  screen.key(['b', 'B'], () => {
    // Only allow toggling if installer exists
    if (installerExists) {
      runRebuild = !runRebuild;
      render();
    }
  });

  screen.key(['r', 'R'], () => {
    runAfterInstall = !runAfterInstall;
    render();
  });

  screen.key(['enter'], async () => {
    screen.destroy();

    // Restore cursor before proceeding
    screen.program.showCursor();

    try {
      console.log('Starting reinstall process...\n');

      // Run rebuild if needed
      if (runRebuild) {
        console.log('Running yarn rebuild...');
        await runYarnCommand('dev-rebuild');
        console.log('✓ Build complete\n');
      }

      // Verify installer exists before proceeding
      try {
        await fs.access(installerPath);
      } catch (error) {
        throw new Error(`Installer not found: ${installerPath}. Did the build succeed?`);
      }

      // Kill app if running
      if (appRunning) {
        console.log('Killing running app...');
        await killApp(appName);
        console.log('✓ App killed\n');
      }

      // Install from DMG
      console.log('Installing from DMG...');
      await installFromDmg(installerPath, appName);
      console.log('✓ App installed\n');

      // Run app if requested
      if (runAfterInstall) {
        console.log('Running app...');
        await runApp(appName);
      }

      console.log('Reinstall complete!');
    } catch (error) {
      console.error('Error during reinstall:', error.message);
      process.exit(1);
    }
  });

  render();
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});