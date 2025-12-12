import { ref, computed, watch } from "vue";
import { defineStore } from "pinia";
import { io } from "socket.io-client";
import type { NavItem, NavGroup, AppConfig, WidgetConfig, RssFeed, RssCategory } from "@/types";

export const useMainStore = defineStore("main", () => {
  const socket = io();
  const isConnected = ref(false);
  let socketListenersBound = false;
  let isInitializing = false;

  socket.on("connect", () => {
    isConnected.value = true;
  });
  socket.on("disconnect", () => {
    isConnected.value = false;
  });

  const groups = ref<NavGroup[]>([]);
  const items = computed(() => groups.value.flatMap((g) => g.items));
  const rssFeeds = ref<RssFeed[]>([]);
  const rssCategories = ref<RssCategory[]>([]);
  const systemConfig = ref({ authMode: "single" }); // Default

  // Auth State
  const token = ref(localStorage.getItem("flat-nas-token") || "");
  const username = ref(localStorage.getItem("flat-nas-username") || "");
  const isLogged = ref(!!token.value);
  const password = ref(""); // Only used for password change, not auth
  const isExpandedMode = ref(false);

  const getHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token.value) {
      headers["Authorization"] = `Bearer ${token.value}`;
    }
    return headers;
  };

  const createDefaultItems = () =>
    Array.from({ length: 10 }, (_, i) => ({
      id: `def-${Date.now()}-${i}`,
      title: "待添加",
      url: "",
      icon: "",
      isPublic: true,
    }));

  // Version Check
  const currentVersion = "1.0.28";
  const latestVersion = ref("");
  const dockerUpdateAvailable = ref(false);

  const hasUpdate = computed(() => {
    if (dockerUpdateAvailable.value) return true;
    if (!latestVersion.value) return false;
    const v1 = currentVersion.replace(/^v/, "");
    const v2 = latestVersion.value.replace(/^v/, "");
    return v1 !== v2;
  });

  const checkUpdate = async () => {
    try {
      // Use Gitee tags API to avoid connection issues in China
      const res = await fetch("https://gitee.com/api/v5/repos/gjx0808/FlatNas/tags");
      if (res.ok) {
        const data = await res.json();
        if (data.length > 0) {
          latestVersion.value = data[0].name;
        }
      }
    } catch (e) {
      console.error("Failed to check update", e);
    }

    try {
      const res = await fetch("/api/docker-status");
      if (res.ok) {
        const data = await res.json();
        if (data.hasUpdate) {
          dockerUpdateAvailable.value = true;
        }
      }
    } catch {
      // ignore
    }
  };

  const widgets = ref<WidgetConfig[]>([]);

  const appConfig = ref<AppConfig>({
    background: "/default-wallpaper.svg",
    mobileBackground: "/default-wallpaper.svg",
    enableMobileWallpaper: true,
    fixedWallpaper: false,
    deviceMode: "auto",
    pcRotation: false,
    pcRotationInterval: 30,
    pcRotationMode: "random",
    mobileRotation: false,
    mobileRotationInterval: 30,
    mobileRotationMode: "random",
    backgroundBlur: 0,
    backgroundMask: 0,
    mobileBackgroundBlur: 0,
    mobileBackgroundMask: 0,
    customTitle: "我的导航",
    titleAlign: "left",
    titleSize: 48,
    titleColor: "#ffffff",
    cardLayout: "vertical",
    cardSize: 120,
    gridGap: 24,
    cardBgColor: "transparent",
    cardTitleColor: "#111827",
    cardBorderColor: "transparent",
    showCardBackground: true,
    iconShape: "rounded",
    searchEngines: [
      {
        id: "google",
        key: "google",
        label: "Google",
        urlTemplate: "https://www.google.com/search?q={q}",
      },
      { id: "bing", key: "bing", label: "Bing", urlTemplate: "https://cn.bing.com/search?q={q}" },
      { id: "baidu", key: "baidu", label: "百度", urlTemplate: "https://www.baidu.com/s?wd={q}" },
    ],
    defaultSearchEngine: "google",
    rememberLastEngine: true,
    groupTitleColor: "#ffffff",
    groupGap: 30,
    autoPlayMusic: false,
    showFooterStats: false,
    footerHtml: "",
    footerHeight: 0,
    footerWidth: 1280,
    footerMarginBottom: 0,
    footerFontSize: 12,
    // Wallpaper API defaults
    wallpaperApiPcList: "/api/backgrounds",
    wallpaperApiPcUpload: "/api/backgrounds/upload",
    wallpaperApiPcDeleteBase: "/api/backgrounds",
    wallpaperPcImageBase: "/backgrounds",
    wallpaperApiMobileList: "/api/mobile_backgrounds",
    wallpaperApiMobileUpload: "/api/mobile_backgrounds/upload",
    wallpaperApiMobileDeleteBase: "/api/mobile_backgrounds",
    wallpaperMobileImageBase: "/mobile_backgrounds",
  });

  const fetchSystemConfig = async () => {
    try {
      const res = await fetch("/api/system-config");
      if (res.ok) {
        const data = await res.json();
        systemConfig.value = data;
      }
    } catch (e) {
      console.error("Failed to fetch system config", e);
    }
  };

  const updateSystemConfig = async (newConfig: { authMode: string }) => {
    try {
      const res = await fetch("/api/system-config", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(newConfig),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          systemConfig.value = data.systemConfig;
          return true;
        }
      }
      return false;
    } catch (e) {
      console.error("Failed to update system config", e);
      return false;
    }
  };

  const init = async () => {
    isInitializing = true;
    await fetchSystemConfig();
    try {
      const headers: Record<string, string> = {};
      if (token.value) headers["Authorization"] = `Bearer ${token.value}`;

      const res = await fetch(`/api/data`, { headers });
      const data = await res.json();

      // If we got username back, ensure it matches
      if (data.username && data.username !== username.value) {
        username.value = data.username;
        localStorage.setItem("flat-nas-username", data.username);
      }

      if (data.items && data.items.length > 0 && (!data.groups || data.groups.length === 0)) {
        groups.value = [{ id: Date.now().toString(), title: "默认分组", items: data.items }];
        saveData();
      } else if (data.groups) {
        groups.value = data.groups;
        if (groups.value.length === 0) {
          groups.value.push({ id: "g1", title: "常用", items: createDefaultItems(), preset: true });
        }
      } else {
        groups.value = [{ id: "g1", title: "常用", items: createDefaultItems(), preset: true }];
      }

      if (Array.isArray(data.widgets)) {
        widgets.value = data.widgets;

        // 修复潜在的组件类型错乱问题 (例如备忘录被错误标记为 docker)
        const memoW = widgets.value.find((w) => w.id === "memo");
        if (memoW && memoW.type !== "memo") {
          memoW.type = "memo";
        }

        // 强健的 Docker 组件修复逻辑
        // 1. 查找最佳 Docker 组件候选 (优先匹配 ID，其次匹配类型)
        let dockerCandidate = widgets.value.find((w) => w.id === "docker");
        if (!dockerCandidate) {
          dockerCandidate = widgets.value.find((w) => w.type === "docker");
        }

        // 2. 从列表中移除所有相关的组件 (防止重复或 ID 冲突)
        widgets.value = widgets.value.filter((w) => w.id !== "docker" && w.type !== "docker");

        // 3. 准备最终的 Docker 组件
        if (dockerCandidate) {
          // 使用现有组件作为基础，但强制 ID 和类型
          dockerCandidate.id = "docker";
          dockerCandidate.type = "docker";
          // 确保关键属性存在，防止渲染错误
          if (typeof dockerCandidate.colSpan !== "number") dockerCandidate.colSpan = 1;
          if (typeof dockerCandidate.rowSpan !== "number") dockerCandidate.rowSpan = 1;
          if (typeof dockerCandidate.enable !== "boolean") dockerCandidate.enable = false;
          if (typeof dockerCandidate.isPublic !== "boolean") dockerCandidate.isPublic = true;
        } else {
          // 不存在则创建默认的
          dockerCandidate = {
            id: "docker",
            type: "docker",
            enable: false,
            isPublic: true,
            colSpan: 1,
            rowSpan: 1,
          };
        }

        // 4. 将规范化后的 Docker 组件添加到列表末尾
        widgets.value.push(dockerCandidate);

        if (!widgets.value.find((w) => w.type === "rss")) {
          widgets.value.push({
            id: "rss-reader",
            type: "rss",
            enable: false,
            colSpan: 1,
            rowSpan: 2,
            isPublic: true,
          });
        }
        if (!widgets.value.find((w) => w.type === "sidebar")) {
          widgets.value.push({
            id: "sidebar",
            type: "sidebar",
            enable: false,
            isPublic: true,
          });
        }
      } else {
        // Default widgets if empty
        widgets.value = [
          { id: "w1", type: "clock", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
          { id: "w2", type: "weather", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
          { id: "w3", type: "calendar", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
          { id: "w5", type: "search", enable: true, isPublic: true },
          { id: "w7", type: "quote", enable: true, isPublic: true },
          {
            id: "clockweather",
            type: "clockweather",
            enable: true,
            colSpan: 1,
            rowSpan: 1,
            isPublic: true,
          },
          { id: "sidebar", type: "sidebar", enable: false, isPublic: true },
          { id: "memo", type: "memo", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
          { id: "todo", type: "todo", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
          {
            id: "calculator",
            type: "calculator",
            enable: true,
            colSpan: 1,
            rowSpan: 1,
            isPublic: true,
          },
          { id: "ip", type: "ip", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
          { id: "hot", type: "hot", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
          { id: "player", type: "player", enable: true, colSpan: 2, rowSpan: 1, isPublic: true },
        ];
      }

      if (data.appConfig) appConfig.value = { ...appConfig.value, ...data.appConfig };
      if (!appConfig.value.background) appConfig.value.background = "/default-wallpaper.svg";

      if (!appConfig.value.searchEngines || appConfig.value.searchEngines.length === 0) {
        appConfig.value.searchEngines = [
          {
            id: "google",
            key: "google",
            label: "Google",
            urlTemplate: "https://www.google.com/search?q={q}",
          },
          {
            id: "bing",
            key: "bing",
            label: "Bing",
            urlTemplate: "https://cn.bing.com/search?q={q}",
          },
          {
            id: "baidu",
            key: "baidu",
            label: "百度",
            urlTemplate: "https://www.baidu.com/s?wd={q}",
          },
        ];
      }
      if (!appConfig.value.defaultSearchEngine) appConfig.value.defaultSearchEngine = "google";
      if (typeof appConfig.value.rememberLastEngine !== "boolean")
        appConfig.value.rememberLastEngine = true;

      const cachedShape = localStorage.getItem("flat-nas-icon-shape");
      if (cachedShape) appConfig.value.iconShape = cachedShape;
      const cachedColor = localStorage.getItem("flat-nas-group-title-color");
      if (cachedColor) appConfig.value.groupTitleColor = cachedColor;
      const cachedCardBg = localStorage.getItem("flat-nas-card-bg-color");
      if (cachedCardBg) appConfig.value.cardBgColor = cachedCardBg;

      if (data.rssFeeds) rssFeeds.value = data.rssFeeds;
      if (data.rssCategories) rssCategories.value = data.rssCategories;

      checkUpdate();
      if (!socketListenersBound) {
        socket.on("memo:updated", ({ widgetId, content }) => {
          const w = widgets.value.find((x) => x.id === widgetId);
          if (w) w.data = content;
        });
        socket.on("todo:updated", ({ widgetId, content }) => {
          const w = widgets.value.find((x) => x.id === widgetId);
          if (w) w.data = content;
        });
        socketListenersBound = true;
      }
      if (token.value) {
        socket.emit("auth", { token: token.value });
      }
      isInitializing = false;
    } catch (e) {
      console.error("加载失败", e);
      isInitializing = false;
    }
  };

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSavedJson = "";

  const saveData = async (immediate = false) => {
    if (saveTimer) clearTimeout(saveTimer);

    const doSave = async () => {
      try {
        if (!isLogged.value) {
          return;
        }
        const body: Record<string, unknown> = {
          groups: groups.value,
          widgets: widgets.value,
          appConfig: appConfig.value,
          rssFeeds: rssFeeds.value,
          rssCategories: rssCategories.value,
        };
        if (typeof password.value === "string" && password.value.length > 0) {
          body.password = password.value;
        }
        const json = JSON.stringify(body);

        if (json === lastSavedJson) {
          return;
        }

        const res = await fetch("/api/save", {
          method: "POST",
          headers: getHeaders(),
          body: json,
        });

        if (res.ok) {
          lastSavedJson = json;
          if (body.password) {
            password.value = "";
          }
        }

        if (res.status === 401) {
          token.value = "";
          username.value = "";
          isLogged.value = false;
          localStorage.removeItem("flat-nas-token");
          localStorage.removeItem("flat-nas-username");
        }
      } catch (e) {
        console.error("保存失败", e);
      }
    };

    if (immediate) {
      return doSave();
    }

    saveTimer = setTimeout(doSave, 500);
  };

  const cleanInvalidGroups = () => {
    const seen = new Set<string>();
    groups.value = groups.value.filter((g) => {
      const validId = typeof g.id === "string" && g.id.length > 0;
      const dup = validId && seen.has(g.id);
      if (validId) seen.add(g.id);
      const hasTitle = typeof g.title === "string" && g.title.trim().length > 0;
      const hasItems = Array.isArray(g.items) && g.items.length > 0;
      return validId && (hasTitle || hasItems) && !dup;
    });
  };

  const addGroup = () => {
    try {
      const id = Date.now().toString();
      const index = groups.value.length + 1;
      const title = `新建分组 ${index}`;
      groups.value.push({ id, title, items: [] });
      saveData();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteGroup = (groupId: string, skipConfirm = false) => {
    if (!skipConfirm && !confirm("确定删除？")) return;
    groups.value = groups.value.filter((g) => g.id !== groupId);
    saveData();
  };

  const updateGroupTitle = (groupId: string, newTitle: string) => {
    const group = groups.value.find((g) => g.id === groupId);
    if (group) {
      group.title = newTitle;
      saveData();
    }
  };

  const updateGroup = (groupId: string, updates: Partial<NavGroup>) => {
    const group = groups.value.find((g) => g.id === groupId);
    if (group) {
      Object.assign(group, updates);
      saveData();
    }
  };

  const addItem = (item: NavItem, groupId: string) => {
    const group = groups.value.find((g) => g.id === groupId);
    if (group) {
      group.items.push({ ...item, isPublic: item.isPublic ?? true });
      saveData();
    }
  };

  const updateItem = (updatedItem: NavItem) => {
    for (const group of groups.value) {
      const idx = group.items.findIndex((i) => i.id === updatedItem.id);
      if (idx !== -1) {
        group.items[idx] = updatedItem;
        saveData();
        return;
      }
    }
  };

  const deleteItem = (id: string) => {
    for (const group of groups.value) {
      const idx = group.items.findIndex((i) => i.id === id);
      if (idx !== -1) {
        group.items.splice(idx, 1);
        saveData();
        return;
      }
    }
  };

  const login = async (usr: string, pwd: string) => {
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usr, password: pwd }),
      });
      if (res.ok) {
        const data = await res.json();
        token.value = data.token;
        username.value = data.username;
        isLogged.value = true;

        localStorage.setItem("flat-nas-token", data.token);
        localStorage.setItem("flat-nas-username", data.username);

        // Reload data for the new user
        await init();
        return true;
      }
      const data = await res.json();
      throw new Error(data.error || "Login failed");
    } catch (e: unknown) {
      console.error(e);
      throw e;
    }
  };

  const register = async (usr: string, pwd: string) => {
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usr, password: pwd }),
      });
      if (res.ok) return true;
      const data = await res.json();
      throw new Error(data.error || "Register failed");
    } catch (e: unknown) {
      console.error(e);
      throw e;
    }
  };

  const fetchUsers = async () => {
    try {
      const headers: Record<string, string> = {};
      if (token.value) headers["Authorization"] = `Bearer ${token.value}`;
      const res = await fetch("/api/admin/users", { headers });
      if (res.ok) {
        const data = await res.json();
        return data.users;
      }
      return [];
    } catch {
      return [];
    }
  };

  const addUser = async (usr: string, pwd: string) => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token.value) headers["Authorization"] = `Bearer ${token.value}`;
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers,
        body: JSON.stringify({ username: usr, password: pwd }),
      });
      if (res.ok) return true;
      const data = await res.json();
      throw new Error(data.error || "Add user failed");
    } catch (e) {
      throw e;
    }
  };

  const deleteUser = async (usr: string) => {
    try {
      const headers: Record<string, string> = {};
      if (token.value) headers["Authorization"] = `Bearer ${token.value}`;
      const res = await fetch(`/api/admin/users/${usr}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) return true;
      throw new Error("Delete failed");
    } catch (e) {
      throw e;
    }
  };

  const uploadLicense = async (key: string) => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token.value) headers["Authorization"] = `Bearer ${token.value}`;
      const res = await fetch("/api/admin/license", {
        method: "POST",
        headers,
        body: JSON.stringify({ key }),
      });
      if (res.ok) return true;
      const data = await res.json();
      throw new Error(data.error || "Upload license failed");
    } catch (e) {
      throw e;
    }
  };

  const logout = async () => {
    token.value = "";
    username.value = "";
    isLogged.value = false;
    localStorage.removeItem("flat-nas-token");
    localStorage.removeItem("flat-nas-username");

    // Reload to show default/public view
    await init();
  };

  const changePassword = (newPwd: string) => {
    password.value = newPwd;
  };

  const saveWidget = async (id?: string, data?: unknown) => {
    if (typeof id === "string") {
      const w = widgets.value.find((x) => x.id === id);
      if (w) w.data = data as WidgetConfig["data"];
    }
    await saveData();
  };

  watch(
    () => appConfig.value.iconShape,
    (val) => {
      if (typeof val === "string") localStorage.setItem("flat-nas-icon-shape", val);
    },
  );
  watch(
    () => appConfig.value.cardBgColor,
    (val) => {
      if (typeof val === "string") localStorage.setItem("flat-nas-card-bg-color", val);
    },
  );

  watch(
    appConfig,
    () => {
      if (!isInitializing) {
        saveData();
      }
    },
    { deep: true },
  );

  watch(
    widgets,
    () => {
      if (!isInitializing) {
        saveData();
      }
    },
    { deep: true },
  );

  watch(
    rssFeeds,
    () => {
      if (!isInitializing) {
        saveData();
      }
    },
    { deep: true },
  );

  watch(
    rssCategories,
    () => {
      if (!isInitializing) {
        saveData();
      }
    },
    { deep: true },
  );

  return {
    groups,
    items,
    widgets,
    appConfig,
    password,
    isLogged,
    token,
    username, // Export username
    getHeaders,
    isExpandedMode,
    rssFeeds,
    rssCategories,
    init,
    addGroup,
    deleteGroup,
    updateGroupTitle,
    updateGroup,
    addItem,
    updateItem,
    deleteItem,
    login,
    register,
    logout,
    changePassword,
    saveWidget,
    saveData,
    cleanInvalidGroups,
    checkUpdate,
    currentVersion,
    latestVersion,
    hasUpdate,
    fetchSystemConfig,
    updateSystemConfig,
    systemConfig,
    isConnected,
    socket,
    fetchUsers,
    addUser,
    deleteUser,
    uploadLicense,
  };
});
