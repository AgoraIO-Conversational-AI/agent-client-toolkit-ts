import { spawn } from 'node:child_process';

const children = new Set();
let shuttingDown = false;

function start(name, command, args) {
  const child = spawn(command, args, {
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

start('server', process.execPath, ['server/server.mjs']);
start('vite', 'vite', ['--host', '127.0.0.1', '--port', '3001']);
