/**
 * logParser.js — turn raw Bedrock server log lines into structured events.
 *
 * The Bedrock server's logs are the only source of runtime truth for player
 * presence and server readiness. This module:
 *   - classifies each line's severity (info/warn/error)
 *   - detects player join/leave and maintains an in-memory onlinePlayers Map
 *   - detects "Server started" and the server version
 *
 * It is an EventEmitter so the Socket.io layer can subscribe to structured
 * events (player:join, player:leave, server:ready) without re-parsing.
 */

const { EventEmitter } = require('events');

const RE_JOIN = /Player connected:\s*(.+?),\s*xuid:\s*(\d+)/i;
const RE_LEAVE = /Player disconnected:\s*(.+?),\s*xuid:\s*(\d+)/i;
const RE_STARTED = /Server started\./i;
const RE_VERSION = /Version[:\s]+(\d+\.\d+\.\d+\.\d+)/i;
const RE_ERROR = /\[ERROR\]|\bERROR\b/;
const RE_WARN = /\[WARNING\]|\bWARN(?:ING)?\b/;

class LogParser extends EventEmitter {
  constructor() {
    super();
    /** xuid -> { name, xuid, joinedAt } */
    this.onlinePlayers = new Map();
    this.version = null;
    this.ready = false;
  }

  /** Classify a line and return { level, type, text }. */
  classify(text) {
    if (RE_ERROR.test(text)) return 'error';
    if (RE_WARN.test(text)) return 'warn';
    if (RE_JOIN.test(text)) return 'join';
    if (RE_LEAVE.test(text)) return 'leave';
    return 'info';
  }

  /**
   * Parse a single log line. Updates internal state and emits events.
   * Returns the structured event object (also useful for tests).
   */
  parse(text) {
    if (!text) return null;
    const level = this.classify(text);

    let join = RE_JOIN.exec(text);
    if (join) {
      const [, name, xuid] = join;
      const player = { name: name.trim(), xuid, joinedAt: Date.now() };
      this.onlinePlayers.set(xuid, player);
      this.emit('player:join', player);
      return { level: 'join', text, player };
    }

    const leave = RE_LEAVE.exec(text);
    if (leave) {
      const [, name, xuid] = leave;
      this.onlinePlayers.delete(xuid);
      const player = { name: name.trim(), xuid };
      this.emit('player:leave', player);
      return { level: 'leave', text, player };
    }

    if (RE_STARTED.test(text) && !this.ready) {
      this.ready = true;
      this.emit('server:ready', { version: this.version });
    }

    const ver = RE_VERSION.exec(text);
    if (ver) {
      this.version = ver[1];
      this.emit('server:version', { version: this.version });
    }

    return { level, text };
  }

  getOnlinePlayers() {
    return Array.from(this.onlinePlayers.values());
  }

  /** Reset presence state (e.g. when the container stops/restarts). */
  reset() {
    this.onlinePlayers.clear();
    this.ready = false;
  }
}

// Single shared instance across the app.
module.exports = new LogParser();
