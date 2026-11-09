const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class MpvDeck {
  constructor(key) {
    this.key = key;
    this.socketDir = path.join(os.tmpdir(), `mymusics-${process.pid}`);
    this.socketPath = path.join(this.socketDir, `${key}.sock`);
    this.child = null;
    this.socket = null;
    this.connecting = null;
    this.buffer = "";
    this.requestId = 0;
    this.pending = new Map();
    this.error = "";
  }

  async ensure() {
    if (this.socket?.writable) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.start();
    try { await this.connecting; }
    finally { this.connecting = null; }
  }

  async start() {
    await fs.mkdir(this.socketDir, { recursive: true, mode: 0o700 });
    await fs.rm(this.socketDir, { recursive: true, force: true });
    this.error = "";
    const binary = process.env.MPV_BIN || "mpv";
    this.child = spawn(binary, [
      "--no-config", "--no-video", "--audio-display=no", "--force-window=no",
      "--idle=yes", "--no-terminal", `--input-ipc-server=${this.socketPath}`
    ], { stdio: "ignore", windowsHide: true });
    this.child.once("error", (error) => { this.error = error.code === "ENOENT" ? "MPV is not installed on the MyMusics host." : error.message; });
    this.child.once("exit", (code) => {
      this.socket?.destroy();
      this.socket = null;
      this.child = null;
      this.rejectPending(new Error(`MPV stopped${code == null ? "" : ` (${code})`}.`));
    });

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (this.error) throw new Error(this.error);
      if (this.child.exitCode !== null) throw new Error("MPV exited before opening its control socket.");
      try {
        const socket = net.createConnection(this.socketPath);
        await new Promise((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("error", reject);
        });
        this.socket = socket;
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => this.onData(chunk));
        socket.on("error", (error) => { this.error = error.message; });
        socket.on("close", () => {
          if (this.socket === socket) this.socket = null;
          this.rejectPending(new Error("MPV control socket closed."));
        });
        this.error = "";
        return;
      } catch { await wait(75); }
    }
    throw new Error(this.error || "MPV did not open its control socket.");
  }

  onData(chunk) {
    this.buffer += chunk;
    let end;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const pending = this.pending.get(message.request_id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(message.request_id);
      if (message.error && message.error !== "success") pending.reject(new Error(`MPV: ${message.error}`));
      else pending.resolve(message.data);
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async command(command) {
    await this.ensure();
    const request_id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request_id);
        reject(new Error("MPV did not respond."));
      }, 5000);
      this.pending.set(request_id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ command, request_id })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(request_id);
        reject(error);
      });
    });
  }

  async property(name) {
    try { return await this.command(["get_property", name]); }
    catch { return null; }
  }

  async set(name, value) { return this.command(["set_property", name, value]); }
  async load(url, volume = 100) {
    await this.set("volume", volume);
    await this.command(["loadfile", url, "replace"]);
  }
  async stop() {
    if (!this.socket?.writable) return;
    await this.command(["stop"]).catch(() => {});
    await this.set("volume", 100).catch(() => {});
  }

  async status() {
    if (!this.socket?.writable) return { playing: false, paused: true, path: "", time: 0, duration: 0, volume: 100, ended: false };
    const [paused, file, time, duration, volume, idle, eof] = await Promise.all([
      this.property("pause"), this.property("path"), this.property("time-pos"),
      this.property("duration"), this.property("volume"), this.property("idle-active"), this.property("eof-reached")
    ]);
    return {
      playing: Boolean(file) && !paused && !idle,
      paused: Boolean(paused), path: typeof file === "string" ? file : "",
      time: Number(time) || 0, duration: Number(duration) || 0,
      volume: Number(volume) || 0, ended: Boolean(eof)
    };
  }

  async close() {
    this.rejectPending(new Error("MPV is shutting down."));
    this.socket?.destroy();
    this.socket = null;
    this.child?.kill("SIGTERM");
    this.child = null;
    await fs.unlink(this.socketPath).catch(() => {});
  }
}

class HostPlayer {
  constructor() {
    this.decks = { a: new MpvDeck("a"), b: new MpvDeck("b") };
    this.activeDeck = null;
    this.fadeGeneration = 0;
    this.lastError = "";
  }

  async playRadio(url, volume = 100) {
    this.fadeGeneration++;
    await Promise.all([this.decks.a.stop(), this.decks.b.stop()]);
    await this.decks.a.load(url, volume);
    this.activeDeck = "a";
    this.lastError = "";
  }

  async playMusic({ id, deck, port, crossfade, fadeSeconds, naturalFadeIn = false }) {
    const incoming = this.decks[deck];
    const outgoingKey = this.activeDeck;
    const outgoing = outgoingKey && outgoingKey !== deck ? this.decks[outgoingKey] : null;
    const url = `http://127.0.0.1:${port}/library/audio/${encodeURIComponent(id)}`;
    const current = await incoming.status();
    if (current.path === url && current.paused) {
      await incoming.set("pause", false);
      this.activeDeck = deck;
      return;
    }

    this.fadeGeneration++;
    const generation = this.fadeGeneration;
    const seconds = crossfade && outgoing ? Math.min(60, Math.max(0, Number(fadeSeconds) || 0)) : 0;
    if (outgoing && !seconds) await outgoing.command(["set_property", "pause", true]).catch(() => {});
    try { await incoming.load(url, seconds ? 0 : 100); }
    catch (error) {
      if (outgoing && !seconds) await outgoing.set("pause", false).catch(() => {});
      throw error;
    }
    this.activeDeck = deck;
    this.lastError = "";
    if (outgoing && seconds) {
      const status = await outgoing.status();
      const remaining = status.duration - status.time;
      const fadeSeconds = Number.isFinite(remaining) && remaining > 0 ? Math.min(seconds, remaining) : seconds;
      void this.fade(outgoing, incoming, fadeSeconds, generation, naturalFadeIn);
    } else if (outgoing) await outgoing.stop();
  }

  async fade(outgoing, incoming, seconds, generation, fadeInOnly = false) {
    const oldVolume = Number(await outgoing.property("volume")) || 100;
    const started = Date.now();
    while (generation === this.fadeGeneration) {
      const progress = Math.min(1, (Date.now() - started) / (seconds * 1000));
      const changes = [incoming.set("volume", Math.round(progress * 100)).catch(() => {})];
      if (!fadeInOnly) changes.push(outgoing.set("volume", Math.round(oldVolume * (1 - progress))).catch(() => {}));
      await Promise.all(changes);
      if (progress >= 1) break;
      await wait(50);
    }
    if (generation !== this.fadeGeneration) return;
    if (!fadeInOnly) await outgoing.stop();
    await incoming.set("volume", 100).catch(() => {});
  }

  async control(deck, action, value) {
    const player = this.decks[deck];
    if (action === "pause") await player.set("pause", true);
    else if (action === "resume") await player.set("pause", false);
    else if (action === "stop") await player.stop();
    else if (action === "volume") await player.set("volume", Math.min(100, Math.max(0, Number(value) || 0)));
    else if (action === "seek") await player.command(["seek", Math.max(0, Number(value) || 0), "absolute+exact"]);
    else throw new Error("Unknown playback action.");
  }

  async stop() {
    this.fadeGeneration++;
    await Promise.all([this.decks.a.stop(), this.decks.b.stop()]);
    this.activeDeck = null;
  }

  async status() {
    const decks = await Promise.all([this.decks.a.status(), this.decks.b.status()]);
    return { available: Boolean(this.decks.a.child || this.decks.b.child), activeDeck: this.activeDeck, error: this.lastError, decks: { a: decks[0], b: decks[1] } };
  }

  async close() { await Promise.all([this.decks.a.close(), this.decks.b.close()]); }
}

module.exports = HostPlayer;
