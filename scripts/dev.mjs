import net from 'node:net';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';

const children = new Set();
let stopping = false;

function prefixStream(stream, prefix) {
  if (!stream) return;
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length) process.stdout.write(`${prefix} ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buffer.length) process.stdout.write(`${prefix} ${buffer}\n`);
  });
}

function portIsFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function firstFreePort(start, span = 20) {
  for (let port = start; port < start + span; port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error(`No free port found between ${start} and ${start + span - 1}.`);
}

function waitForHealth(port, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const retry = () => {
      if (stopping) return;
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`API did not become ready on port ${port} within ${timeoutMs / 1000}s.`));
        return;
      }
      setTimeout(attempt, 300);
    };

    const attempt = () => {
      const req = http.get(
        { hostname: '127.0.0.1', port, path: '/api/health', timeout: 1200 },
        res => {
          res.resume();
          if (res.statusCode === 200) {
            resolve();
            return;
          }
          retry();
        }
      );
      req.on('timeout', () => req.destroy());
      req.on('error', retry);
    };

    attempt();
  });
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore'
      });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
}

function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) killTree(child);
  setTimeout(() => process.exit(exitCode), 100);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

function npmProcess(args, options = {}) {
  // npm is a .cmd shim on Windows. Spawning npm.cmd directly can throw
  // EINVAL on some Windows + Node 22 setups, especially from folders whose
  // paths contain spaces. Execute it through cmd.exe instead.
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    const commandLine = ['npm', ...args].join(' ');
    return spawn(comspec, ['/d', '/s', '/c', commandLine], {
      ...options,
      windowsHide: false
    });
  }

  return spawn('npm', args, options);
}

function monitorChild(child, label) {
  children.add(child);
  prefixStream(child.stdout, `[${label}]`);
  prefixStream(child.stderr, `[${label}]`);

  child.once('error', error => {
    children.delete(child);
    if (!stopping) {
      console.error(`[${label}] Could not start process: ${error.message}`);
      if (error.code) console.error(`[${label}] Error code: ${error.code}`);
      stopAll(1);
    }
  });

  child.once('exit', code => {
    children.delete(child);
    if (!stopping) {
      console.error(
        `[${label}] Process stopped unexpectedly with code ${code ?? 'unknown'}.`
      );
      stopAll(code || 1);
    }
  });

  return child;
}

async function main() {
  const apiPort = await firstFreePort(4000);
  const webPort = await firstFreePort(5173);

  console.log('Starting Calamelle v2.3.7...');
  console.log('Windows-safe launcher enabled.');
  if (apiPort !== 4000) {
    console.log(`Port 4000 is busy; Calamelle API will use ${apiPort} instead.`);
  }
  if (webPort !== 5173) {
    console.log(`Port 5173 is busy; Calamelle web app will use ${webPort} instead.`);
  }

  let backend;
  try {
    backend = npmProcess(['--workspace', 'backend', 'run', 'dev'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(apiPort),
        FRONTEND_URL: `http://localhost:${webPort}`
      },
      stdio: ['inherit', 'pipe', 'pipe']
    });
  } catch (error) {
    console.error(`[API] Failed to launch backend: ${error.message}`);
    if (error.code) console.error(`[API] Error code: ${error.code}`);
    stopAll(1);
    return;
  }

  monitorChild(backend, 'API');

  try {
    await waitForHealth(apiPort);
  } catch (error) {
    console.error(error.message);
    stopAll(1);
    return;
  }

  if (stopping) return;

  let frontend;
  try {
    frontend = npmProcess(['--workspace', 'frontend', 'run', 'dev'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CALAMELLE_API_URL: `http://127.0.0.1:${apiPort}`,
        CALAMELLE_WEB_PORT: String(webPort)
      },
      stdio: ['inherit', 'pipe', 'pipe']
    });
  } catch (error) {
    console.error(`[WEB] Failed to launch frontend: ${error.message}`);
    if (error.code) console.error(`[WEB] Error code: ${error.code}`);
    stopAll(1);
    return;
  }

  monitorChild(frontend, 'WEB');

  console.log('');
  console.log(`Calamelle API: http://127.0.0.1:${apiPort}`);
  console.log(`Calamelle web: http://localhost:${webPort}`);
  console.log('The frontend proxy is linked to this exact API instance.');
  console.log('Press Ctrl+C to stop both servers.');
  console.log('');
}

main().catch(error => {
  console.error(error);
  stopAll(1);
});
