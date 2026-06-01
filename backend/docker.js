/**
 * docker.js — Dockerode singleton and helper wrappers.
 *
 * DockCraft controls the Minecraft container exclusively through Dockerode
 * (the Docker Engine API). We NEVER shell out to the docker CLI.
 *
 * Key operations:
 *  - getContainer()      resolve the Minecraft container handle by name
 *  - inspect()/status()  container state + resource stats
 *  - start/stop/restart  lifecycle control
 *  - sendCommand()       run `send-command <cmd>` inside the container (exec)
 *  - logStream()         follow container logs (used for live console + parser)
 *  - recreate()          destroy + recreate the container with a new env map
 *                        (env vars are immutable on a running container, so a
 *                        settings change requires recreation)
 */

const Docker = require('dockerode');
const config = require('./config');

// On Linux/macOS Dockerode defaults to the unix socket; on Windows it falls
// back to the named pipe. The compose file mounts /var/run/docker.sock.
const docker = new Docker();

class DockerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DockerUnavailableError';
    this.code = 503;
  }
}

function containerName() {
  return config.load().containerName;
}

/** Returns the Dockerode container handle (does not verify it exists). */
function getContainer() {
  return docker.getContainer(containerName());
}

async function ping() {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

/** Inspect the container; throws a 404-ish/503 error with a clear message. */
async function inspect() {
  try {
    return await getContainer().inspect();
  } catch (err) {
    if (err.statusCode === 404) {
      const e = new Error(
        `Minecraft container "${containerName()}" not found. Run docker compose up to create it.`
      );
      e.code = 404;
      throw e;
    }
    throw new DockerUnavailableError(
      'Cannot reach the Docker daemon. Is Docker running and is the socket mounted?'
    );
  }
}

/**
 * Returns a normalized status object for the dashboard.
 * { running, state, startedAt, uptimeSeconds, cpu, memory }
 */
async function status() {
  const info = await inspect();
  const running = info.State.Running === true;
  const startedAt = info.State.StartedAt;
  let uptimeSeconds = 0;
  if (running && startedAt) {
    uptimeSeconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  }

  let cpu = 0;
  let memory = 0;
  if (running) {
    try {
      const stats = await getContainer().stats({ stream: false });
      cpu = computeCpuPercent(stats);
      memory = computeMemoryPercent(stats);
    } catch {
      // Stats can briefly fail right after start; report zeros rather than 503.
    }
  }

  return {
    running,
    state: info.State.Status, // created | running | paused | exited | dead
    startedAt: running ? startedAt : null,
    uptimeSeconds,
    cpu,
    memory,
  };
}

function computeCpuPercent(stats) {
  try {
    const cpuDelta =
      stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta =
      stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount =
      stats.cpu_stats.online_cpus ||
      (stats.cpu_stats.cpu_usage.percpu_usage || []).length ||
      1;
    if (systemDelta > 0 && cpuDelta > 0) {
      return Math.round((cpuDelta / systemDelta) * cpuCount * 100 * 10) / 10;
    }
  } catch {
    /* shape varies by platform */
  }
  return 0;
}

function computeMemoryPercent(stats) {
  try {
    const used = stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
    const limit = stats.memory_stats.limit;
    if (limit > 0) return Math.round((used / limit) * 100 * 10) / 10;
  } catch {
    /* shape varies by platform */
  }
  return 0;
}

async function start() {
  try {
    await getContainer().start();
  } catch (err) {
    if (err.statusCode === 304) return; // already started
    if (err.statusCode === 404) {
      const e = new Error(`Container "${containerName()}" not found.`);
      e.code = 404;
      throw e;
    }
    throw new DockerUnavailableError(err.message);
  }
}

async function stop() {
  try {
    await getContainer().stop({ t: 20 });
  } catch (err) {
    if (err.statusCode === 304) return; // already stopped
    throw new DockerUnavailableError(err.message);
  }
}

async function restart() {
  try {
    await getContainer().restart({ t: 20 });
  } catch (err) {
    throw new DockerUnavailableError(err.message);
  }
}

/**
 * Sends a console command via the itzg image's `send-command` helper, which
 * pipes into the server's stdin. Returns combined exec output.
 */
async function sendCommand(command) {
  const container = getContainer();
  const exec = await container.exec({
    Cmd: ['send-command', command],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

/**
 * Returns a readable log stream. Dockerode multiplexes stdout/stderr unless the
 * container was created with a TTY; the itzg image runs with tty: true, so the
 * stream is raw UTF-8 text. Callers should demux defensively if needed.
 */
async function logStream({ tail = 100 } = {}) {
  const container = getContainer();
  return container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail,
    timestamps: false,
  });
}

/** Returns the last N log lines as an array of strings (non-following). */
async function recentLogs({ tail = 200 } = {}) {
  const container = getContainer();
  const buf = await container.logs({
    follow: false,
    stdout: true,
    stderr: true,
    tail,
    timestamps: false,
  });
  return buf
    .toString('utf8')
    .split('\n')
    .map((l) => stripControl(l))
    .filter((l) => l.length > 0);
}

/** Strip Docker stream-header control bytes and ANSI codes from a log line. */
function stripControl(line) {
  // eslint-disable-next-line no-control-regex
  return line.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\u001b\[[0-9;]*m/g, '').trim();
}

/**
 * Recreate the Minecraft container with a new environment map. Used by the
 * settings route because env vars cannot be changed on a running container.
 * Preserves the image, name, port bindings and the /data bind mount.
 */
async function recreate(envMap) {
  const cfg = config.load();
  const existing = getContainer();

  let oldInfo = null;
  try {
    oldInfo = await existing.inspect();
  } catch (err) {
    if (err.statusCode !== 404) throw new DockerUnavailableError(err.message);
  }

  if (oldInfo) {
    if (oldInfo.State.Running) {
      try { await existing.stop({ t: 20 }); } catch { /* may already be stopped */ }
    }
    await existing.remove({ force: true });
  }

  const Env = Object.entries(envMap).map(([k, v]) => `${k}=${v}`);
  const port = `${envMap.SERVER_PORT || '19132'}/udp`;

  // Reuse the previous host config (binds/port bindings) when available so we
  // don't lose the /data bind mount; otherwise fall back to sane defaults.
  const HostConfig = oldInfo?.HostConfig || {
    Binds: [`${process.env.HOST_DATA_PATH || './data'}:/data`],
    PortBindings: { [port]: [{ HostPort: envMap.SERVER_PORT || '19132' }] },
    RestartPolicy: { Name: 'unless-stopped' },
  };

  await docker.createContainer({
    Image: cfg.image,
    name: cfg.containerName,
    Env,
    ExposedPorts: { [port]: {} },
    HostConfig,
    OpenStdin: true,
    Tty: true,
  });

  await getContainer().start();
}

module.exports = {
  docker,
  getContainer,
  ping,
  inspect,
  status,
  start,
  stop,
  restart,
  sendCommand,
  logStream,
  recentLogs,
  recreate,
  stripControl,
  DockerUnavailableError,
};
