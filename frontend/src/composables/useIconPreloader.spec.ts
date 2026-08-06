// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useIconPreloader, isRemoteIconUrl } from "./useIconPreloader";
import type { NavItem } from "@/types";

// ============================================================
// Mock 数据：模拟真实 data.json 中的远程 CDN 图标场景
// ============================================================

/** 构造包含多种图标类型的 mock items */
const createMockItems = (): NavItem[] => [
  // 1. 远程 CDN 图标（cdn.simpleicons.org）- 需要预缓存
  {
    id: "item_01",
    title: "Juejin",
    url: "https://juejin.cn",
    icon: "https://cdn.simpleicons.org/juejin",
    isPublic: true,
    iconSize: 90,
  },
  // 2. 远程 CDN 图标 - 需要预缓存
  {
    id: "item_02",
    title: "CSDN",
    url: "https://www.csdn.net",
    icon: "https://cdn.simpleicons.org/csdn",
    isPublic: true,
    iconSize: 75,
  },
  // 3. 远程 CDN 图标 - 需要预缓存
  {
    id: "item_03",
    title: "Stack Overflow",
    url: "https://stackoverflow.com",
    icon: "https://cdn.simpleicons.org/stackoverflow",
    isPublic: true,
    iconSize: 65,
  },
  // 4. 直接 favicon.ico - 需要预缓存
  {
    id: "item_04",
    title: "MDN",
    url: "https://developer.mozilla.org",
    icon: "https://developer.mozilla.org/favicon.ico",
    isPublic: true,
  },
  // 5. 已缓存的本地路径 - 不需要预缓存（跳过）
  {
    id: "item_05",
    title: "淘宝",
    url: "https://www.taobao.com",
    icon: "/icon-cache/1511a82ad0407e8e2539c51d088a6a10736b76896b1ff97f3dbf43d0b7d611c3.webp",
    isPublic: true,
  },
  // 6. 本地静态图标 - 不需要预缓存（跳过）
  {
    id: "item_06",
    title: "豆包",
    url: "https://www.doubao.com",
    icon: "icons/Doubao+豆包+doubao.com.png",
    isPublic: true,
  },
  // 7. SVG 代码图标 - 不需要预缓存（跳过）
  {
    id: "item_07",
    title: "GitHub",
    url: "https://github.com",
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04C6.766 21.367 5.9 19.16 5.9 19.16c-.532-1.354-1.3-1.714-1.3-1.714-1.063-.727.08-.712.08-.712 1.174.083 1.792 1.207 1.792 1.207 1.044 1.787 2.74 1.27 3.408.97.106-.756.408-1.27.743-1.562-2.597-.298-5.33-1.3-5.33-5.784 0-1.277.456-2.322 1.203-3.14-.12-.297-.52-1.487.114-3.097 0 0 .96-.307 3.144 1.2A10.97 10.97 0 0112 5.803c.982.004 1.97.133 2.892.39 2.182-1.507 3.14-1.2 3.14-1.2.636 1.61.236 2.8.116 3.097.75.82 1.2 1.864 1.2 3.14 0 4.495-2.736 5.484-5.342 5.772.42.36.793 1.074.793 2.166 0 1.564-.014 2.826-.014 3.21 0 .322.217.694.824.576C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z"/></svg>',
    isPublic: true,
  },
  // 8. favicon 服务 URL - 需要预缓存（但 favicon 服务失败时不重试）
  {
    id: "item_08",
    title: "V2EX",
    url: "https://www.v2ex.com",
    icon: "https://www.favicon.vip/get.php?url=https%3A%2F%2Fwww.v2ex.com%2F",
    isPublic: true,
  },
  // 9. 无图标的 item - 跳过
  {
    id: "item_09",
    title: "无图标",
    url: "https://example.com",
    icon: "",
    isPublic: true,
  },
  // 10. 又一远程 CDN - 需要预缓存
  {
    id: "item_10",
    title: "GitHub",
    url: "https://github.com",
    icon: "https://cdn.simpleicons.org/github",
    isPublic: true,
  },
];

// ============================================================
// 测试套件
// ============================================================

describe("useIconPreloader", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // --- isRemoteIconUrl 单元测试 ---

  describe("isRemoteIconUrl", () => {
    it("识别远程 CDN URL 为需要缓存", () => {
      expect(isRemoteIconUrl("https://cdn.simpleicons.org/juejin")).toBe(true);
      expect(isRemoteIconUrl("https://developer.mozilla.org/favicon.ico")).toBe(true);
      expect(isRemoteIconUrl("https://www.favicon.vip/get.php?url=xxx")).toBe(true);
    });

    it("跳过已有本地缓存路径", () => {
      expect(isRemoteIconUrl("/icon-cache/abc123.webp")).toBe(false);
      expect(isRemoteIconUrl("/icon-cache/def456.png")).toBe(false);
    });

    it("跳过本地静态图标", () => {
      expect(isRemoteIconUrl("icons/Doubao.png")).toBe(false);
      expect(isRemoteIconUrl("/icons/github.svg")).toBe(false);
    });

    it("跳过 data: 和 blob: URL", () => {
      expect(isRemoteIconUrl("data:image/png;base64,abc")).toBe(false);
      expect(isRemoteIconUrl("blob:http://localhost/abc")).toBe(false);
    });

    it("跳过 SVG 代码和空字符串", () => {
      expect(isRemoteIconUrl("<svg>...</svg>")).toBe(false);
      expect(isRemoteIconUrl("")).toBe(false);
      expect(isRemoteIconUrl("   ")).toBe(false);
    });
  });

  // --- collectRemoteIcons 测试 ---

  describe("collectRemoteIcons", () => {
    it("正确收集所有远程图标，排除本地路径和特殊类型", () => {
      const { collectRemoteIcons } = useIconPreloader();
      const items = createMockItems();
      const urls = collectRemoteIcons(items);

      // 应该有 6 个远程 URL（排除 /icon-cache/、icons/、SVG、空字符串）
      expect(urls).toHaveLength(6);

      // 验证包含的 URL
      expect(urls).toContain("https://cdn.simpleicons.org/juejin");
      expect(urls).toContain("https://cdn.simpleicons.org/csdn");
      expect(urls).toContain("https://cdn.simpleicons.org/stackoverflow");
      expect(urls).toContain("https://cdn.simpleicons.org/github");
      expect(urls).toContain("https://developer.mozilla.org/favicon.ico");
      // favicon.vip URL 也是远程，但可能是 favicon 服务
      expect(urls).toContain(
        "https://www.favicon.vip/get.php?url=https%3A%2F%2Fwww.v2ex.com%2F",
      );

      // 验证不包含的
      expect(urls).not.toContain("/icon-cache/1511a82a.webp");
      expect(urls).not.toContain("icons/Doubao.png");
      expect(urls).not.toContain(expect.stringContaining("<svg"));
    });

    it("空列表返回空数组", () => {
      const { collectRemoteIcons } = useIconPreloader();
      expect(collectRemoteIcons([])).toEqual([]);
    });
  });

  // --- preloadIcons 集成测试 ---

  describe("preloadIcons", () => {
    it("批量预缓存远程图标，成功后回写 items 的 icon 路径", async () => {
      // Mock fetch 返回成功响应
      const cacheMap = new Map<string, string>();
      let callCount = 0;

      // 模拟后端 /api/icon-cache 端点
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url === "/api/icon-cache") {
          callCount++;
          const body = JSON.parse((init?.body as string) || "{}");
          const remoteUrl = body.url || body.dataUrl || "unknown";
          // 模拟：SHA-256 哈希路径
          const fakeHash = `deadbeef${callCount.toString(16).padStart(8, "0")}`;
          const cachedPath = `/icon-cache/${fakeHash}.webp`;
          cacheMap.set(remoteUrl, cachedPath);

          return {
            ok: true,
            json: async () => ({
              success: true,
              path: cachedPath,
              cacheHit: false,
            }),
          } as Response;
        }

        return { ok: false } as Response;
      });

      const { preloadIcons, applyCachedIcons, state } = useIconPreloader();
      const items = createMockItems();

      // 执行预加载
      await preloadIcons(items);

      // 验证状态
      expect(state.value.completed).toBe(true);
      expect(state.value.isPreloading).toBe(false);
      // 应该有 6 个远程 URL（包括 favicon.vip）
      expect(state.value.total).toBe(6);
      expect(state.value.succeeded).toBe(6);
      expect(state.value.failed).toBe(0);
      expect(callCount).toBe(6);

      // 验证结果 Map 中有缓存路径
      for (const [original, cached] of state.value.results.entries()) {
        expect(cached).toMatch(/^\/icon-cache\/[a-f0-9]+\.webp$/);
        expect(original).toMatch(/^https?:\/\//);
      }

      // 回写到 items
      const replaced = applyCachedIcons(items);
      expect(replaced).toBe(6);

      // 验证 items 的 icon 已更新为缓存路径
      const juejinItem = items.find((i) => i.id === "item_01")!;
      expect(juejinItem.icon).toMatch(/^\/icon-cache\//);
      expect(juejinItem.icon).not.toBe("https://cdn.simpleicons.org/juejin");

      // 已缓存的本地路径不变
      const taobaoItem = items.find((i) => i.id === "item_05")!;
      expect(taobaoItem.icon).toBe("/icon-cache/1511a82ad0407e8e2539c51d088a6a10736b76896b1ff97f3dbf43d0b7d611c3.webp");

      // 本地静态图标不变
      const doubaoItem = items.find((i) => i.id === "item_06")!;
      expect(doubaoItem.icon).toBe("icons/Doubao+豆包+doubao.com.png");
    });

    it("单个图标缓存失败不影响其他图标（错误隔离）", async () => {
      // Mock: 第 3 个请求失败
      let callCount = 0;
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/icon-cache") {
          callCount++;
          const body = JSON.parse((init?.body as string) || "{}");
          const remoteUrl = body.url || "";

          if (remoteUrl.includes("stackoverflow")) {
            // 模拟失败
            return {
              ok: false,
              status: 502,
              json: async () => ({
                success: false,
                error: { message: "Upstream fetch failed" },
              }),
            } as Response;
          }

          return {
            ok: true,
            json: async () => ({
              success: true,
              path: `/icon-cache/cached_${callCount}.webp`,
            }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      const { preloadIcons, state } = useIconPreloader();
      const items = createMockItems();

      await preloadIcons(items);

      // stackoverflow 失败，其他成功
      expect(state.value.succeeded).toBe(5); // 6 total - 1 failed
      expect(state.value.failed).toBe(1);
      expect(state.value.completed).toBe(true);
    });

    it("favicon 服务失败不重试，直接放弃", async () => {
      let faviconCallCount = 0;
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/icon-cache") {
          const body = JSON.parse((init?.body as string) || "{}");
          const remoteUrl = body.url || "";

          if (remoteUrl.includes("favicon.vip")) {
            faviconCallCount++;
            return {
              ok: false,
              status: 502,
              json: async () => ({ success: false }),
            } as Response;
          }

          return {
            ok: true,
            json: async () => ({
              success: true,
              path: `/icon-cache/ok.webp`,
            }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      const { preloadIcons, state } = useIconPreloader();
      const items = createMockItems();

      await preloadIcons(items);

      // favicon.vip 只调用 1 次（不重试）
      expect(faviconCallCount).toBe(1);
      expect(state.value.failed).toBe(1);
    });

    it("空列表快速返回，不发送请求", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      const { preloadIcons, state } = useIconPreloader();
      await preloadIcons([]);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(state.value.completed).toBe(true);
      expect(state.value.total).toBe(0);
    });

    it("重复调用不会触发多次预加载", async () => {
      let fetchCount = 0;
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/icon-cache") {
          fetchCount++;
          const body = JSON.parse((init?.body as string) || "{}");
          return {
            ok: true,
            json: async () => ({
              success: true,
              path: `/icon-cache/${body.url?.replace(/[^a-z]/g, "") || "x"}.webp`,
            }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      const { preloadIcons } = useIconPreloader();
      const items = createMockItems();

      // 第一次调用
      await preloadIcons(items);
      const firstCount = fetchCount;

      // 第二次调用（应该被跳过）
      await preloadIcons(items);
      expect(fetchCount).toBe(firstCount);
    });
  });

  // --- getCachedUrl 测试 ---

  describe("getCachedUrl", () => {
    it("返回已缓存的路径，未缓存则返回原始 URL", async () => {
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/icon-cache") {
          const body = JSON.parse((init?.body as string) || "{}");
          return {
            ok: true,
            json: async () => ({
              success: true,
              path: `/icon-cache/cached_${body.url ? "ok" : "x"}.webp`,
            }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      const { preloadIcons, getCachedUrl } = useIconPreloader();

      // 先预加载
      const items = createMockItems();
      await preloadIcons(items);

      // 验证缓存命中
      const cachedJuejin = getCachedUrl("https://cdn.simpleicons.org/juejin");
      expect(cachedJuejin).toMatch(/^\/icon-cache\//);

      // 未缓存的 URL 返回原值
      const unknown = getCachedUrl("https://never.seen.before/icon.png");
      expect(unknown).toBe("https://never.seen.before/icon.png");
    });
  });

  // --- 并发控制测试 ---

  describe("并发控制", () => {
    it("分批次处理，每批最多 MAX_CONCURRENT=6 个请求", async () => {
      let maxConcurrent = 0;
      let inFlight = 0;

      global.fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        // 使用真实微任务延迟模拟网络请求
        await Promise.resolve();
        inFlight--;
        return {
          ok: true,
          json: async () => ({ success: true, path: "/icon-cache/x.webp" }),
        } as Response;
      });

      const { preloadIcons, state } = useIconPreloader();
      const items = createMockItems();

      await preloadIcons(items);

      // 6 个远程 URL，MAX_CONCURRENT=6，所以一批完成
      expect(state.value.total).toBe(6);
      expect(state.value.succeeded).toBe(6);
      // 并发数不超过上限
      expect(maxConcurrent).toBeLessThanOrEqual(6);
      expect(maxConcurrent).toBeGreaterThan(0);
    });

    it("超过 MAX_CONCURRENT 时分批处理", async () => {
      // 构造 15 个远程图标来测试分批
      const manyItems: NavItem[] = Array.from({ length: 15 }, (_, i) => ({
        id: `item_${i}`,
        title: `Test ${i}`,
        url: `https://example${i}.com`,
        icon: `https://cdn.simpleicons.org/test${i}`,
        isPublic: true,
      }));

      global.fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        await Promise.resolve();
        return {
          ok: true,
          json: async () => ({ success: true, path: "/icon-cache/x.webp" }),
        } as Response;
      });

      const { preloadIcons, state } = useIconPreloader();

      await preloadIcons(manyItems);

      expect(state.value.total).toBe(15);
      expect(state.value.succeeded).toBe(15);
      expect(state.value.failed).toBe(0);
    });
  });
});
