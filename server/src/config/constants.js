import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base directory (server root)
export const SERVER_ROOT = path.join(__dirname, "../..");

export const DATA_DIR = path.join(SERVER_ROOT, "data");
export const DOC_DIR = path.join(SERVER_ROOT, "doc");
export const USERS_DIR = path.join(DATA_DIR, "users");
export const MUSIC_DIR = path.join(SERVER_ROOT, "music");
export const BACKGROUNDS_DIR = path.join(SERVER_ROOT, "PC");
export const MOBILE_BACKGROUNDS_DIR = path.join(SERVER_ROOT, "APP");
export const CONFIG_VERSIONS_DIR = path.join(DATA_DIR, "config_versions");
export const ICON_CACHE_DIR = path.join(DATA_DIR, "icon-cache");
export const PUBLIC_DIR = path.join(SERVER_ROOT, "public");
export const DIST_DIR = path.join(SERVER_ROOT, "../dist");

export const DOCKER_STATS_POLL_INTERVAL = 5000;
export const DOCKER_STATS_TIMEOUT = DOCKER_STATS_POLL_INTERVAL * 2.5;
export const RSS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
