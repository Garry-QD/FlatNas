import { ref, computed, watch } from "vue";
import { defineStore } from "pinia";
import { io } from "socket.io-client";
import type { NavItem, NavGroup, AppConfig, WidgetConfig, RssFeed, RssCategory } from "@/types";

export const useMainStore = defineStore("main", () => {
  const socket = io();
  const isConnected = ref(false);
  // Flag to prevent save loop when receiving remote updates
  const isRemoteUpdate = ref(false);

  socket.on("connect", () => {
    isConnected.value = true;
  });
  socket.on("disconnect", () => {
    isConnected.value = false;
  });

  socket.on("data-updated", async (data: { username: string }) => {
    // Only refresh if we are logged in as this user
    // Or if we are in single user mode (username might be empty/admin depending on implementation)
    // Here we check if the updated data belongs to current user
    if (data.username === username.value) {
      console.log("[Store] Received remote data update, refreshing...");
      isRemoteUpdate.value = true;
      await init();
      // Reset flag after a short delay to ensure watch callbacks have fired and been ignored
      setTimeout(() => {
        isRemoteUpdate.value = false;
      }, 1000);
    }
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
  const currentVersion = "1.0.22";
  const latestVersion = ref("");
  const dockerUpdateAvailable = ref(false);

  const compareVersions = (v1: string, v2: string) => {
    const parts1 = v1.replace(/^v/, "").split(".").map(Number);
    const parts2 = v2.replace(/^v/, "").split(".").map(Number);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  };

  const hasUpdate = computed(() => {
    // 1. Version Check (Gitee)
    if (latestVersion.value) {
      const cmp = compareVersions(latestVersion.value, currentVersion);
      if (cmp > 0) return true; // Remote > Local
      if (cmp < 0) return false; // Local > Remote (Dev)
    }

    // 2. Fallback to Docker Check (only if versions match or unknown)
    return dockerUpdateAvailable.value;
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
      if (!import.meta.env.DEV) {
        const res = await fetch("/api/docker-status");
        if (res.ok) {
          const data = await res.json();
          if (data.hasUpdate) {
            dockerUpdateAvailable.value = true;
          }
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
    pcRotation: false,
    pcRotationInterval: 30, // Default 30 minutes
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
    showFooterStats: false,
    footerHtml: "",
    footerHeight: 0,
    footerWidth: 1280,
    footerMarginBottom: 0,
    footerFontSize: 12,
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

      if (data.widgets) {
        widgets.value = data.widgets;
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
    } catch (e) {
      console.error("加载失败", e);
    }
  };

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const saveData = async (immediate = false) => {
    if (saveTimer) clearTimeout(saveTimer);

    const doSave = async () => {
      try {
        const res = await fetch("/api/save", {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({
            groups: groups.value,
            widgets: widgets.value,
            appConfig: appConfig.value,
            password: password.value, // Will handle password change logic on server
            rssFeeds: rssFeeds.value,
            rssCategories: rssCategories.value,
          }),
        });

        if (res.status === 401) {
          // 如果未授权，提示用户登录
          if (confirm("保存失败：未登录或登录已过期。\n是否现在登录？")) {
            // 这里可以触发登录弹窗，或者简单的跳转到登录（如果有专门的登录页）
            // 由于目前登录是弹窗形式，我们可能需要通过状态来控制
            // 简单做法：刷新页面让用户重新登录
            // window.location.reload();
            // 更好的做法：抛出一个事件让 App.vue 打开登录弹窗，但这里在 store 里比较麻烦
            // 暂时先提示，后续可以优化为打开 SettingsModal
          }
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

  watch(
    [groups, widgets, appConfig, password, rssFeeds, rssCategories],
    () => {
      if (!isRemoteUpdate.value) {
        saveData();
      }
    },
    {
      deep: true,
    },
  );

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

  return {
    groups,
    items,
    widgets,
    appConfig,
    password,
    isLogged,
    username, // Export username
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
