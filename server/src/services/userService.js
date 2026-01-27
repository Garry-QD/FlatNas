import fs from "fs/promises";
import path from "path";
import { USERS_DIR, OLD_DATA_FILE, DEFAULT_FILE } from "../config/constants.js";
import { atomicWrite } from "../utils/file.js";

const cachedUsersData = {};

export const getUserFile = (username, authMode = "single") => {
  if (username === "admin" && authMode === "single") {
    return OLD_DATA_FILE;
  }
  const safeUsername = username.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(USERS_DIR, `${safeUsername}.json`);
};

export const getDefaultData = async () => {
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
};

export const getUserData = async (username, authMode = "single") => {
  if (cachedUsersData[username]) return cachedUsersData[username];

  const filePath = getUserFile(username, authMode);
  try {
    const json = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(json);
    cachedUsersData[username] = data;
    return data;
  } catch (err) {
    if (username === "admin") {
      const defaultData = await getDefaultData();
      cachedUsersData["admin"] = defaultData;
      return defaultData;
    }
    throw new Error("User data not found");
  }
};

export const saveUserData = async (username, data, authMode = "single") => {
  const filePath = getUserFile(username, authMode);
  await atomicWrite(filePath, JSON.stringify(data, null, 2));
  cachedUsersData[username] = data;
};

export const listUsers = async () => {
  try {
    const files = await fs.readdir(USERS_DIR);
    return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
  } catch (err) {
    return [];
  }
};

export const deleteUser = async (username) => {
  const filePath = getUserFile(username, "multi");
  await fs.unlink(filePath);
  delete cachedUsersData[username];
};

export const clearCache = (username) => {
  if (username) delete cachedUsersData[username];
  else Object.keys(cachedUsersData).forEach(key => delete cachedUsersData[key]);
};
