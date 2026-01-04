import express from "express";
import { createServer } from "http";

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

import { Server } from "socket.io";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import cors from "cors";
import RSSParser from "rss-parser";
import os from "os";
import multer from "multer";
import Docker from "dockerode";
import si from "systeminformation";

const rssParser = new RSSParser();
const socketPath =
  process.env.DOCKER_SOCKET_PATH ||
  (process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock");
const docker = new Docker({ socketPath });

// --- Docker Stats Collector & Cache ---
const containerStatsCache = new Map(); // id -> { cpuPercent, memUsage, memLimit, memPercent, netIO, blockIO, timestamp }
let isStatsCollectorRunning = false;

const calculateStats = (s) => {
  let cpuPercent = 0;
  let memUsage = 0;
  let memLimit = 0;
  let memPercent = 0;
  let netRx = 0;
  let netTx = 0;
  let blockRead = 0;
  let blockWrite = 0;

  try {
    const cpuStats = s.cpu_stats;
    const precpuStats = s.precpu_stats;

    if (cpuStats && precpuStats) {
      const cpuDelta = cpuStats.cpu_usage.total_usage - precpuStats.cpu_usage.total_usage;
      const systemDelta = cpuStats.system_cpu_usage - precpuStats.system_cpu_usage;
      const onlineCpus =
        cpuStats.online_cpus ||
        (cpuStats.cpu_usage.percpu_usage ? cpuStats.cpu_usage.percpu_usage.length : 0);

      if (systemDelta > 0 && onlineCpus > 0) {
        cpuPercent = (cpuDelta / systemDelta) * onlineCpus * 100.0;
      }
    }

    // Memory
    if (s.memory_stats) {
      memUsage = s.memory_stats.usage;
      if (s.memory_stats.stats && s.memory_stats.stats.cache) {
        memUsage -= s.memory_stats.stats.cache;
      } else if (s.memory_stats.stats && s.memory_stats.stats.inactive_file) {
        memUsage -= s.memory_stats.stats.inactive_file;
      }

      memLimit = s.memory_stats.limit;
      if (memLimit > 0) {
        memPercent = (memUsage / memLimit) * 100.0;
      }
    }

    // Network IO
    if (s.networks) {
      Object.values(s.networks).forEach((n) => {
        netRx += n.rx_bytes || 0;
        netTx += n.tx_bytes || 0;
      });
    }

    // Block IO
    if (s.blkio_stats && s.blkio_stats.io_service_bytes_recursive) {
      s.blkio_stats.io_service_bytes_recursive.forEach((io) => {
        if (io.op === "Read") blockRead += io.value;
        if (io.op === "Write") blockWrite += io.value;
      });
    }
  } catch {
    // Ignore calculation errors
  }

  return {
    cpuPercent,
    memUsage,
    memLimit,
    memPercent,
    netIO: { rx: netRx, tx: netTx },
    blockIO: { read: blockRead, write: blockWrite },
  };
};

const startStatsCollector = () => {
  if (isStatsCollectorRunning) return;
  isStatsCollectorRunning = true;

  const collect = async () => {
    try {
      // 1. Get running containers
      // listContainers returns basic info.
      const containers = await docker.listContainers({ all: false }).catch(() => []);
      const running = containers.filter((c) => c.State === "running");

      // 2. Concurrency control for stats fetching
      const concurrency = 5;
      const queue = [...running];

      const worker = async () => {
        while (queue.length > 0) {
          const c = queue.shift();
          if (!c) break;

          try {
            const container = docker.getContainer(c.Id);

            // Promise.race for timeout
            const statsPromise = container.stats({ stream: false });
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Stats timeout")), 5000),
            );

            const rawStats = await Promise.race([statsPromise, timeoutPromise]);
            const processed = calculateStats(rawStats);

            containerStatsCache.set(c.Id, {
              ...processed,
              timestamp: Date.now(),
            });
          } catch {
            // Failed to fetch stats, maybe container died or busy
            // We keep old stats if they are recent (< 10s), otherwise mark as error or just stale
            // For now, we just don't update the cache, so old data remains until cleanup
            // console.warn(`Failed to fetch stats for ${c.Id}: ${e.message}`);
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }).map(() => worker()));

      // 3. Cleanup cache for non-running containers
      const runningIds = new Set(running.map((c) => c.Id));
      for (const id of containerStatsCache.keys()) {
        if (!runningIds.has(id)) {
          containerStatsCache.delete(id);
        }
      }
    } catch (e) {
      console.error("Stats collector error:", e);
    } finally {
      // Schedule next run
      setTimeout(collect, 2000);
    }
  };

  collect();
};

// Start collector
startStatsCollector();

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allow all origins for simplicity in this environment
    methods: ["GET", "POST"],
  },
});

import crypto from "crypto";

const PORT = 3000;
const SECRET_KEY = process.env.SECRET_KEY || crypto.randomBytes(32).toString("hex");

if (!process.env.SECRET_KEY) {
  console.warn(
    "⚠️  WARNING: No SECRET_KEY environment variable set. Using a random generated key. Sessions will be invalidated on restart.",
  );
}

// Login Attempts { ip: { count: 0, lockUntil: 0 } }
const loginAttempts = {};

// Directories
const DATA_DIR = path.join(__dirname, "data");
const DOC_DIR = path.join(__dirname, "doc");
const USERS_DIR = path.join(DATA_DIR, "users");
const OLD_DATA_FILE = path.join(DATA_DIR, "data.json");
const SYSTEM_CONFIG_FILE = path.join(DATA_DIR, "system.json");
const DEFAULT_FILE = path.join(__dirname, "default.json");
const MUSIC_DIR = path.join(__dirname, "music");
// const WALLPAPER_DIR = path.join(__dirname, "Wallpaper"); // Deprecated but kept for reference if needed
const BACKGROUNDS_DIR = path.join(__dirname, "PC");
const MOBILE_BACKGROUNDS_DIR = path.join(__dirname, "APP");
const CONFIG_VERSIONS_DIR = path.join(DATA_DIR, "config_versions");
const AMAP_STATS_FILE = path.join(DATA_DIR, "amap_stats.json");
const TRANSFER_ROOT = path.join(DOC_DIR, "transfer");
const TRANSFER_INDEX = path.join(TRANSFER_ROOT, "index.json");
const TRANSFER_UPLOADS = path.join(TRANSFER_ROOT, "uploads");
const TRANSFER_CHUNKS = path.join(TRANSFER_ROOT, "chunks");
const ICON_CACHE_DIR = path.join(DATA_DIR, "icon-cache");

// Helper to ensure directory exists safely
async function ensureDir(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (err) {
      console.error(`Failed to create directory: ${dirPath}`, err);
    }
  }
}

// Config multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, MUSIC_DIR);
  },
  filename: function (req, file, cb) {
    // Decode original name to handle utf-8 chars properly if needed
    // But multer usually handles it. We'll use buffer to be safe for chinese chars
    const name = Buffer.from(file.originalname, "latin1").toString("utf8");
    cb(null, name);
  },
});
const upload = multer({ storage: storage });

const CACHE_TTL_MS = 60 * 60 * 1000;
const HOT_CACHE = {
  weibo: { ts: 0, data: [] },
  news: { ts: 0, data: [] },
  huxiu: { ts: 0, data: [] },
  custom: new Map(),
  rss: new Map(),
};

const safeJsonParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const getByPath = (obj, pathStr) => {
  const p = String(pathStr || "").trim();
  if (!p) return undefined;
  const tokens = [];
  const re = /[^.[\]]+|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(p))) {
    if (m[1] != null) tokens.push(Number(m[1]));
    else tokens.push(m[0]);
  }
  let cur = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = cur[t];
  }
  return cur;
};

const toPlainHeaders = (raw) => {
  if (!raw) return {};
  if (typeof raw === "object") {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!k) continue;
      out[String(k)] = typeof v === "string" ? v : String(v);
    }
    return out;
  }
  if (typeof raw !== "string") return {};
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!k) continue;
    out[String(k)] = typeof v === "string" ? v : String(v);
  }
  return out;
};

const readStreamToText = async (stream, maxBytes, encoding = "utf-8") => {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder(encoding);
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) throw new Error("Response too large");
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
};

// In-memory cache for all users: { username: data }
const cachedUsersData = {};
let systemConfig = { authMode: "single" }; // default: 'single' or 'multi'

async function atomicWrite(filePath, content) {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempFile = `${filePath}.tmp-${uniqueSuffix}`;
  try {
    await fs.writeFile(tempFile, content);
    // Windows compatibility: retry rename if it fails (common with antivirus/file locks)
    let retries = 3;
    while (retries > 0) {
      try {
        await fs.rename(tempFile, filePath);
        return;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        await new Promise((resolve) => setTimeout(resolve, 100)); // wait 100ms
      }
    }
  } catch (err) {
    // If rename failed after retries, try copy and unlink as last resort for Windows
    if (os.platform() === "win32") {
      try {
        await fs.copyFile(tempFile, filePath);
        await fs.unlink(tempFile);
        return;
      } catch (copyErr) {
        console.error(`[AtomicWrite] Failed to write ${filePath}:`, copyErr);
        throw err; // Throw original error or copy error
      }
    }
    console.error(`[AtomicWrite] Error writing ${filePath}:`, err);
    throw err;
  }
}

// Ensure directories and migrate data
async function ensureInit() {
  await ensureDir(DATA_DIR);
  await ensureDir(DOC_DIR);
  await ensureDir(USERS_DIR);
  await ensureDir(MUSIC_DIR);
  await ensureDir(BACKGROUNDS_DIR);
  await ensureDir(MOBILE_BACKGROUNDS_DIR);
  await ensureDir(CONFIG_VERSIONS_DIR);
  await ensureDir(TRANSFER_ROOT);
  await ensureDir(TRANSFER_UPLOADS);
  await ensureDir(TRANSFER_CHUNKS);
  await ensureDir(ICON_CACHE_DIR);

  // Load System Config
  try {
    const sysContent = await fs.readFile(SYSTEM_CONFIG_FILE, "utf-8");
    systemConfig = JSON.parse(sysContent);
  } catch {
    await fs.writeFile(SYSTEM_CONFIG_FILE, JSON.stringify(systemConfig, null, 2));
  }

  // Migration Logic based on Auth Mode
  const adminFile = path.join(USERS_DIR, "admin.json");

  if (systemConfig.authMode === "single") {
    // Single Mode: We prefer data.json
    try {
      await fs.access(OLD_DATA_FILE);
      // data.json exists, good.
    } catch {
      // data.json missing. Check if we have admin.json to restore from
      try {
        await fs.access(adminFile);
        console.log("Restoring users/admin.json to data.json for Single User Mode...");
        // Copy instead of rename to be safe, or rename? Rename is better to avoid confusion.
        await fs.rename(adminFile, OLD_DATA_FILE);
      } catch {
        // Neither exists, will be created later
      }
    }
  } else {
    // Multi Mode: We prefer users/admin.json
    try {
      await fs.access(adminFile);
      // admin.json exists, good.
    } catch {
      // admin.json missing. Check if we have data.json to migrate from
      try {
        await fs.access(OLD_DATA_FILE);
        console.log("Migrating data.json to users/admin.json for Multi User Mode...");
        // Copy to preserve original data.json as backup? Or just copy.
        await fs.copyFile(OLD_DATA_FILE, adminFile);
      } catch {
        // Neither exists
      }
    }
  }

  // Load Admin Data (Active File)
  const activeAdminFile = getUserFile("admin");
  try {
    const content = await fs.readFile(activeAdminFile, "utf-8");
    cachedUsersData["admin"] = JSON.parse(content);
  } catch {
    // Create default admin
    const initData = await getDefaultData();
    await fs.writeFile(activeAdminFile, JSON.stringify(initData, null, 2));
    cachedUsersData["admin"] = initData;
  }
}

async function getDefaultData() {
  try {
    const def = await fs.readFile(DEFAULT_FILE, "utf-8");
    return JSON.parse(def);
  } catch {
    return {
      groups: [{ id: "default", title: "常用", items: [] }],
      widgets: [],
      appConfig: {},
      password: "admin",
    };
  }
}

ensureInit();

app.use(cors());
app.use(express.json({ limit: "120mb" }));
app.use(express.urlencoded({ extended: true, limit: "120mb" }));

// Helper to get user file path
function getUserFile(username) {
  // Single User Mode Compatibility:
  // If mode is 'single' and user is 'admin', use the old data.json path.
  if (username === "admin" && systemConfig.authMode === "single") {
    return OLD_DATA_FILE;
  }

  // Sanitize username to prevent directory traversal
  const safeUsername = username.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(USERS_DIR, `${safeUsername}.json`);
}

// Middleware to authenticate token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token == null) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      // Treat invalid token as Unauthorized so client knows to re-login
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = user;
    next();
  });
};

// System Config API
app.get("/api/system-config", (req, res) => {
  res.json(systemConfig);
});

// Docker Status API
app.get("/api/docker-status", async (req, res) => {
  const dockerStatusFile = path.join(DATA_DIR, "docker-status.json");
  try {
    const content = await fs.readFile(dockerStatusFile, "utf-8");
    res.json(JSON.parse(content));
  } catch (err) {
    // If file not found, return a default status
    if (err.code === "ENOENT") {
      return res.json({ hasUpdate: false, lastCheck: null, error: "Docker status file not found" });
    }
    console.error("[Docker Status Error]:", err);
    res.status(500).json({ error: "Failed to read docker status" });
  }
});

app.get("/api/stats/amap", async (req, res) => {
  try {
    const data = await fs.readFile(AMAP_STATS_FILE, "utf8");
    res.json(JSON.parse(data));
  } catch {
    res.json({ total: 0, today: 0, lastDate: new Date().toISOString().split("T")[0] });
  }
});

// System Stats API
app.get("/api/system/stats", authenticateToken, async (req, res) => {
  try {
    const [cpuLoad, cpuInfo, mem, fsSize, networkStats, temp, time, osInfo] = await Promise.all([
      si.currentLoad(),
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.cpuTemperature(),
      si.time(),
      si.osInfo(),
    ]);

    // Optimize Memory: mem.active is often better for "Used" on Linux as it excludes buffers/cache
    // But systeminformation 'used' is total - free - buffers - cached.
    // Let's pass both and decide in frontend or just pass the object.

    res.json({
      success: true,
      data: {
        cpu: {
          currentLoad: cpuLoad.currentLoad,
          currentLoadUser: cpuLoad.currentLoadUser,
          currentLoadSystem: cpuLoad.currentLoadSystem,
          manufacturer: cpuInfo.manufacturer,
          brand: cpuInfo.brand,
          speed: cpuInfo.speed,
          cores: cpuInfo.cores,
        },
        mem: {
          total: mem.total,
          used: mem.used,
          active: mem.active,
          available: mem.available,
        },
        disk: fsSize,
        network: networkStats,
        temp: temp,
        uptime: time.uptime,
        os: {
          distro: osInfo.distro,
          release: osInfo.release,
          codename: osInfo.codename,
          kernel: osInfo.kernel,
          arch: osInfo.arch,
          hostname: osInfo.hostname,
        },
      },
    });
  } catch (error) {
    console.error("System Stats Error:", error);
    res.json({ success: false, error: error.message });
  }
});

// Docker Management APIs
app.get("/api/docker/containers", authenticateToken, async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });

    // Enrich containers with stats from cache
    const enriched = containers.map((c) => {
      if (c.State === "running" && containerStatsCache.has(c.Id)) {
        const s = containerStatsCache.get(c.Id);
        return {
          ...c,
          stats: {
            cpuPercent: s.cpuPercent,
            memUsage: s.memUsage,
            memLimit: s.memLimit,
            memPercent: s.memPercent,
            netIO: s.netIO,
            blockIO: s.blockIO,
          },
        };
      }
      return c;
    });

    res.json({ success: true, data: enriched });
  } catch (error) {
    console.error("Docker List Error:", error);
    // Return empty list instead of 500 if docker is not available, so frontend doesn't break
    res.json({ success: false, error: "Docker not available: " + error.message, data: [] });
  }
});

app.get("/api/docker/container/:id/inspect-lite", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const container = docker.getContainer(id);
    const info = await container.inspect();

    const networkMode =
      (info && info.HostConfig && typeof info.HostConfig.NetworkMode === "string"
        ? info.HostConfig.NetworkMode
        : "") || "";

    const exposedObj = (info && info.Config && info.Config.ExposedPorts) || {};
    const exposedPorts = Object.keys(exposedObj)
      .map((k) => {
        const v = parseInt(String(k).split("/")[0] || "", 10);
        return Number.isFinite(v) ? v : null;
      })
      .filter((x) => typeof x === "number" && x > 0 && x <= 65535);

    const env =
      (info && info.Config && Array.isArray(info.Config.Env) ? info.Config.Env : []) || [];
    const envPortKeys = new Set([
      "PORT",
      "HTTP_PORT",
      "HTTPS_PORT",
      "SERVER_PORT",
      "LISTEN_PORT",
      "WEB_PORT",
    ]);
    const envPorts = env
      .map((kv) => {
        const s = typeof kv === "string" ? kv : "";
        const idx = s.indexOf("=");
        if (idx <= 0) return null;
        const key = s.slice(0, idx).trim().toUpperCase();
        const val = s.slice(idx + 1).trim();
        if (!envPortKeys.has(key)) return null;
        const p = parseInt(val, 10);
        if (!Number.isFinite(p) || p <= 0 || p > 65535) return null;
        return p;
      })
      .filter((x) => typeof x === "number");

    const merged = Array.from(new Set([...(exposedPorts || []), ...(envPorts || [])]))
      .filter((p) => typeof p === "number" && p > 0 && p <= 65535)
      .sort((a, b) => a - b);

    res.json({ success: true, data: { networkMode, ports: merged } });
  } catch (error) {
    console.error("Docker Inspect Error:", error);
    res.status(500).json({ success: false, error: error.message || "inspect_failed" });
  }
});

app.get("/api/docker/info", authenticateToken, async (req, res) => {
  try {
    const info = await docker.info();
    const version = await docker.version();
    res.json({ success: true, info, version, socketPath });
  } catch (error) {
    console.error("Docker Info Error:", error);
    res.json({ success: false, error: error.message, socketPath });
  }
});

// Proxy for AliYun Icons to avoid CORS
app.get("/api/ali-icons", async (req, res) => {
  try {
    const sources = [
      "https://icon-manager.1851365c.er.aliyun-esa.net",
      "https://icon-manager2.1851365c.er.aliyun-esa.net",
      "http://icon-manager3.1851365c.er.aliyun-esa.net",
    ];

    const fetchWithTimeout = async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok)
          throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    };

    const normalizeIcon = (icon, baseUrl) => {
      const rawUrl = typeof icon?.url === "string" ? icon.url.trim() : "";
      const rawDownloadUrl = typeof icon?.downloadUrl === "string" ? icon.downloadUrl.trim() : "";

      let downloadUrl = rawDownloadUrl;
      if (!downloadUrl) {
        if (/^https?:\/\//i.test(rawUrl) || rawUrl.startsWith("//") || rawUrl.startsWith("data:")) {
          downloadUrl = rawUrl;
        } else if (rawUrl) {
          try {
            downloadUrl = new URL(rawUrl, baseUrl).href;
          } catch {
            downloadUrl = "";
          }
        }
      } else {
        if (
          !/^https?:\/\//i.test(downloadUrl) &&
          !downloadUrl.startsWith("//") &&
          !downloadUrl.startsWith("data:")
        ) {
          try {
            downloadUrl = new URL(downloadUrl, baseUrl).href;
          } catch {
            downloadUrl = "";
          }
        }
      }

      return { ...icon, downloadUrl };
    };

    const results = await Promise.allSettled(
      sources.map(async (baseUrl) => {
        const data = await fetchWithTimeout(`${baseUrl}/icons.json`);
        if (!Array.isArray(data)) throw new Error(`Invalid icons.json: ${baseUrl}`);
        return data.map((icon) => normalizeIcon(icon, baseUrl));
      }),
    );

    const merged = [];
    const seen = new Set();

    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const icon of r.value) {
        const key =
          (typeof icon?.downloadUrl === "string" && icon.downloadUrl) ||
          `${icon?.name || ""}|${icon?.url || ""}|${icon?.filename || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(icon);
      }
    }

    if (merged.length === 0) {
      return res.status(502).json({ error: "Failed to fetch icons from all sources" });
    }

    res.json(merged);
  } catch (error) {
    console.error("[Proxy Error] Failed to fetch AliYun icons:", error);
    res.status(500).json({ error: "Failed to fetch icons" });
  }
});

app.post("/api/docker/container/:id/:action", authenticateToken, async (req, res) => {
  const { id, action } = req.params;
  try {
    const container = docker.getContainer(id);
    if (action === "start") await container.start();
    else if (action === "stop") await container.stop();
    else if (action === "restart") await container.restart();
    else return res.status(400).json({ error: "Invalid action" });

    res.json({ success: true });
  } catch (error) {
    console.error(`Docker Action ${action} Error:`, error);
    res.status(500).json({ error: `Failed to ${action} container: ` + error.message });
  }
});

app.post("/api/system-config", authenticateToken, async (req, res) => {
  if (!req.user || req.user.username !== "admin") {
    return res.status(403).json({ error: "Only admin can change system config" });
  }
  const { authMode } = req.body;
  if (authMode && (authMode === "single" || authMode === "multi")) {
    systemConfig.authMode = authMode;
    await atomicWrite(SYSTEM_CONFIG_FILE, JSON.stringify(systemConfig, null, 2));
    res.json({ success: true, systemConfig });
  } else {
    res.status(400).json({ error: "Invalid config" });
  }
});

// GET /api/data
// Public Groups API (for extension)
app.get("/api/public/groups", async (req, res) => {
  // Explicitly set CORS headers for this endpoint to ensure extension accessibility
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization",
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  let username = "admin";

  // Auth Check
  if (systemConfig.authMode === "multi") {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      username = decoded.username;
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  } else {
    // Single mode: if token provided, use it, else default to admin
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, SECRET_KEY);
        username = decoded.username;
      } catch {
        // ignore
      }
    }
  }

  // Load data
  if (!cachedUsersData[username]) {
    const filePath = getUserFile(username);
    try {
      const json = await fs.readFile(filePath, "utf-8");
      cachedUsersData[username] = JSON.parse(json);
    } catch {
      return res.status(404).json({ error: "User data not found" });
    }
  }

  const userData = cachedUsersData[username];
  res.json({ groups: userData.groups || [] });
});

app.get("/api/data", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    let username = "";
    if (token) {
      try {
        const user = jwt.verify(token, SECRET_KEY);
        if (user && typeof user === "object" && "username" in user) {
          username = user.username;
        }
      } catch {
        // Ignore invalid token
      }
    }

    let isGuest = false;
    if (!username) {
      username = "admin";
      isGuest = true;
    }

    if (!cachedUsersData[username]) {
      const filePath = getUserFile(username);
      try {
        const json = await fs.readFile(filePath, "utf-8");
        cachedUsersData[username] = JSON.parse(json);
      } catch {
        if (username === "admin") {
          return res.status(500).json({ error: "Admin data missing" });
        }
        return res.status(404).json({ error: "User data not found" });
      }
    }

    const userData = cachedUsersData[username];
    const safeData = { ...userData };
    delete safeData.password;
    safeData.username = username;

    // Fix: Allow guest access with isPublic: false
    if (isGuest) {
      console.log("[API Data] Guest access detected, filtering data...");
      safeData.isPublic = false;
      // Filter groups
      if (safeData.groups) {
        const originalCount = safeData.groups.reduce((acc, g) => acc + (g.items || []).length, 0);
        safeData.groups = safeData.groups
          .map((group) => ({
            ...group,
            items: (group.items || []).filter((item) => item.isPublic === true),
          }))
          .filter((group) => group.items.length > 0);
        const newCount = safeData.groups.reduce((acc, g) => acc + (g.items || []).length, 0);
        console.log(`[API Data] Filtered items: ${originalCount} -> ${newCount}`);
      }
      // Filter widgets
      if (safeData.widgets) {
        const originalW = safeData.widgets.length;
        safeData.widgets = safeData.widgets.filter((w) => w.isPublic === true);
        console.log(`[API Data] Filtered widgets: ${originalW} -> ${safeData.widgets.length}`);
      }
    } else {
      console.log(`[API Data] Authenticated access: ${username}`);
    }

    res.json(safeData);
  } catch (err) {
    console.error("[Read Data Failed]:", err);
    res.status(500).json({ error: "Failed to read data" });
  }
});

// Login
const recordFailedAttempt = (ip) => {
  if (!loginAttempts[ip]) {
    loginAttempts[ip] = { count: 0, lockUntil: 0 };
  }
  const entry = loginAttempts[ip];
  entry.count++;
  if (entry.count >= 5) {
    entry.lockUntil = Date.now() + 15 * 60 * 1000;
    entry.count = 0;
  }
};

const resetFailedAttempt = (ip) => {
  if (loginAttempts[ip]) {
    delete loginAttempts[ip];
  }
};

app.post("/api/login", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || req.ip;

  const entry = loginAttempts[ip];
  if (entry && entry.lockUntil > Date.now()) {
    const waitSeconds = Math.ceil((entry.lockUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `Too many attempts, wait ${waitSeconds}s` });
  }

  let { username = "", password } = req.body;

  // Single user mode logic: default to admin if no username provided
  if (systemConfig.authMode === "single" && !username) {
    username = "admin";
  }
  // If still empty (e.g. multi mode but user didn't provide username), default to admin for backward compatibility or fail?
  // Let's keep existing behavior: default to "admin" if undefined, but frontend should handle it.
  if (!username) username = "admin";

  // Load user data
  if (!cachedUsersData[username]) {
    const filePath = getUserFile(username);
    try {
      const json = await fs.readFile(filePath, "utf-8");
      cachedUsersData[username] = JSON.parse(json);
    } catch {
      // User not found
      recordFailedAttempt(ip);
      return res.status(401).json({ error: "User not found or password incorrect" });
    }
  }

  const userData = cachedUsersData[username];
  const storedPassword = userData.password || "admin";
  let match = false;

  try {
    if (storedPassword.startsWith("$2b$")) {
      match = await bcrypt.compare(password, storedPassword);
    } else {
      match = password === storedPassword;
      if (match) {
        const hash = await bcrypt.hash(password, 10);
        userData.password = hash;
        cachedUsersData[username] = userData;
        await atomicWrite(getUserFile(username), JSON.stringify(userData, null, 2));
      }
    }
  } catch {
    console.error("Login error");
  }

  if (match) {
    resetFailedAttempt(ip);

    let expiresIn = "3d";
    try {
      const faviconPath = path.join(__dirname, "../public/favicon.ico");
      const stat = await fs.stat(faviconPath);
      if (stat.size > 400 * 1024) {
        expiresIn = "20m";
      }
    } catch {
      // ignore
    }

    const token = jwt.sign({ username }, SECRET_KEY, { expiresIn });
    res.json({ success: true, token, username });
  } else {
    recordFailedAttempt(ip);
    res.status(401).json({ error: "Password incorrect" });
  }
});

// Config Versions (Single User Mode)
app.get("/api/config-versions", authenticateToken, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (systemConfig.authMode !== "single") {
      return res.status(400).json({ error: "Only available in single user mode" });
    }
    const files = await fs.readdir(CONFIG_VERSIONS_DIR);
    const list = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const full = path.join(CONFIG_VERSIONS_DIR, f);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat) continue;
      const base = path.basename(f, ".json");
      const [tsStr, ...labelParts] = base.split("-");
      const ts = Number(tsStr) || stat.mtimeMs;
      const label = labelParts.join("-");
      list.push({ id: f, label, createdAt: ts, size: stat.size });
    }
    list.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ versions: list });
  } catch (err) {
    console.error("[ConfigVersions][List]", err);
    res.status(500).json({ error: "Failed to list versions" });
  }
});

app.post("/api/config-versions", authenticateToken, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (systemConfig.authMode !== "single") {
      return res.status(400).json({ error: "Only available in single user mode" });
    }
    const rawLabel = (req.body && req.body.label) || "";
    const safeLabel = String(rawLabel)
      .replace(/[^a-zA-Z0-9-_]/g, "_")
      .slice(0, 64);
    const now = Date.now();
    const filename = safeLabel ? `${now}-${safeLabel}.json` : `${now}.json`;
    const filePath = path.join(CONFIG_VERSIONS_DIR, filename);
    const adminData = cachedUsersData["admin"] || {};
    const snapshot = {
      groups: adminData.groups || [],
      widgets: adminData.widgets || [],
      appConfig: adminData.appConfig || {},
      rssFeeds: adminData.rssFeeds || [],
      rssCategories: adminData.rssCategories || [],
    };
    await atomicWrite(filePath, JSON.stringify(snapshot, null, 2));
    res.json({ success: true, id: filename });
  } catch (err) {
    console.error("[ConfigVersions][Save]", err);
    res.status(500).json({ error: "Failed to save version" });
  }
});

app.post("/api/config-versions/restore", authenticateToken, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (systemConfig.authMode !== "single") {
      return res.status(400).json({ error: "Only available in single user mode" });
    }
    const id = req.body && req.body.id;
    if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing id" });
    const filePath = path.join(CONFIG_VERSIONS_DIR, path.basename(id));
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    const activeFile = getUserFile("admin");
    const current = cachedUsersData["admin"] || {};
    const finalData = { ...data, password: current.password };
    cachedUsersData["admin"] = finalData;
    await atomicWrite(activeFile, JSON.stringify(finalData, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error("[ConfigVersions][Restore]", err);
    res.status(500).json({ error: "Failed to restore version" });
  }
});

app.delete("/api/config-versions/:id", authenticateToken, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (systemConfig.authMode !== "single") {
      return res.status(400).json({ error: "Only available in single user mode" });
    }
    const id = req.params.id;
    if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing id" });
    const filePath = path.join(CONFIG_VERSIONS_DIR, path.basename(id));
    await fs.unlink(filePath).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    console.error("[ConfigVersions][Delete]", err);
    res.status(500).json({ error: "Failed to delete version" });
  }
});

// Register
app.post("/api/register", async (req, res) => {
  if (systemConfig.authMode === "single") {
    return res.status(403).json({ error: "Registration disabled in Single User Mode" });
  }

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });

  // Admin creating user bypasses checks? No, user limit applies to everyone unless admin forces it?
  // Let's stick to the rule: user limit is global.
  // Unless we want admin to be able to add users even if limit reached? Maybe not for now.

  // Check user limit
  try {
    const files = await fs.readdir(USERS_DIR);
    const userCount = files.filter((f) => f.endsWith(".json")).length;

    if (userCount >= 5) {
      // Check license
      const licenseFile = path.join(DATA_DIR, "license.key");
      const LICENSE_KEY_CONTENT = "FLATNAS-VIP-UNLIMITED-2025";
      try {
        const licenseContent = await fs.readFile(licenseFile, "utf-8");
        if (licenseContent.trim() !== LICENSE_KEY_CONTENT) {
          throw new Error("Invalid license");
        }
      } catch {
        return res.status(403).json({
          error:
            "注册失败：已达到最大用户限制（5个）。如需无限用户权限，请联系管理员部署授权密钥 (license.key)。",
        });
      }
    }
  } catch (err) {
    console.error("Error checking user limit:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Internal error checking user limits" });
    }
  }

  const safeUsername = username.replace(/[^a-zA-Z0-9_-]/g, "");
  if (safeUsername !== username || username.length < 3) {
    return res.status(400).json({ error: "Invalid username (alphanumeric, 3+ chars)" });
  }

  const filePath = getUserFile(username);
  try {
    await fs.access(filePath);
    return res.status(400).json({ error: "User already exists" });
  } catch {
    // OK to create
  }

  const initData = await getDefaultData();
  initData.password = await bcrypt.hash(password, 10);

  cachedUsersData[username] = initData;
  await atomicWrite(filePath, JSON.stringify(initData, null, 2));

  res.json({ success: true });
});

// Admin User Management
// Get all users
app.get("/api/admin/users", authenticateToken, async (req, res) => {
  if (!req.user || req.user.username !== "admin") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const files = await fs.readdir(USERS_DIR);
    const users = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
    res.json({ users });
  } catch {
    res.status(500).json({ error: "Failed to list users" });
  }
});

// Delete user
app.delete("/api/admin/users/:username", authenticateToken, async (req, res) => {
  if (!req.user || req.user.username !== "admin") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const targetUser = req.params.username;
  if (targetUser === "admin") {
    return res.status(400).json({ error: "Cannot delete admin" });
  }

  const filePath = getUserFile(targetUser);
  try {
    await fs.unlink(filePath);
    delete cachedUsersData[targetUser];
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// Add user (Admin)
app.post("/api/admin/users", authenticateToken, async (req, res) => {
  if (!req.user || req.user.username !== "admin") {
    return res.status(403).json({ error: "Unauthorized" });
  }
  // Reuse register logic but authenticated
  // We can just call the register endpoint internally or duplicate logic?
  // Let's reuse logic by calling a helper or just invoking the handler if we refactored.
  // For simplicity, I'll copy the core logic here but skip the authMode check since admin can add users in multi mode.
  // Wait, if authMode is single, admin shouldn't be adding users anyway?
  // The requirement says "admin can manage accounts", implies multi-user mode.

  if (systemConfig.authMode === "single") {
    return res.status(400).json({ error: "Multi-user mode required" });
  }

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });

  // Check user limit
  try {
    const files = await fs.readdir(USERS_DIR);
    const userCount = files.filter((f) => f.endsWith(".json")).length;

    if (userCount >= 5) {
      const licenseFile = path.join(DATA_DIR, "license.key");
      const LICENSE_KEY_CONTENT = "FLATNAS-VIP-UNLIMITED-2025";
      try {
        const licenseContent = await fs.readFile(licenseFile, "utf-8");
        if (licenseContent.trim() !== LICENSE_KEY_CONTENT) throw new Error();
      } catch {
        return res.status(403).json({
          error:
            "注册失败：已达到最大用户限制（5个）。如需无限用户权限，请联系管理员部署授权密钥 (license.key)。",
        });
      }
    }
  } catch {
    if (!res.headersSent) return res.status(500).json({ error: "Internal error" });
  }

  const safeUsername = username.replace(/[^a-zA-Z0-9_-]/g, "");
  if (safeUsername !== username || username.length < 3) {
    return res.status(400).json({ error: "Invalid username" });
  }

  const filePath = getUserFile(username);
  try {
    await fs.access(filePath);
    return res.status(400).json({ error: "User already exists" });
  } catch {
    // OK
  }

  const initData = await getDefaultData();
  initData.password = await bcrypt.hash(password, 10);
  cachedUsersData[username] = initData;
  await atomicWrite(filePath, JSON.stringify(initData, null, 2));

  res.json({ success: true });
});

// Upload License Key
app.post("/api/admin/license", authenticateToken, async (req, res) => {
  if (!req.user || req.user.username !== "admin") {
    return res.status(403).json({ error: "Unauthorized" });
  }
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "Missing key" });

  // Validate key format if needed, but for now just save
  // The valid key is "FLATNAS-VIP-UNLIMITED-2025"
  if (key.trim() !== "FLATNAS-VIP-UNLIMITED-2025") {
    return res.status(400).json({ error: "Invalid license key" });
  }

  try {
    const licenseFile = path.join(DATA_DIR, "license.key");
    await fs.writeFile(licenseFile, key.trim());
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to save license key" });
  }
});

// Add Bookmark
app.post("/api/add-bookmark", async (req, res) => {
  // Explicitly set CORS headers for this endpoint to ensure extension accessibility
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization",
  );
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");

  // Auth Check: Permissive for single user mode, stricter for multi
  let username = "admin";
  if (systemConfig.authMode === "multi") {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      username = decoded.username;
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  } else {
    // Single mode: if token provided, use it, else default to admin
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, SECRET_KEY);
        username = decoded.username;
      } catch {
        // ignore invalid token in single mode, use admin
      }
    }
  }

  const { title, url, icon, categoryTitle } = req.body;
  if (!title || !url) return res.status(400).json({ error: "Missing title or url" });

  // Load data
  if (!cachedUsersData[username]) {
    const filePath = getUserFile(username);
    try {
      const json = await fs.readFile(filePath, "utf-8");
      cachedUsersData[username] = JSON.parse(json);
    } catch {
      return res.status(404).json({ error: "User data not found" });
    }
  }
  const userData = cachedUsersData[username];

  // Use Top Level Groups instead of Widget
  if (!userData.groups) userData.groups = [];

  const newBookmark = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
    title,
    url,
    icon: icon || "",
  };

  let category;
  if (categoryTitle) {
    category = userData.groups.find((g) => g.title === categoryTitle);
  }

  // If category provided but not found, create it
  if (categoryTitle && !category) {
    category = {
      id: Date.now().toString(),
      title: categoryTitle,
      items: [],
      cardSize: 120,
      cardLayout: "vertical",
      gridGap: 24,
    };
    userData.groups.push(category);
  }

  if (!category) {
    category = userData.groups.find((g) => g.title === "收集箱" || g.title === "Inbox");
  }

  if (!category) {
    // If "Inbox" doesn't exist, use the first group if available, otherwise create "Inbox"
    if (userData.groups.length > 0 && !categoryTitle) {
      // If user didn't specify a category, and Inbox not found, default to first group
      category = userData.groups[0];
    } else {
      // Create new group
      category = {
        id: Date.now().toString(),
        title: "收集箱",
        items: [],
        // Default group settings
        cardSize: 120,
        cardLayout: "vertical",
        gridGap: 24,
      };
      userData.groups.push(category);
    }
  }

  if (!category.items) category.items = [];
  category.items.push(newBookmark);

  // Save
  cachedUsersData[username] = userData;
  await atomicWrite(getUserFile(username), JSON.stringify(userData, null, 2));

  // Notify clients
  io.emit("data-updated", { username });

  res.json({ success: true, message: "Bookmark added" });
});

// Save current user data as Default Template (Admin only)
app.post("/api/default/save", authenticateToken, async (req, res) => {
  if (!req.user || req.user.username !== "admin") {
    return res.status(403).json({ error: "Only admin can save default template" });
  }

  try {
    // Read admin data
    const adminFile = getUserFile("admin");
    const adminDataStr = await fs.readFile(adminFile, "utf-8");
    const adminData = JSON.parse(adminDataStr);

    // Clean up sensitive/unnecessary data for default template
    const templateData = {
      groups: adminData.groups || [],
      widgets: adminData.widgets || [],
      appConfig: adminData.appConfig || {},
      // Do NOT include password
    };

    // Write to default.json
    await atomicWrite(DEFAULT_FILE, JSON.stringify(templateData, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error("[Save Default Failed]:", err);
    res.status(500).json({ error: "Failed to save default template" });
  }
});

// Import Data (New API for Importing)
app.post("/api/data", authenticateToken, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const username = req.user.username;
  try {
    const data = req.body && typeof req.body === "object" ? { ...req.body } : null;
    if (!data || typeof data !== "object") {
      return res.status(400).json({ error: "Invalid JSON data" });
    }

    let existingPassword = "";
    if (cachedUsersData[username] && typeof cachedUsersData[username].password === "string") {
      existingPassword = cachedUsersData[username].password;
    } else {
      try {
        const json = await fs.readFile(getUserFile(username), "utf-8");
        const parsed = JSON.parse(json);
        if (parsed && typeof parsed.password === "string") existingPassword = parsed.password;
      } catch {
        existingPassword = "";
      }
    }
    if ("password" in data) delete data.password;
    if (existingPassword) data.password = existingPassword;

    // Ensure groups exist if items are present (legacy format support)
    if (!data.groups && data.items) {
      data.groups = [{ id: Date.now().toString(), title: "默认分组", items: data.items }];
    }

    cachedUsersData[username] = data;
    await atomicWrite(getUserFile(username), JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error("[Import Failed]:", err);
    res.status(500).json({ error: "Failed to import data" });
  }
});

// Save
app.post("/api/save", authenticateToken, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const username = req.user.username;
  console.log(`[Save] Saving for user: ${username}`);

  try {
    const body = req.body;
    if (!body || Object.keys(body).length === 0) {
      return res.status(400).json({ error: "Empty body" });
    }

    const currentData = cachedUsersData[username] || {};

    // Handle password update
    let newPassword = currentData.password;
    if (typeof body.password === "string" && body.password.length > 0) {
      try {
        let matched = false;
        if (typeof currentData.password === "string" && currentData.password.startsWith("$2b$")) {
          matched = await bcrypt.compare(body.password, currentData.password);
        } else {
          matched = body.password === currentData.password;
        }
        if (!matched) {
          newPassword = await bcrypt.hash(body.password, 10);
        }
      } catch (e) {
        console.error("Password process error", e);
        newPassword = currentData.password;
      }
    }
    body.password = newPassword;

    cachedUsersData[username] = body;
    await atomicWrite(getUserFile(username), JSON.stringify(body, null, 2));

    // Notify other clients
    io.emit("data-updated", { username, source: "save-api" });

    res.json({ success: true });
  } catch (err) {
    console.error("[Save Failed]:", err);
    res.status(500).json({ error: "Failed to save" });
  }
});

// Docker Status (Global)
app.get("/api/docker-status", async (req, res) => {
  try {
    const statusFile = path.join(DATA_DIR, "docker-status.json");
    const content = await fs.readFile(statusFile, "utf-8");
    res.json(JSON.parse(content));
  } catch {
    res.json({ hasUpdate: false });
  }
});

app.get("/api/rtt", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
  res.json({ success: true, ts: Date.now() });
});

// Ping
app.get("/api/ping", async (req, res) => {
  const target = req.query.target || "8.8.8.8";
  if (!/^[a-zA-Z0-9.-]+$/.test(target)) return res.status(400).json({ error: "Invalid target" });

  const isWin = os.platform() === "win32";
  const cmd = "ping";
  const args = isWin ? ["-n", "1", "-w", "2000", target] : ["-c", "1", "-W", "2", target];
  const start = performance.now();
  const proc = spawn(cmd, args);
  let output = "";

  proc.stdout.on("data", (data) => {
    output += data.toString();
  });
  proc.on("close", (code) => {
    const end = performance.now();
    if (code === 0) {
      let latency = Math.round(end - start);
      const match = output.match(/time[=<]([\d\.]+) ?ms/i) || output.match(/时间[=<]([\d\.]+) ?ms/);
      if (match && match[1]) latency = Math.round(parseFloat(match[1]));
      res.json({ success: true, latency: latency + "ms", target });
    } else {
      res.json({ success: false, latency: "Timeout", target });
    }
  });
});

// Trust Proxy Configuration
app.set("trust proxy", true); // Enable trusting X-Forwarded-For

const getClientIpInfo = (req) => {
  if (process.env.IP_HEADER) {
    const headerName = process.env.IP_HEADER.toLowerCase();
    const headerVal = req.headers[headerName];
    if (headerVal) {
      const ip = String(headerVal).split(",")[0].trim();
      return { ip, source: "header", header: headerName };
    }
  }

  const headersToCheck = [
    "cf-connecting-ip",
    "x-real-ip",
    "x-client-ip",
    "x-original-forwarded-for",
    "x-forwarded-for",
    "forwarded",
  ];

  for (const header of headersToCheck) {
    const val = req.headers[header];
    if (!val) continue;

    const raw = String(val).split(",")[0].trim();
    let ip = raw;

    if (header === "forwarded") {
      const m = raw.match(/for=(?:"?\[?([^;\]"]+)\]?"?)/i);
      if (m?.[1]) ip = m[1].trim();
    }

    ip = ip.replace(/^::ffff:/, "");
    ip = ip.replace(/^"|"$/g, "");

    if (ip) return { ip, source: "header", header };
  }

  let ip = (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  return { ip, source: "socket", header: "" };
};

// IP Proxy
app.get("/api/ip", async (req, res) => {
  const client = getClientIpInfo(req);
  const clientIp = client.ip;

  // Debug info for headers (safe to expose to admin/user in this context)
  const debugHeaders = {
    "x-forwarded-for": req.headers["x-forwarded-for"],
    "x-real-ip": req.headers["x-real-ip"],
    "cf-connecting-ip": req.headers["cf-connecting-ip"],
    "x-client-ip": req.headers["x-client-ip"],
    forwarded: req.headers["forwarded"],
    remoteAddress: req.socket.remoteAddress,
  };

  const sources = [
    { url: "https://whois.pconline.com.cn/ipJson.jsp?json=true", type: "pconline" },
    { url: "https://qifu-api.baidubce.com/ip/local/geo/v1/district", type: "baidu" },
    { url: "https://ipapi.co/json/", type: "ipapi" },
  ];

  for (const s of sources) {
    try {
      const r = await fetch(s.url);
      if (!r.ok) continue;
      const buffer = await r.arrayBuffer();
      const decoder = new TextDecoder(s.type === "pconline" ? "gbk" : "utf-8");
      const text = decoder.decode(buffer);
      let data;
      try {
        data = JSON.parse(text.trim());
      } catch {
        continue;
      }

      let ip = "",
        location = "";
      if (s.type === "pconline") {
        ip = data.ip;
        location = data.addr || data.pro + data.city;
      } else if (s.type === "baidu") {
        ip = data.ip;
        location = data.data?.prov + " " + data.data?.city;
      } else if (s.type === "ipapi") {
        ip = data.ip;
        location = data.city;
      }

      if (ip)
        return res.json({
          success: true,
          ip,
          location,
          source: s.type,
          clientIp,
          clientIpSource: client.source,
          clientIpHeader: client.header,
          debugHeaders,
        });
    } catch {
      // ignore
    }
  }
  res.json({
    success: false,
    ip: clientIp,
    location: "Unknown",
    source: "fallback",
    clientIp,
    clientIpSource: client.source,
    clientIpHeader: client.header,
    debugHeaders,
  });
});

// --- File Transfer Helper ---

// Helper to read transfer index
async function readTransferIndex() {
  try {
    const data = await fs.readFile(TRANSFER_INDEX, "utf-8");
    return JSON.parse(data);
  } catch {
    return { items: [] };
  }
}

// Helper to write transfer index
async function writeTransferIndex(data) {
  await atomicWrite(TRANSFER_INDEX, JSON.stringify(data, null, 2));
}

// GET Items
app.get("/api/transfer/items", authenticateToken, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { type, limit } = req.query;
    const data = await readTransferIndex();
    let items = data.items || [];

    if (type && type !== "all") {
      if (type === "photo") {
        items = items.filter(
          (item) =>
            item.type === "file" &&
            item.file &&
            item.file.type &&
            item.file.type.startsWith("image/"),
        );
      } else {
        items = items.filter((item) => item.type === type);
      }
    }

    // Sort by timestamp desc
    items.sort((a, b) => b.timestamp - a.timestamp);

    if (limit) {
      items = items.slice(0, parseInt(limit));
    }

    res.json({ success: true, items });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST Text
app.post("/api/transfer/text", authenticateToken, express.json(), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Text required" });

    const newItem = {
      id: crypto.randomUUID(),
      type: "text",
      content: text,
      timestamp: Date.now(),
      sender: req.user.username,
    };

    const data = await readTransferIndex();
    if (!data.items) data.items = [];
    data.items.unshift(newItem);
    // Limit total items
    if (data.items.length > 1000) data.items = data.items.slice(0, 1000);

    await writeTransferIndex(data);
    res.json({ success: true, item: newItem });
    setTimeout(() => {
      io.emit("transfer:update", { type: "add", item: newItem });
    }, 0);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Upload Init
app.post("/api/transfer/upload/init", authenticateToken, express.json(), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { fileName, size, mime, fileKey, chunkSize } = req.body;
    const uploadId = crypto.randomUUID();
    const uploadDir = path.join(TRANSFER_CHUNKS, uploadId);
    await ensureDir(uploadDir);

    // Store metadata
    const meta = {
      fileName,
      size,
      mime,
      fileKey,
      chunkSize,
      uploadId,
      startTime: Date.now(),
      sender: req.user.username,
    };
    await fs.writeFile(path.join(uploadDir, "meta.json"), JSON.stringify(meta));

    res.json({
      success: true,
      uploadId,
      chunkSize,
      totalChunks: Math.ceil(size / chunkSize),
      uploaded: [],
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Upload Chunk
// Use multer for multipart/form-data
const chunkUpload = multer({ dest: os.tmpdir() });
app.post(
  "/api/transfer/upload/chunk",
  authenticateToken,
  chunkUpload.single("chunk"),
  async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { uploadId, index } = req.body;
      const file = req.file;

      if (!uploadId || index === undefined || !file) {
        return res.status(400).json({ error: "Missing parameters" });
      }

      const uploadDir = path.join(TRANSFER_CHUNKS, uploadId);
      // Validate uploadDir exists
      try {
        await fs.access(uploadDir);
      } catch {
        return res.status(404).json({ error: "Upload session not found" });
      }

      const chunkPath = path.join(uploadDir, `${index}.part`);

      // Move file
      await fs.copyFile(file.path, chunkPath);
      await fs.unlink(file.path);

      res.json({ success: true });
    } catch (e) {
      console.error("Chunk upload error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  },
);

// Upload Complete
app.post("/api/transfer/upload/complete", authenticateToken, express.json(), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { uploadId } = req.body;
    const uploadDir = path.join(TRANSFER_CHUNKS, uploadId);

    // Read meta
    const metaPath = path.join(uploadDir, "meta.json");
    const metaData = JSON.parse(await fs.readFile(metaPath, "utf-8"));

    const { fileName, size, mime, sender } = metaData;
    const totalChunks = Math.ceil(size / metaData.chunkSize);

    // Verify all chunks
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(uploadDir, `${i}.part`);
      try {
        await fs.access(chunkPath);
      } catch {
        return res.status(400).json({ error: `Missing chunk ${i}` });
      }
    }

    // Merge chunks
    const finalFileName = `${Date.now()}_${fileName}`;
    const finalPath = path.join(TRANSFER_UPLOADS, finalFileName);

    await fs.writeFile(finalPath, Buffer.alloc(0));

    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(uploadDir, `${i}.part`);
      const chunkBuffer = await fs.readFile(chunkPath);
      await fs.appendFile(finalPath, chunkBuffer);
    }

    // Clean up chunks
    try {
      await fs.rm(uploadDir, { recursive: true, force: true });
    } catch (e) {
      console.error("Failed to clean up chunks:", e);
    }

    // Add to index
    const newItem = {
      id: crypto.randomUUID(),
      type: "file",
      file: {
        name: fileName,
        size: size,
        type: mime,
        url: `/api/transfer/file/${finalFileName}`,
      },
      timestamp: Date.now(),
      sender: sender,
    };

    const data = await readTransferIndex();
    if (!data.items) data.items = [];
    data.items.unshift(newItem);
    if (data.items.length > 1000) data.items = data.items.slice(0, 1000);
    await writeTransferIndex(data);

    res.json({ success: true, item: newItem });
    setTimeout(() => {
      io.emit("transfer:update", { type: "add", item: newItem });
    }, 0);
  } catch (e) {
    console.error("Complete upload error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/api/transfer/download-token", authenticateToken, express.json(), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    const url = req.body?.url;
    if (typeof url !== "string") return res.status(400).json({ success: false, error: "Bad url" });
    if (!url.startsWith("/api/transfer/file/")) {
      return res.status(400).json({ success: false, error: "Bad url" });
    }

    const filename = url.split("/").pop() || "";
    if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return res.status(400).json({ success: false, error: "Bad filename" });
    }

    const token = jwt.sign(
      { username: req.user.username, scope: "transfer:download", filename },
      SECRET_KEY,
      { expiresIn: "60s" },
    );

    res.json({ success: true, token });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Serve Files
app.get("/api/transfer/file/:filename", authenticateToken, async (req, res) => {
  const { filename } = req.params;
  // Security check
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return res.status(403).send("Invalid filename");
  }

  if (!req.user) {
    const urlToken = req.query.token;
    if (typeof urlToken === "string" && urlToken) {
      try {
        const decoded = jwt.verify(urlToken, SECRET_KEY);
        if (
          decoded &&
          typeof decoded === "object" &&
          decoded.scope === "transfer:download" &&
          decoded.filename === filename &&
          typeof decoded.username === "string"
        ) {
          req.user = { username: decoded.username };
        }
      } catch {
        // ignore
      }
    }
  }

  if (!req.user) return res.status(401).send("Unauthorized");

  const filePath = path.join(TRANSFER_UPLOADS, filename);
  try {
    await fs.access(filePath);

    if (req.query.download) {
      res.download(filePath);
    } else {
      res.sendFile(filePath);
    }
  } catch {
    res.status(404).send("File not found");
  }
});

// Delete Item
app.delete("/api/transfer/items/:id", authenticateToken, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { id } = req.params;
    const data = await readTransferIndex();
    if (!data.items) return res.json({ success: true });

    const item = data.items.find((x) => x.id === id);
    if (!item) return res.json({ success: true });

    // Remove from index
    data.items = data.items.filter((x) => x.id !== id);
    await writeTransferIndex(data);

    // If file, delete file
    if (item.type === "file" && item.file && item.file.url) {
      const parts = item.file.url.split("/");
      const filename = parts[parts.length - 1];
      if (filename) {
        const filePath = path.join(TRANSFER_UPLOADS, filename);
        try {
          await fs.unlink(filePath);
        } catch (e) {
          console.error("Failed to delete file:", e);
        }
      }
    }

    res.json({ success: true });
    setTimeout(() => {
      io.emit("transfer:update", { type: "delete", id });
    }, 0);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Lucky STUN Cache
let LUCKY_STUN_CACHE = {
  ts: 0,
  data: null,
};

// Lucky STUN Webhook
app.post("/api/webhook/lucky/stun", (req, res) => {
  try {
    const data = req.body;
    console.log("[Lucky STUN Webhook] Received data:", JSON.stringify(data));

    LUCKY_STUN_CACHE = {
      ts: Date.now(),
      data: data,
    };

    // Emit to all connected clients
    io.emit("lucky:stun", LUCKY_STUN_CACHE);

    res.json({ success: true, message: "Webhook received" });
  } catch (error) {
    console.error("[Lucky STUN Webhook] Error:", error);
    res.status(500).json({ error: "Failed to process webhook" });
  }
});

// Get Lucky STUN Status
app.get("/api/lucky/stun", (req, res) => {
  res.json(LUCKY_STUN_CACHE);
});

// Weather Helper
async function fetchWeatherFromWttr(city) {
  const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`);
  if (!response.ok) throw new Error("Weather API error");
  const data = await response.json();
  const current = data.current_condition[0];
  const text = current.lang_zh?.[0]?.value || current.weatherDesc[0].value;
  return {
    temp: current.temp_C,
    text: text,
    city: city,
    humidity: current.humidity,
    windDir: current.winddir16Point,
    windSpeed: current.windspeedKmph,
    feelsLike: current.FeelsLikeC,
    today: data.weather?.[0]
      ? {
          min: data.weather[0].mintempC,
          max: data.weather[0].maxtempC,
          uv: data.weather[0].uvIndex,
        }
      : null,
    forecast: data.weather || [],
  };
}

async function incrementAmapCount() {
  try {
    let stats = { total: 0, today: 0, lastDate: new Date().toISOString().split("T")[0] };
    try {
      const data = await fs.readFile(AMAP_STATS_FILE, "utf8");
      stats = JSON.parse(data);
    } catch {
      // File not found or invalid, use default
    }

    const today = new Date().toISOString().split("T")[0];
    if (stats.lastDate !== today) {
      stats.today = 0;
      stats.lastDate = today;
    }

    stats.total += 1;
    stats.today += 1;

    await fs.writeFile(AMAP_STATS_FILE, JSON.stringify(stats));
  } catch (e) {
    console.error("Failed to update AMap stats:", e);
  }
}

async function fetchWeatherFromAMap(city, key) {
  if (!key) throw new Error("AMap Key required");

  let adcode = city;
  let cityName = city;

  // If city is auto/empty or looks like a name (not numeric), resolve it
  if (!city || city === "auto" || city === "本地" || !/^\d+$/.test(city)) {
    if (!city || city === "auto" || city === "本地") {
      // IP Location
      await incrementAmapCount();
      const ipRes = await fetch(`https://restapi.amap.com/v3/ip?key=${key}`);
      const ipData = await ipRes.json();
      if (ipData.status !== "1") throw new Error("AMap IP Location failed: " + ipData.info);
      adcode = ipData.adcode;
      cityName = ipData.city;
    } else {
      // Geocoding
      await incrementAmapCount();
      const geoRes = await fetch(
        `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(city)}&key=${key}`,
      );
      const geoData = await geoRes.json();
      if (geoData.status !== "1" || !geoData.geocodes?.length)
        throw new Error("AMap Geocoding failed");
      adcode = geoData.geocodes[0].adcode;
      cityName = geoData.geocodes[0].city || city;
    }
  }

  // Weather Info (All = Forecast + Current)
  await incrementAmapCount();
  const weatherRes = await fetch(
    `https://restapi.amap.com/v3/weather/weatherInfo?city=${adcode}&key=${key}&extensions=all`,
  );
  const weatherData = await weatherRes.json();
  if (weatherData.status !== "1" || !weatherData.forecasts?.length)
    throw new Error("AMap Weather failed");

  const forecast = weatherData.forecasts[0];
  const today = forecast.casts?.[0];
  await incrementAmapCount();
  const currentLiveRes = await fetch(
    `https://restapi.amap.com/v3/weather/weatherInfo?city=${adcode}&key=${key}&extensions=base`,
  );
  const currentLiveData = await currentLiveRes.json();
  const current = currentLiveData.lives?.[0] || {};

  // Map to common format
  return {
    temp: current.temperature || today.daytemp,
    text: current.weather || today.dayweather,
    city: cityName || forecast.city,
    humidity: current.humidity,
    windDir: current.winddirection || today.daywind,
    windSpeed: current.windpower || today.daypower,
    feelsLike: current.temperature, // AMap doesn't provide feelsLike in base API
    today: today
      ? {
          min: today.nighttemp,
          max: today.daytemp,
          uv: "0", // AMap doesn't provide UV in basic free API
        }
      : null,
    forecast: forecast.casts.map((c) => ({
      date: c.date,
      maxtempC: c.daytemp,
      mintempC: c.nighttemp,
      uvIndex: "0",
    })),
  };
}

const QWEATHER_GEO_CACHE = new Map(); // CityName -> LocationID
const QWEATHER_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function fetchWeatherFromQWeather(city, projectId, keyId, privateKey) {
  if (!projectId || !keyId || !privateKey) throw new Error("QWeather credentials required");

  // Auto-format Private Key if needed
  let finalKey = privateKey.trim();
  if (!finalKey.startsWith("-----BEGIN PRIVATE KEY-----")) {
    finalKey = `-----BEGIN PRIVATE KEY-----\n${finalKey}\n-----END PRIVATE KEY-----`;
  }

  // Manual JWT Generation (Bypassing jsonwebtoken library checks for EdDSA)
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", kid: keyId };
  const payload = {
    iss: projectId,
    iat: now,
    exp: now + 900, // 15 mins
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto.sign(null, Buffer.from(data), finalKey);
  const encodedSignature = signature
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const token = `${data}.${encodedSignature}`;

  const headers = { Authorization: `Bearer ${token}` };

  // Resolve City
  let locationId = "";
  let cityName = city;

  if (!city || city === "auto" || city === "本地") {
    // 优先使用国内 IP 定位源，提高速度
    try {
      // 尝试 pconline (太平洋电脑网)，速度通常较快
      const res = await fetch("https://whois.pconline.com.cn/ipJson.jsp?json=true");
      const buffer = await res.arrayBuffer();
      const decoder = new TextDecoder("gbk");
      const text = decoder.decode(buffer);
      const data = JSON.parse(text.trim());
      if (data.city) {
        cityName = data.city;
      } else {
        throw new Error("No city found");
      }
    } catch {
      // Fallback to ipapi.co (slower)
      try {
        const ipRes = await fetch("https://ipapi.co/json/");
        if (ipRes.ok) {
          const ipData = await ipRes.json();
          cityName = ipData.city || "Beijing";
        } else {
          cityName = "Beijing";
        }
      } catch {
        cityName = "Beijing";
      }
    }
  }

  // Check Cache for Location ID
  const cacheKey = cityName.toLowerCase();
  if (QWEATHER_GEO_CACHE.has(cacheKey)) {
    const cached = QWEATHER_GEO_CACHE.get(cacheKey);
    if (Date.now() - cached.ts < QWEATHER_CACHE_TTL) {
      locationId = cached.id;
      // cityName = cached.name; // Keep original query name or use cached official name?
    }
  }

  if (!locationId) {
    // Lookup Location ID
    const geoUrl = `https://geoapi.qweather.com/v2/city/lookup?location=${encodeURIComponent(cityName)}`;
    const geoRes = await fetch(geoUrl, { headers });
    if (!geoRes.ok) throw new Error("QWeather GeoAPI failed");
    const geoData = await geoRes.json();
    if (geoData.code !== "200" || !geoData.location?.length)
      throw new Error("QWeather City Lookup failed");

    locationId = geoData.location[0].id;
    cityName = geoData.location[0].name; // Use official name

    // Cache it
    QWEATHER_GEO_CACHE.set(cacheKey, { id: locationId, name: cityName, ts: Date.now() });
  }

  // Fetch Weather and Forecast in Parallel
  const weatherUrl = `https://devapi.qweather.com/v7/weather/now?location=${locationId}`;
  const forecastUrl = `https://devapi.qweather.com/v7/weather/3d?location=${locationId}`;

  const [weatherRes, forecastRes] = await Promise.all([
    fetch(weatherUrl, { headers }),
    fetch(forecastUrl, { headers }),
  ]);

  if (!weatherRes.ok) throw new Error("QWeather Weather API failed");
  const weatherData = await weatherRes.json();
  if (weatherData.code !== "200")
    throw new Error("QWeather API returned error: " + weatherData.code);

  const nowData = weatherData.now;

  let today = { min: "", max: "" };
  let forecast = [];
  if (forecastRes.ok) {
    const forecastData = await forecastRes.json();
    if (forecastData.code === "200" && forecastData.daily) {
      const d = forecastData.daily[0];
      today = { min: d.tempMin, max: d.tempMax };
      forecast = forecastData.daily.map((day) => ({
        date: day.fxDate,
        mintempC: day.tempMin,
        maxtempC: day.tempMax,
      }));
    }
  }

  return {
    temp: nowData.temp,
    text: nowData.text,
    city: cityName,
    humidity: nowData.humidity + "%",
    windDir: nowData.windDir,
    windSpeed: nowData.windScale,
    today: today,
    forecast: forecast,
  };
}

// Weather
app.get("/api/weather", async (req, res) => {
  const city = req.query.city || "";
  const source = req.query.source || "wttr";
  const key = req.query.key || "";
  const projectId = req.query.projectId || "";
  const keyId = req.query.keyId || "";
  const privateKey = req.query.privateKey || "";

  // Allow "auto" or empty city to mean "local"
  // if (!city) return res.status(400).json({ error: "City is required" });

  try {
    let data;
    if (source === "amap" && key) {
      data = await fetchWeatherFromAMap(city, key);
    } else if (source === "qweather") {
      data = await fetchWeatherFromQWeather(city, projectId, keyId, privateKey);
    } else {
      // Default to wttr.in
      // If city is empty/auto for wttr, it uses requester IP automatically
      const queryCity = !city || city === "auto" || city === "本地" ? "" : city;
      data = await fetchWeatherFromWttr(queryCity);
    }

    res.json({ success: true, data });
  } catch (e) {
    console.error("Weather Error:", e.message);
    res.status(500).json({ error: "Failed to fetch weather data: " + e.message });
  }
});

app.post("/api/data/import", authenticateToken, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const username = req.user.username;
  try {
    const data = req.body && typeof req.body === "object" ? { ...req.body } : null;
    if (!data || typeof data !== "object") {
      return res.status(400).json({ error: "Invalid JSON data" });
    }

    let existingPassword = "";
    if (cachedUsersData[username] && typeof cachedUsersData[username].password === "string") {
      existingPassword = cachedUsersData[username].password;
    } else {
      try {
        const json = await fs.readFile(getUserFile(username), "utf-8");
        const parsed = JSON.parse(json);
        if (parsed && typeof parsed.password === "string") existingPassword = parsed.password;
      } catch {
        existingPassword = "";
      }
    }
    if ("password" in data) delete data.password;
    if (existingPassword) data.password = existingPassword;

    if (!data.groups && data.items) {
      data.groups = [{ id: Date.now().toString(), title: "默认分组", items: data.items }];
    }

    cachedUsersData[username] = data;
    await atomicWrite(getUserFile(username), JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error("[Import Failed]:", err);
    res.status(500).json({ error: "Failed to import" });
  }
});

// Reset
app.post("/api/reset", authenticateToken, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const username = req.user.username;
  try {
    const initData = await getDefaultData();
    // Keep password
    initData.password = cachedUsersData[username].password;
    cachedUsersData[username] = initData;
    await atomicWrite(getUserFile(username), JSON.stringify(initData, null, 2));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to reset" });
  }
});

// Weibo/News (Global Cache)
app.get("/api/hot/weibo", async (req, res) => {
  // ... (keep existing logic) ...
  try {
    const force = req.query.force === "1";
    if (!force && HOT_CACHE.weibo.data.length && Date.now() - HOT_CACHE.weibo.ts < CACHE_TTL_MS) {
      return res.json(HOT_CACHE.weibo.data);
    }
    const r = await fetch("https://weibo.com/ajax/side/hotSearch", {
      headers: { "User-Agent": "Mozilla/5.0...", Referer: "https://weibo.com/" },
    });
    const j = await r.json();
    const items = (j.data.realtime || []).map((x) => ({
      title: x.word,
      url: "https://s.weibo.com/weibo?q=" + encodeURIComponent(x.word),
      hot: x.num,
    }));
    HOT_CACHE.weibo = { ts: Date.now(), data: items };
    res.json(items);
  } catch {
    res.json(HOT_CACHE.weibo.data);
  }
});

app.get("/api/hot/news", async (req, res) => {
  // ... (simplified for brevity, assume similar to before)
  try {
    const feed = await rssParser.parseURL("https://www.chinanews.com.cn/rss/scroll-news.xml");
    const items = (feed.items || [])
      .slice(0, 50)
      .map((i) => ({ title: i.title, url: i.link, time: i.pubDate }));
    HOT_CACHE.news = { ts: Date.now(), data: items };
    res.json(items);
  } catch {
    res.json(HOT_CACHE.news.data);
  }
});

// Serve music files statically
app.use("/music", express.static(MUSIC_DIR));
app.use("/backgrounds", express.static(BACKGROUNDS_DIR));
app.use("/mobile_backgrounds", express.static(MOBILE_BACKGROUNDS_DIR));
app.use("/icon-cache", express.static(ICON_CACHE_DIR));

// Get backgrounds list
app.get("/api/backgrounds", async (req, res) => {
  try {
    const files = await fs.readdir(BACKGROUNDS_DIR);
    const bgFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif"].includes(ext);
    });
    res.json(bgFiles);
  } catch (err) {
    console.error("Failed to read backgrounds dir", err);
    res.json([]);
  }
});

// Upload Background
const bgStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, BACKGROUNDS_DIR);
  },
  filename: function (req, file, cb) {
    const name = Buffer.from(file.originalname, "latin1").toString("utf8");
    cb(null, name);
  },
});
const bgUpload = multer({ storage: bgStorage });

// Download Bing Wallpaper
app.post("/api/backgrounds/bing", authenticateToken, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    // 1. Get Bing Image URL
    const bingRes = await fetch(
      "https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN",
    );
    const bingData = await bingRes.json();
    if (!bingData.images || bingData.images.length === 0) {
      return res.status(500).json({ error: "Failed to fetch Bing image info" });
    }

    const imageBaseUrl = bingData.images[0].url;
    const imageUrl = imageBaseUrl.startsWith("http")
      ? imageBaseUrl
      : `https://cn.bing.com${imageBaseUrl}`;
    const dateStr = bingData.images[0].enddate; // YYYYMMDD
    const filename = `bing_${dateStr}.jpg`;
    const savePath = path.join(BACKGROUNDS_DIR, filename);

    // 2. Check if already exists
    try {
      await fs.access(savePath);
      // If exists, just return success
      return res.json({ success: true, filename, existed: true });
    } catch {
      // Not exists, download
    }

    // 3. Download
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("Failed to download image");
    const arrayBuffer = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await fs.writeFile(savePath, buffer);

    res.json({ success: true, filename });
  } catch (err) {
    console.error("Bing Wallpaper Error:", err);
    res.status(500).json({ error: "Failed to download Bing wallpaper" });
  }
});

app.post("/api/backgrounds/upload", authenticateToken, bgUpload.array("files"), (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  res.json({ success: true, count: req.files.length });
});

// Delete Background
app.delete("/api/backgrounds/:filename", authenticateToken, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const filename = req.params.filename;
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  try {
    await fs.unlink(path.join(BACKGROUNDS_DIR, filename));
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to delete background", err);
    res.status(500).json({ error: "Failed to delete background" });
  }
});

// === Mobile Backgrounds ===

// Get mobile backgrounds list
app.get("/api/mobile_backgrounds", async (req, res) => {
  try {
    const files = await fs.readdir(MOBILE_BACKGROUNDS_DIR);
    const bgFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif"].includes(ext);
    });
    res.json(bgFiles);
  } catch (err) {
    console.error("Failed to read mobile backgrounds dir", err);
    res.json([]);
  }
});

// Upload Mobile Background
const mobileBgStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, MOBILE_BACKGROUNDS_DIR);
  },
  filename: function (req, file, cb) {
    const name = Buffer.from(file.originalname, "latin1").toString("utf8");
    cb(null, name);
  },
});
const mobileBgUpload = multer({ storage: mobileBgStorage });

app.post(
  "/api/mobile_backgrounds/upload",
  authenticateToken,
  mobileBgUpload.array("files"),
  (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    res.json({ success: true, count: req.files.length });
  },
);

// Delete Mobile Background
app.delete("/api/mobile_backgrounds/:filename", authenticateToken, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const filename = req.params.filename;
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  try {
    await fs.unlink(path.join(MOBILE_BACKGROUNDS_DIR, filename));
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to delete mobile background", err);
    res.status(500).json({ error: "Failed to delete mobile background" });
  }
});

// Get icons list
app.get("/api/icons", async (req, res) => {
  try {
    const iconsDir = path.join(__dirname, "../public/icons");
    // Check if directory exists
    try {
      await fs.access(iconsDir);
    } catch {
      return res.json([]);
    }

    const files = await fs.readdir(iconsDir);
    const iconFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".ico"].includes(ext);
    });
    res.json(iconFiles);
  } catch (err) {
    console.error("Failed to read icons dir", err);
    res.status(500).json({ error: "Failed to read icons" });
  }
});

// Helper to recursively get music files
async function getMusicFilesRecursively(dir, baseDir = "") {
  let results = [];
  try {
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const file of list) {
      const relativePath = baseDir ? path.join(baseDir, file.name) : file.name;
      if (file.isDirectory()) {
        const subResults = await getMusicFilesRecursively(path.join(dir, file.name), relativePath);
        results = results.concat(subResults);
      } else {
        results.push(relativePath);
      }
    }
  } catch (err) {
    console.error("Error reading dir " + dir, err);
  }
  return results;
}

// Get music list
app.get("/api/music-list", async (req, res) => {
  try {
    const files = await getMusicFilesRecursively(MUSIC_DIR);
    const musicFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [".mp3", ".wav", ".ogg", ".m4a", ".flac"].includes(ext);
    });
    // Normalize paths to use forward slashes for cross-platform consistency in JSON
    const normalizedFiles = musicFiles.map((f) => f.split(path.sep).join("/"));
    res.json(normalizedFiles);
  } catch (err) {
    console.error("Failed to read music dir", err);
    res.json([]);
  }
});

// Upload Music
app.post("/api/music/upload", authenticateToken, upload.array("files"), (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  res.json({ success: true, count: req.files.length });
});

// Visitor Track
const VISITOR_FILE = path.join(DATA_DIR, "visitors.json");
let visitorStats = { total: 0, today: 0, lastDate: "" };

// Load stats
(async () => {
  try {
    const data = await fs.readFile(VISITOR_FILE, "utf-8");
    visitorStats = JSON.parse(data);
  } catch {
    // ignore
  }
})();

app.post("/api/visitor/track", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  if (visitorStats.lastDate !== today) {
    visitorStats.lastDate = today;
    visitorStats.today = 0;
  }
  visitorStats.total++;
  visitorStats.today++;

  // Save async (don't await to be fast)
  atomicWrite(VISITOR_FILE, JSON.stringify(visitorStats)).catch(console.error);

  res.json({
    success: true,
    totalVisitors: visitorStats.total,
    todayVisitors: visitorStats.today,
  });
});

// Fetch Meta
app.get("/api/fetch-meta", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    // 1. Basic URL validation
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`Fetch meta failed: ${response.status} ${response.statusText} for ${url}`);
      return res.json({ title: "", icon: "" });
    }

    // 2. Check content type
    const contentType = response.headers.get("content-type");
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      console.warn(`Skipping non-html content: ${contentType} for ${url}`);
      return res.json({ title: "", icon: "" });
    }

    // 3. Limit response size (read only first 100KB)
    let html = "";
    try {
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let receivedLength = 0;
        const MAX_LENGTH = 100 * 1024; // 100KB

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedLength += value.length;
          html += decoder.decode(value, { stream: true });
          if (receivedLength > MAX_LENGTH) {
            await reader.cancel(); // Close stream
            break;
          }
        }
        html += decoder.decode(); // flush
      } else {
        // Fallback if no body
        html = await response.text();
      }
    } catch (readError) {
      console.error("Error reading response body:", readError);
      // continue with whatever we have
    }

    // Extract Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    // Extract Icon
    let icon = "";
    // Match rel="icon" or rel="shortcut icon"
    const iconMatch = html.match(
      /<link[^>]+rel=["'](?:shortcut\s+)?icon["'][^>]+href=["']([^"']+)["']/i,
    );

    if (iconMatch) {
      icon = iconMatch[1];
      // Handle relative URLs
      if (!icon.startsWith("http")) {
        try {
          const urlObj = new URL(url);
          if (icon.startsWith("//")) {
            icon = urlObj.protocol + icon;
          } else if (icon.startsWith("/")) {
            icon = urlObj.origin + icon;
          } else {
            // relative to current path
            icon = new URL(icon, url).href;
          }
        } catch (e) {
          console.error("Error resolving icon URL:", e);
        }
      }
    }

    res.json({ title, icon });
  } catch (error) {
    console.error("Fetch meta error:", error);
    // Do not return 500, return empty result to prevent frontend error
    res.json({ title: "", icon: "" });
  }
});

// Fetch Icon and convert to Base64
app.get("/api/get-icon-base64", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: "URL is required" });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(404).json({ error: "Failed to fetch icon" });
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = `data:${contentType};base64,${buffer.toString("base64")}`;

    res.json({ success: true, icon: base64 });
  } catch (error) {
    console.error("Fetch icon base64 error:", error);
    res.status(500).json({ error: "Failed to process icon" });
  }
});

const ICON_CACHE_MAX_BYTES = 1024 * 1024;

const readStreamToBuffer = async (stream, maxBytes) => {
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const buf = Buffer.from(value);
    total += buf.length;
    if (total > maxBytes) throw new Error("Icon too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
};

const inferExtFromType = (contentType) => {
  const ct = String(contentType || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (ct === "image/svg+xml") return "svg";
  if (ct === "image/x-icon" || ct === "image/vnd.microsoft.icon") return "ico";
  if (ct === "image/png") return "png";
  if (ct === "image/jpeg") return "jpg";
  if (ct === "image/webp") return "webp";
  if (ct === "image/gif") return "gif";
  return "";
};

const inferExtFromUrl = (url) => {
  try {
    const pathname = new URL(url).pathname || "";
    const ext = path.extname(pathname).toLowerCase().replace(".", "");
    if (["svg", "ico", "png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
      return ext === "jpeg" ? "jpg" : ext;
    }
  } catch {
    // ignore
  }
  return "";
};

const parseDataUrl = (dataUrl) => {
  const m = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!m) return null;
  const mime = (m[1] || "application/octet-stream").trim();
  const isBase64 = Boolean(m[2]);
  const payload = m[3] || "";
  try {
    const buffer = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return { buffer, mime };
  } catch {
    return null;
  }
};

app.post("/api/icon-cache", async (req, res) => {
  const url = req.body && typeof req.body.url === "string" ? req.body.url.trim() : "";
  const dataUrl = req.body && typeof req.body.dataUrl === "string" ? req.body.dataUrl.trim() : "";

  if (!url && !dataUrl)
    return res.status(400).json({ success: false, error: "url or dataUrl is required" });

  try {
    let buffer;
    let contentType = "";
    let extFromType = "";
    let extFromUrl = "";

    if (dataUrl) {
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) return res.status(400).json({ success: false, error: "Invalid dataUrl" });
      buffer = parsed.buffer;
      contentType = parsed.mime;
      extFromType = inferExtFromType(contentType);
    } else {
      if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ success: false, error: "Only http/https url is allowed" });
      }

      const doFetch = async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          return await fetch(url, {
            signal: controller.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            },
          });
        } finally {
          clearTimeout(timeout);
        }
      };

      let response;
      try {
        response = await doFetch();
      } catch {
        await new Promise((r) => setTimeout(r, 200));
        response = await doFetch();
      }

      if (!response.ok) {
        return res.status(404).json({ success: false, error: "Failed to fetch icon" });
      }

      contentType = response.headers.get("content-type") || "";
      extFromType = inferExtFromType(contentType);
      extFromUrl = inferExtFromUrl(url);
      buffer = await readStreamToBuffer(response.body, ICON_CACHE_MAX_BYTES);
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ success: false, error: "Empty icon" });
    }
    if (buffer.length > ICON_CACHE_MAX_BYTES) {
      return res.status(413).json({ success: false, error: "Icon too large" });
    }

    const ext = extFromType || extFromUrl || "png";
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const filename = `${hash.slice(0, 32)}.${ext}`;
    const filePath = path.join(ICON_CACHE_DIR, filename);

    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, buffer);
    }

    res.json({ success: true, path: `/icon-cache/${filename}`, bytes: buffer.length, contentType });
  } catch (error) {
    console.error("[IconCache] Failed:", error);
    res.status(500).json({ success: false, error: "Failed to cache icon" });
  }
});

// RSS Parse
app.get("/api/rss/parse", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    // Set a timeout for the RSS request
    const feed = await Promise.race([
      rssParser.parseURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10000)),
    ]);
    res.json(feed);
  } catch (err) {
    console.error(`Failed to parse RSS: ${url}`, err);
    res.status(500).json({ error: "Failed to parse RSS feed" });
  }
});

// Serve static frontend files (Production/Docker)
const DIST_DIR = path.join(__dirname, "../dist");
const INDEX_HTML = path.join(DIST_DIR, "index.html");

try {
  await fs.access(INDEX_HTML);
  app.use(express.static(DIST_DIR));

  // Handle SPA routing - return index.html for all other routes
  app.get(/(.*)/, (req, res) => {
    res.sendFile(INDEX_HTML);
  });
} catch {
  console.log("Frontend build not found, running in API-only mode");
  app.get("/", (req, res) => {
    res.send("FlatNas API Server Running");
  });
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // RSS Fetch
  socket.on("rss:fetch", async ({ url }) => {
    try {
      if (!url) throw new Error("URL required");
      const feed = await Promise.race([
        rssParser.parseURL(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10000)),
      ]);
      socket.emit("rss:data", { url, data: feed });
    } catch (err) {
      console.error(`RSS Socket Error [${url}]:`, err.message);
      socket.emit("rss:error", { url, error: err.message });
    }
  });

  // Weather Fetch
  socket.on("weather:fetch", async ({ city, source, key, projectId, keyId, privateKey }) => {
    try {
      let data;
      if (source === "amap" && key) {
        data = await fetchWeatherFromAMap(city, key);
      } else if (source === "qweather") {
        data = await fetchWeatherFromQWeather(city, projectId, keyId, privateKey);
      } else {
        const queryCity = !city || city === "auto" || city === "本地" ? "" : city;
        data = await fetchWeatherFromWttr(queryCity);
      }

      socket.emit("weather:data", { city, data });
    } catch (err) {
      console.error(`Weather Socket Error [${city}]:`, err.message);
      socket.emit("weather:error", { city, error: err.message });
    }
  });

  // Hot Search Fetch
  socket.on("hot:fetch", async (payload) => {
    try {
      const type = payload && typeof payload.type === "string" ? payload.type : "";
      const force = Boolean(payload && payload.force);

      if (type === "custom") {
        const cfg =
          payload && payload.custom && typeof payload.custom === "object" ? payload.custom : {};

        const url = typeof cfg.url === "string" ? cfg.url.trim() : "";
        if (!/^https?:\/\//i.test(url)) throw new Error("Invalid URL");

        const method = typeof cfg.method === "string" ? cfg.method.toUpperCase().trim() : "GET";
        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          ...toPlainHeaders(cfg.headers),
        };

        const listPath = typeof cfg.listPath === "string" ? cfg.listPath.trim() : "";
        const titlePath = typeof cfg.titlePath === "string" ? cfg.titlePath.trim() : "";
        const urlPath = typeof cfg.urlPath === "string" ? cfg.urlPath.trim() : "";
        const hotPath = typeof cfg.hotPath === "string" ? cfg.hotPath.trim() : "";
        const urlPrefix = typeof cfg.urlPrefix === "string" ? cfg.urlPrefix.trim() : "";

        const cacheKey = `${method}|${url}|${listPath}|${titlePath}|${urlPath}|${hotPath}|${urlPrefix}`;
        const cached = HOT_CACHE.custom.get(cacheKey);
        if (
          !force &&
          cached &&
          cached.data &&
          cached.data.length &&
          Date.now() - cached.ts < CACHE_TTL_MS
        ) {
          socket.emit("hot:data", { type, data: cached.data });
          return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let r;
        try {
          const init = {
            method: method === "POST" ? "POST" : "GET",
            headers,
            signal: controller.signal,
          };
          if (init.method === "POST") {
            const bodyText = typeof cfg.body === "string" ? cfg.body.trim() : "";
            if (bodyText) {
              init.body = bodyText;
              const hasContentType = Object.keys(headers).some(
                (k) => k.toLowerCase() === "content-type",
              );
              if (!hasContentType) headers["Content-Type"] = "application/json";
            }
          }
          r = await fetch(url, init);
        } finally {
          clearTimeout(timeout);
        }

        if (!r || !r.ok) throw new Error("Fetch failed");
        const contentType = String(r.headers.get("content-type") || "").toLowerCase();
        const encoding = contentType.includes("charset=gbk") ? "gbk" : "utf-8";
        const rawText = await readStreamToText(r.body, 1024 * 1024, encoding);
        const json = safeJsonParse(rawText);
        if (!json || typeof json !== "object") throw new Error("Invalid JSON");

        const listRaw = listPath ? getByPath(json, listPath) : undefined;
        const arr = Array.isArray(listRaw)
          ? listRaw
          : Array.isArray(json.data)
            ? json.data
            : Array.isArray(json.items)
              ? json.items
              : Array.isArray(json.list)
                ? json.list
                : [];

        const items = arr
          .slice(0, 50)
          .map((x) => {
            const title =
              (titlePath ? getByPath(x, titlePath) : undefined) ??
              (x && typeof x === "object" ? (x.title ?? x.word ?? x.name) : undefined);
            const link =
              (urlPath ? getByPath(x, urlPath) : undefined) ??
              (x && typeof x === "object" ? (x.url ?? x.link ?? x.href) : undefined);
            const hot =
              (hotPath ? getByPath(x, hotPath) : undefined) ??
              (x && typeof x === "object" ? (x.hot ?? x.num ?? x.rank) : undefined);

            const titleStr = title == null ? "" : String(title).trim();
            let linkStr = link == null ? "" : String(link).trim();
            if (linkStr && urlPrefix && !/^https?:\/\//i.test(linkStr)) {
              if (linkStr.startsWith("/")) linkStr = urlPrefix.replace(/\/$/, "") + linkStr;
              else linkStr = urlPrefix.replace(/\/$/, "") + "/" + linkStr;
            }

            return {
              title: titleStr,
              url: linkStr || "#",
              hot: hot == null ? "" : hot,
            };
          })
          .filter((x) => x.title);

        HOT_CACHE.custom.set(cacheKey, { ts: Date.now(), data: items });
        socket.emit("hot:data", { type, data: items });
        return;
      }

      // Check cache first
      const entry = HOT_CACHE[type];
      if (!force && entry && Array.isArray(entry.data) && entry.data.length) {
        if (Date.now() - entry.ts < CACHE_TTL_MS) {
          socket.emit("hot:data", { type, data: entry.data });
          return;
        }
        return;
      }

      let items = [];
      if (type === "weibo") {
        const r = await fetch("https://weibo.com/ajax/side/hotSearch", {
          headers: { "User-Agent": "Mozilla/5.0...", Referer: "https://weibo.com/" },
        });
        const j = await r.json();
        items = (j.data.realtime || []).map((x) => ({
          title: x.word,
          url: "https://s.weibo.com/weibo?q=" + encodeURIComponent(x.word),
          hot: x.num,
        }));
        HOT_CACHE.weibo = { ts: Date.now(), data: items };
      } else if (type === "news") {
        const feed = await rssParser.parseURL("https://www.chinanews.com.cn/rss/scroll-news.xml");
        items = (feed.items || [])
          .slice(0, 50)
          .map((i) => ({ title: i.title, url: i.link, time: i.pubDate }));
        HOT_CACHE.news = { ts: Date.now(), data: items };
      } else if (type === "huxiu") {
        const feed = await rssParser.parseURL("https://www.huxiu.com/rss/0.xml");
        items = (feed.items || [])
          .slice(0, 50)
          .map((i) => ({ title: i.title, url: i.link, time: i.pubDate }));
        HOT_CACHE.huxiu = { ts: Date.now(), data: items };
      }

      socket.emit("hot:data", { type, data: items });
    } catch (err) {
      const type = payload && typeof payload.type === "string" ? payload.type : "";
      console.error(`Hot Socket Error [${type}]:`, err.message);
      // Fallback to cache if available
      const entry = HOT_CACHE[type];
      if (entry && Array.isArray(entry.data) && entry.data.length) {
        socket.emit("hot:data", { type, data: entry.data });
      } else {
        socket.emit("hot:error", { type, error: err.message });
      }
    }
  });

  // Auth for Socket
  socket.on("auth", ({ token }) => {
    try {
      if (!token) return;
      const decoded = jwt.verify(token, SECRET_KEY);
      const username = decoded.username;
      socket.join(`user:${username}`);
      console.log(`Socket ${socket.id} joined room user:${username}`);
    } catch {
      // console.error("Socket auth failed:", err.message);
    }
  });

  socket.on("memo:update", async ({ token, widgetId, content }) => {
    try {
      let username = "admin";
      if (token) {
        const decoded = jwt.verify(token, SECRET_KEY);
        username = decoded.username;
      } else if (systemConfig.authMode === "single") {
        username = "admin";
      } else {
        return;
      }

      if (!cachedUsersData[username]) {
        const filePath = getUserFile(username);
        try {
          const json = await fs.readFile(filePath, "utf-8");
          cachedUsersData[username] = JSON.parse(json);
        } catch {
          return;
        }
      }

      const userData = cachedUsersData[username];
      let widget = null;
      if (userData.widgets) {
        widget = userData.widgets.find((w) => w.id === widgetId);
      }

      if (widget) {
        if (widget.data !== content) {
          widget.data = content;
          atomicWrite(getUserFile(username), JSON.stringify(userData, null, 2)).catch(
            console.error,
          );
          socket.to(`user:${username}`).emit("memo:updated", { widgetId, content });
          if (systemConfig.authMode === "single") {
            io.emit("memo:updated", { widgetId, content });
          }
        }
      }
    } catch (err) {
      console.error("Memo update error:", err.message);
    }
  });

  socket.on("todo:update", async ({ token, widgetId, content }) => {
    try {
      let username = "admin";
      if (token) {
        const decoded = jwt.verify(token, SECRET_KEY);
        username = decoded.username;
      } else if (systemConfig.authMode === "single") {
        username = "admin";
      } else {
        return;
      }

      if (!cachedUsersData[username]) {
        const filePath = getUserFile(username);
        try {
          const json = await fs.readFile(filePath, "utf-8");
          cachedUsersData[username] = JSON.parse(json);
        } catch {
          return;
        }
      }

      const userData = cachedUsersData[username];
      let widget = null;
      if (userData.widgets) {
        widget = userData.widgets.find((w) => w.id === widgetId);
      }

      if (widget) {
        if (widget.data !== content) {
          widget.data = content;
          atomicWrite(getUserFile(username), JSON.stringify(userData, null, 2)).catch(
            console.error,
          );
          socket.to(`user:${username}`).emit("todo:updated", { widgetId, content });
          if (systemConfig.authMode === "single") {
            io.emit("todo:updated", { widgetId, content });
          }
        }
      }
    } catch (err) {
      console.error("Todo update error:", err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
