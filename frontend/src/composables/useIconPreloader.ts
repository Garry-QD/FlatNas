/**
 * useIconPreloader - 图标预加载与缓存机制
 *
 * 解决首次加载时远程图标（如 cdn.simpleicons.org）加载失败的问题：
 * 1. 扫描所有 items/widgets 中的图标 URL
 * 2. 将远程图标通过 /api/icon-cache 缓存到本地磁盘
 * 3. 返回缓存路径，避免直接依赖外部 CDN
 * 4. 支持去重、批量并发、错误隔离、重试机制
 */

import { ref } from "vue";
import type { NavItem, WidgetConfig } from "@/types";

const ICON_LOCAL_PREFIXES = [
  "/icon-cache/",
  "/icons/",
  "data:",
  "blob:",
] as const;

const MAX_CONCURRENT = 6;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/** 判断图标是否为需要缓存的外部 URL */
export const isRemoteIconUrl = (url: string): boolean => {
  const trimmed = url.trim();
  if (!trimmed) return false;
  // 已是本地缓存或本地资源
  for (const prefix of ICON_LOCAL_PREFIXES) {
    if (trimmed.startsWith(prefix)) return false;
  }
  // SVG 代码不需要缓存
  if (trimmed.startsWith("<svg")) return false;
  // 外部 http/https URL 需要缓存
  return /^https?:\/\//i.test(trimmed);
};

/** 判断图标是否为远程 favicon 服务 URL */
const isFaviconServiceUrl = (url: string): boolean => {
  const lowered = url.toLowerCase();
  return (
    lowered.includes("favicon.vip/") ||
    lowered.includes("api.afmax.cn/") ||
    lowered.includes("api.quickso.cn/") ||
    lowered.includes("icon.bqb.cool/")
  );
};

interface IconCacheResult {
  original: string;
  cached: string | null;
  error: string | null;
}

interface PreloaderState {
  isPreloading: boolean;
  completed: boolean;
  total: number;
  succeeded: number;
  failed: number;
  results: Map<string, string>; // original URL -> cached path
}

/**
 * 图标预加载 composable
 * 在数据加载完成后调用，批量缓存远程图标到本地
 */
export const useIconPreloader = () => {
  const state = ref<PreloaderState>({
    isPreloading: false,
    completed: false,
    total: 0,
    succeeded: 0,
    failed: 0,
    results: new Map(),
  });

  /** 从 items/widgets 中收集所有需要缓存的远程图标 */
  const collectRemoteIcons = (
    items: NavItem[],
    widgets?: WidgetConfig[],
  ): string[] => {
    const iconSet = new Set<string>();

    // 收集 nav items 的图标
    for (const item of items) {
      const icon = (item.icon || "").trim();
      if (isRemoteIconUrl(icon)) {
        iconSet.add(icon);
      }
    }

    // 收集 widget data 中的图标 (bookmarks 等)
    if (widgets) {
      for (const widget of widgets) {
        if (!widget.data) continue;
        if (Array.isArray(widget.data)) {
          for (const entry of widget.data as unknown[]) {
            if (entry && typeof entry === "object") {
              const e = entry as Record<string, unknown>;
              if (Array.isArray(e.children)) {
                for (const child of e.children as unknown[]) {
                  if (child && typeof child === "object") {
                    const icon = String(
                      (child as Record<string, unknown>).icon || "",
                    ).trim();
                    if (isRemoteIconUrl(icon)) iconSet.add(icon);
                  }
                }
              }
            }
          }
        }
      }
    }

    return Array.from(iconSet);
  };

  /** 归一化 icon URL 用于缓存 API */
  const normalizeIconUrl = (value: string): { url?: string; dataUrl?: string } | null => {
    if (value.startsWith("data:")) {
      return { dataUrl: value };
    }
    if (/^https?:\/\//i.test(value)) {
      return { url: value };
    }
    return null;
  };

  /** 缓存单个图标到本地，带重试 */
  const cacheSingleIcon = async (
    iconUrl: string,
    retries = MAX_RETRIES,
  ): Promise<IconCacheResult> => {
    const payload = normalizeIconUrl(iconUrl);
    if (!payload) {
      return { original: iconUrl, cached: null, error: "无法归一化图标 URL" };
    }

    let lastError: string | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch("/api/icon-cache", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json().catch(() => null);

        if (res.ok && data?.success && typeof data.path === "string" && data.path) {
          return { original: iconUrl, cached: data.path, error: null };
        }

        // 如果是 favicon 服务失败，直接放弃（不重试）
        if (isFaviconServiceUrl(iconUrl)) {
          return {
            original: iconUrl,
            cached: null,
            error: "favicon 服务暂不可用，将直接使用远程地址",
          };
        }

        const errMsg =
          data?.error?.message || `HTTP ${res.status}: 缓存请求失败`;
        lastError = errMsg;
      } catch (e) {
        lastError = e instanceof Error ? e.message : "网络请求异常";
      }

      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      }
    }

    return { original: iconUrl, cached: null, error: lastError };
  };

  /** 批量缓存远程图标，控制并发数 */
  const preloadIcons = async (
    items: NavItem[],
    widgets?: WidgetConfig[],
  ): Promise<void> => {
    if (state.value.isPreloading || state.value.completed) return;

    const remoteIcons = collectRemoteIcons(items, widgets);
    if (remoteIcons.length === 0) {
      state.value.completed = true;
      return;
    }

    state.value = {
      isPreloading: true,
      completed: false,
      total: remoteIcons.length,
      succeeded: 0,
      failed: 0,
      results: new Map(),
    };

    // 分批并发处理
    for (let i = 0; i < remoteIcons.length; i += MAX_CONCURRENT) {
      const batch = remoteIcons.slice(i, i + MAX_CONCURRENT);
      const results = await Promise.allSettled(
        batch.map((url) => cacheSingleIcon(url)),
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          if (result.value.cached) {
            state.value.succeeded++;
            state.value.results.set(result.value.original, result.value.cached);
          } else {
            state.value.failed++;
            if (result.value.error) {
              console.warn(
                `[IconPreloader] 图标缓存失败: ${result.value.original} - ${result.value.error}`,
              );
            }
          }
        } else {
          state.value.failed++;
          console.warn(
            `[IconPreloader] 图标缓存异常: ${batch[0]} - ${result.reason}`,
          );
        }
      }
    }

    state.value.isPreloading = false;
    state.value.completed = true;

    if (state.value.succeeded > 0) {
      console.log(
        `[IconPreloader] 完成: ${state.value.succeeded}/${state.value.total} 个图标已缓存，${state.value.failed} 个失败`,
      );
    }
  };

  /** 获取已缓存的路径，如果未缓存则返回原始 URL */
  const getCachedUrl = (originalUrl: string): string => {
    return state.value.results.get(originalUrl) || originalUrl;
  };

  /**
   * 将预加载结果应用到 items，原地替换 icon 路径
   * 返回替换数量
   */
  const applyCachedIcons = (items: NavItem[]): number => {
    if (state.value.results.size === 0) return 0;

    let replaced = 0;
    for (const item of items) {
      const icon = (item.icon || "").trim();
      const cached = state.value.results.get(icon);
      if (cached) {
        item.icon = cached;
        replaced++;
      }
    }
    return replaced;
  };

  return {
    state,
    preloadIcons,
    getCachedUrl,
    applyCachedIcons,
    collectRemoteIcons,
    isRemoteIconUrl,
  };
};
