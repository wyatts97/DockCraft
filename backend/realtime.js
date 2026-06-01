/**
 * realtime.js — Socket.io wiring for live console logs, player events, stats.
 *
 * Emits:
 *   console:line   { text, level, timestamp }   every container log line
 *   player:join    { name, xuid, joinedAt }
 *   player:leave   { name, xuid }
 *   server:ready   { version }
 *   server:stats   { cpu, memory, uptimeSeconds, running, playerCount }
 *
 * The log stream is (re)attached whenever it drops, so it survives container
 * restarts. Stats are polled every 5s via Dockerode.
 *
 * A ring buffer of the last STATS_HISTORY_SIZE readings is kept in memory and
 * exposed via getStatsHistory() so the dashboard can render a sparkline.
 */

const docker = require('./docker');
const logParser = require('./services/logParser');

const STATS_INTERVAL_MS = 5000;
const LOG_REATTACH_MS = 5000;
const STATS_HISTORY_SIZE = 60;

function attach(io) {
  // Re-broadcast structured parser events to all clients.
  logParser.on('player:join', (p) => io.emit('player:join', p));
  logParser.on('player:leave', (p) => io.emit('player:leave', p));
  logParser.on('server:ready', (p) => io.emit('server:ready', p));
  logParser.on('server:version', (p) => io.emit('server:version', p));

  startLogStreaming(io);
  startStatsLoop(io);

  io.on('connection', (socket) => {
    // Send a snapshot so a freshly connected client isn't empty until the next tick.
    socket.emit('players:snapshot', { players: logParser.getOnlinePlayers() });
  });
}

let streaming = false;
async function startLogStreaming(io) {
  if (streaming) return;
  streaming = true;

  const connect = async () => {
    try {
      const stream = await docker.logStream({ tail: 50 });
      stream.on('data', (chunk) => {
        const raw = chunk.toString('utf8');
        for (const part of raw.split('\n')) {
          const line = docker.stripControl(part);
          if (!line) continue;
          const parsed = logParser.parse(line);
          io.emit('console:line', {
            text: line,
            level: parsed ? parsed.level : 'info',
            timestamp: Date.now(),
          });
        }
      });
      const retry = () => {
        stream.removeAllListeners();
        setTimeout(connect, LOG_REATTACH_MS);
      };
      stream.on('end', retry);
      stream.on('error', retry);
    } catch {
      // Container likely not running/created yet — retry shortly.
      setTimeout(connect, LOG_REATTACH_MS);
    }
  };

  connect();
}

function startStatsLoop(io) {
  setInterval(async () => {
    try {
      const s = await docker.status();
      const payload = {
        cpu: s.cpu,
        memory: s.memory,
        uptimeSeconds: s.uptimeSeconds,
        running: s.running,
        state: s.state,
        playerCount: logParser.getOnlinePlayers().length,
      };
      io.emit('server:stats', payload);
      recordStats(payload);
      if (!s.running) logParser.reset();
    } catch {
      const payload = { cpu: 0, memory: 0, uptimeSeconds: 0, running: false, state: 'absent', playerCount: 0 };
      io.emit('server:stats', payload);
      recordStats(payload);
    }
  }, STATS_INTERVAL_MS);
}

/* ---- Stats history (ring buffer) ---- */
const statsHistory = [];

function recordStats(snapshot) {
  statsHistory.push({ ...snapshot, t: Date.now() });
  if (statsHistory.length > STATS_HISTORY_SIZE) statsHistory.shift();
}

function getStatsHistory() {
  return statsHistory.slice();
}

module.exports = { attach, getStatsHistory, _recordStats: recordStats };
