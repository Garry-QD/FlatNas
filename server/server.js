import express from "express";
import { createServer } from "http";
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
const USERS_DIR = path.join(DATA_DIR, "users");
const OLD_DATA_FILE = path.join(DATA_DIR, "data.json");
const SYSTEM_CONFIG_FILE = path.join(DATA_DIR, "system.json");
const DEFAULT_FILE = path.join(__dirname, "default.json");
const MUSIC_DIR = path.join(__dirname, "music");
const WALLPAPER_DIR = path.join(__dirname, "Wallpaper"); // Deprecated but kept for reference if needed
const BACKGROUNDS_DIR = path.join(__dirname, "PC");
const MOBILE_BACKGROUNDS_DIR = path.join(__dirname, "APP");
const CONFIG_VERSIONS_DIR = path.join(DATA_DIR, "config_versions");

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
const HOT_CACHE = { weibo: { ts: 0, data: [] }, news: { ts: 0, data: [] }, rss: new Map() };

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
  await ensureDir(USERS_DIR);
  await ensureDir(MUSIC_DIR);
  await ensureDir(BACKGROUNDS_DIR);
  await ensureDir(MOBILE_BACKGROUNDS_DIR);
  await ensureDir(CONFIG_VERSIONS_DIR);

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
    req.user = null; // No user
    return next();
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      req.user = null; // Invalid token
    } else {
      req.user = user;
    }
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

    // Fetch stats for running containers
    const runningContainers = containers.filter((c) => c.State === "running");
    const statsPromises = runningContainers.map(async (c) => {
      try {
        const container = docker.getContainer(c.Id);
        // stream: false returns a single snapshot
        const stats = await container.stats({ stream: false });
        return { id: c.Id, stats };
      } catch (e) {
        return { id: c.Id, error: e.message };
      }
    });

    const statsResults = await Promise.all(statsPromises);
    const statsMap = {};
    statsResults.forEach((r) => {
      if (r.stats) statsMap[r.id] = r.stats;
    });

    // Enrich containers with stats
    const enriched = containers.map((c) => {
      if (c.State === "running" && statsMap[c.Id]) {
        const s = statsMap[c.Id];
        // Calculate CPU %
        // cpu_delta = cpu_stats.cpu_usage.total_usage - precpu_stats.cpu_usage.total_usage
        // system_cpu_delta = cpu_stats.system_cpu_usage - precpu_stats.system_cpu_usage
        // number_cpus = length(cpu_stats.cpu_usage.percpu_usage) or cpu_stats.online_cpus
        // CPU % = (cpu_delta / system_cpu_delta) * number_cpus * 100.0

        let cpuPercent = 0;
        let memUsage = 0;
        let memLimit = 0;
        let memPercent = 0;

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
            // Subtract cache from usage for cgroup v1, different for v2
            // Simple approximation: usage - stats.cache (if exists)
            if (s.memory_stats.stats && s.memory_stats.stats.cache) {
              memUsage -= s.memory_stats.stats.cache;
            } else if (s.memory_stats.stats && s.memory_stats.stats.inactive_file) {
              // cgroup v2 approximation
              memUsage -= s.memory_stats.stats.inactive_file;
            }

            memLimit = s.memory_stats.limit;
            if (memLimit > 0) {
              memPercent = (memUsage / memLimit) * 100.0;
            }
          }
        } catch {
          // Ignore calculation errors
        }

        return { ...c, stats: { cpuPercent, memUsage, memLimit, memPercent } };
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
app.get("/api/data", authenticateToken, async (req, res) => {
  try {
    // If user is logged in, return their data
    // If not logged in, return admin data (as default/public view)
    const username = req.user ? req.user.username : "admin";

    // Check cache
    if (!cachedUsersData[username]) {
      const filePath = getUserFile(username);
      try {
        const json = await fs.readFile(filePath, "utf-8");
        cachedUsersData[username] = JSON.parse(json);
      } catch {
        if (username === "admin") {
          // Should not happen if ensureInit works
          return res.status(500).json({ error: "Admin data missing" });
        }
        return res.status(404).json({ error: "User data not found" });
      }
    }

    if (req.query.ping) {
      return res.json({ success: true, ts: Date.now() });
    }

    const safeData = { ...cachedUsersData[username] };
    delete safeData.password;

    // Add username to response so frontend knows who we are viewing
    safeData.username = username;

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
  } catch (e) {
    console.error("Login error", e);
  }

  if (match) {
    resetFailedAttempt(ip);
    const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: "3d" });
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
    const data = req.body;
    if (!data || typeof data !== "object") {
      return res.status(400).json({ error: "Invalid JSON data" });
    }

    // Preserve password
    if (cachedUsersData[username] && cachedUsersData[username].password) {
      data.password = cachedUsersData[username].password;
    }

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

// IP Proxy
app.get("/api/ip", async (req, res) => {
  let clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  if (clientIp.startsWith("::ffff:")) clientIp = clientIp.substring(7);
  if (clientIp.includes(",")) clientIp = clientIp.split(",")[0].trim();

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

      if (ip) return res.json({ success: true, ip, location, source: s.type, clientIp });
    } catch {
      // ignore
    }
  }
  res.json({ success: false, ip: clientIp, location: "Unknown", source: "fallback", clientIp });
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

async function fetchWeatherFromAMap(city, key) {
  if (!key) throw new Error("AMap Key required");

  let adcode = city;
  let cityName = city;

  // If city is auto/empty or looks like a name (not numeric), resolve it
  if (!city || city === "auto" || city === "本地" || !/^\d+$/.test(city)) {
    if (!city || city === "auto" || city === "本地") {
      // IP Location
      const ipRes = await fetch(`https://restapi.amap.com/v3/ip?key=${key}`);
      const ipData = await ipRes.json();
      if (ipData.status !== "1") throw new Error("AMap IP Location failed: " + ipData.info);
      adcode = ipData.adcode;
      cityName = ipData.city;
    } else {
      // Geocoding
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
  const weatherRes = await fetch(
    `https://restapi.amap.com/v3/weather/weatherInfo?city=${adcode}&key=${key}&extensions=all`,
  );
  const weatherData = await weatherRes.json();
  if (weatherData.status !== "1" || !weatherData.forecasts?.length)
    throw new Error("AMap Weather failed");

  const forecast = weatherData.forecasts[0];
  const today = forecast.casts?.[0];
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

// Weather
app.get("/api/weather", async (req, res) => {
  const city = req.query.city || "";
  const source = req.query.source || "wttr";
  const key = req.query.key || "";

  // Allow "auto" or empty city to mean "local"
  // if (!city) return res.status(400).json({ error: "City is required" });

  try {
    let data;
    if (source === "amap" && key) {
      data = await fetchWeatherFromAMap(city, key);
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

// Import (Legacy/Admin only?)
// For now, allow logged in user to import to their profile
app.post("/api/data/import", authenticateToken, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const username = req.user.username;
  try {
    const body = req.body;
    const current = cachedUsersData[username] || {};
    const finalData = { ...body, password: current.password };
    cachedUsersData[username] = finalData;
    await atomicWrite(getUserFile(username), JSON.stringify(finalData, null, 2));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to import" });
  }
});

// Import Data (Deprecated but kept for compatibility, now handled by /api/data)
app.post("/api/data/import", authenticateToken, async (req, res) => {
  // Redirect logic to /api/data handler internally or just reuse logic
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const username = req.user.username;
  try {
    const data = req.body;
    if (!data || typeof data !== "object") {
      return res.status(400).json({ error: "Invalid JSON data" });
    }
    // Preserve password
    if (cachedUsersData[username] && cachedUsersData[username].password) {
      data.password = cachedUsersData[username].password;
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
  socket.on("weather:fetch", async ({ city, source, key }) => {
    try {
      let data;
      if (source === "amap" && key) {
        data = await fetchWeatherFromAMap(city, key);
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
  socket.on("hot:fetch", async ({ type, force }) => {
    try {
      // Check cache first
      if (
        !force &&
        HOT_CACHE[type] &&
        HOT_CACHE[type].data.length &&
        Date.now() - HOT_CACHE[type].ts < CACHE_TTL_MS
      ) {
        socket.emit("hot:data", { type, data: HOT_CACHE[type].data });
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
      }

      socket.emit("hot:data", { type, data: items });
    } catch (err) {
      console.error(`Hot Socket Error [${type}]:`, err.message);
      // Fallback to cache if available
      if (HOT_CACHE[type] && HOT_CACHE[type].data.length) {
        socket.emit("hot:data", { type, data: HOT_CACHE[type].data });
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

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
