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

const rssParser = new RSSParser();
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

const PORT = 3000;
const SECRET_KEY = process.env.SECRET_KEY || "flat-nas-secret-key-change-this"; // In production, use ENV. Fallback for development.

// Login Attempts { ip: { count: 0, lockUntil: 0 } }
const loginAttempts = {};

// Directories
const DATA_DIR = path.join(__dirname, "data");
const USERS_DIR = path.join(DATA_DIR, "users");
const OLD_DATA_FILE = path.join(DATA_DIR, "data.json");
const SYSTEM_CONFIG_FILE = path.join(DATA_DIR, "system.json");
const DEFAULT_FILE = path.join(__dirname, "default.json");
const MUSIC_DIR = path.join(__dirname, "music");

// Config multer - unused for now
// const storage = ...
// const upload = ...

const CACHE_TTL_MS = 60 * 60 * 1000;
const HOT_CACHE = { weibo: { ts: 0, data: [] }, news: { ts: 0, data: [] }, rss: new Map() };

// In-memory cache for all users: { username: data }
const cachedUsersData = {};
let systemConfig = { authMode: "single" }; // default: 'single' or 'multi'

async function atomicWrite(filePath, content) {
  const tempFile = filePath + ".tmp";
  await fs.writeFile(tempFile, content);
  await fs.rename(tempFile, filePath);
}

// Ensure directories and migrate data
async function ensureInit() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(USERS_DIR, { recursive: true });
    await fs.mkdir(MUSIC_DIR, { recursive: true });
  } catch {
    // ignore
  }

  // Load System Config
  try {
    const sysContent = await fs.readFile(SYSTEM_CONFIG_FILE, "utf-8");
    systemConfig = JSON.parse(sysContent);
  } catch {
    await fs.writeFile(SYSTEM_CONFIG_FILE, JSON.stringify(systemConfig, null, 2));
  }

  // Migration: Check if old data.json exists
  try {
    await fs.access(OLD_DATA_FILE);
    // Move it to users/admin.json
    const adminFile = path.join(USERS_DIR, "admin.json");
    try {
      await fs.access(adminFile);
      // admin.json already exists, maybe do nothing or backup old data?
      // For now, if admin.json exists, we assume migration is done.
    } catch {
      console.log("Migrating data.json to users/admin.json...");
      await fs.rename(OLD_DATA_FILE, adminFile);
    }
  } catch {
    // Old file doesn't exist, check if admin.json exists
  }

  // Ensure admin.json exists
  const adminFile = path.join(USERS_DIR, "admin.json");
  try {
    const content = await fs.readFile(adminFile, "utf-8");
    cachedUsersData["admin"] = JSON.parse(content);
  } catch {
    // Create default admin
    const initData = await getDefaultData();
    await fs.writeFile(adminFile, JSON.stringify(initData, null, 2));
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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// Helper to get user file path
function getUserFile(username) {
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
    const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: "30d" });
    res.json({ success: true, token, username });
  } else {
    recordFailedAttempt(ip);
    res.status(401).json({ error: "Password incorrect" });
  }
});

// Register
app.post("/api/register", async (req, res) => {
  if (systemConfig.authMode === "single") {
    return res.status(403).json({ error: "Registration disabled in Single User Mode" });
  }

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });

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
    if (body.password && body.password.length > 0) {
      if (body.password !== currentData.password) {
        newPassword = await bcrypt.hash(body.password, 10);
      }
    }
    body.password = newPassword;

    cachedUsersData[username] = body;
    await atomicWrite(getUserFile(username), JSON.stringify(body, null, 2));

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
  const target = req.query.target || "223.5.5.5";
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

// Weather
app.get("/api/weather", async (req, res) => {
  const city = req.query.city || "";
  if (!city) return res.status(400).json({ error: "City is required" });
  try {
    const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`);
    if (!response.ok) throw new Error("Weather API error");
    const data = await response.json();
    const current = data.current_condition[0];
    const text = current.lang_zh?.[0]?.value || current.weatherDesc[0].value;
    res.json({
      success: true,
      data: {
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
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch weather data" });
  }
});

// Import (Legacy/Admin only?)
// For now, allow logged in user to import to their profile
app.post("/api/data/import", authenticateToken, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const username = req.user.username;
  try {
    const body = req.body;
    cachedUsersData[username] = body;
    await atomicWrite(getUserFile(username), JSON.stringify(body, null, 2));
    res.json({ success: true });
  } catch {
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

// Get music list
app.get("/api/music-list", async (req, res) => {
  try {
    const files = await fs.readdir(MUSIC_DIR);
    const musicFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [".mp3", ".wav", ".ogg", ".m4a", ".flac"].includes(ext);
    });
    res.json(musicFiles);
  } catch (err) {
    console.error("Failed to read music dir", err);
    res.json([]);
  }
});

// Fetch Meta
app.get("/api/fetch-meta", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error("Failed to fetch");

    const html = await response.text();

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
          icon = new URL(icon, url).href;
        } catch {
          // ignore invalid relative url
        }
      }
    }

    // If no icon found in HTML, frontend might use fallback, or we can check /favicon.ico here.
    // Frontend has a fallback to api.iowen.cn, so we can just return what we found.
    // But returning origin/favicon.ico is a good "second try" before external API.
    if (!icon) {
      // Nothing to do here
    }

    res.json({ title, icon });
  } catch (err) {
    console.error("Fetch meta error:", err.message);
    res.status(500).json({ error: "Failed to fetch meta" });
  }
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
