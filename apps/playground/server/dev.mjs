import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(appDir, 'server');
const backendVenv = path.join(serverDir, '.venv');
const backendPython = path.join(
  backendVenv,
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
);
const backendEnv = path.join(serverDir, '.env.local');
const requirements = path.join(serverDir, 'requirements-dev.txt');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(backendEnv)) {
  fail(`Missing server/.env.local.

Configure it with Agora CLI:
  agora project env write server/.env.local

Or create it manually:
  cp server/.env.example server/.env.local
  # Then set AGORA_APP_ID and AGORA_APP_CERTIFICATE.`);
}

const envText = fs.readFileSync(backendEnv, 'utf8');

function readEnvValue(name) {
  const line = envText.match(new RegExp(`^\\s*${name}\\s*=(.*)$`, 'm'));
  if (!line) return '';

  const value = line[1].trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

const missingCredentials = ['AGORA_APP_ID', 'AGORA_APP_CERTIFICATE'].filter((name) => {
  const value = readEnvValue(name);
  return !value || value.startsWith('your_');
});

if (missingCredentials.length > 0) {
  fail(`Configure ${missingCredentials.join(' and ')} in server/.env.local.

You can write Agora project credentials with:
  agora project env write server/.env.local`);
}

function runSetup(command, args) {
  const result = spawnSync(command, args, {
    cwd: appDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) fail(`Failed to run ${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!fs.existsSync(backendPython)) {
  console.log('Setting up the Python backend...');
  if (process.platform === 'win32') {
    runSetup('py', ['-3', '-m', 'venv', backendVenv]);
  } else {
    runSetup('python3', ['-m', 'venv', backendVenv]);
  }
  runSetup(backendPython, ['-m', 'pip', 'install', '-r', requirements]);
}

const children = new Set();
let shuttingDown = false;

function start(name, command, args) {
  const child = spawn(command, args, {
    cwd: appDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  children.add(child);

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown && code !== 0) {
      console.error(`${name} exited with ${signal || code}`);
      shutdown(code || 1);
    }
  });

  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    child.kill('SIGTERM');
  }

  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('server', backendPython, ['-m', 'server.src.server']);
start('vite', 'vite', ['--host', '127.0.0.1', '--port', '3000']);
