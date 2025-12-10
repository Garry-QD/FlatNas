import fs from "fs/promises";

// import { fileURLToPath } from 'url'
// const __filename = fileURLToPath(import.meta.url)
// const __dirname = path.dirname(__filename)

const SUNPANEL_CONFIG_PATH = "c:\\Users\\80425\\Desktop\\SunPanel-Data202512070151.sun-panel.json";
const FLATNAS_API_URL = "http://localhost:3000/api/data";

async function getAutoIcon(url) {
  if (!url) return "";
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // 尝试几个常用的图标获取服务
    const candidates = [
      `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
      `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`,
      `https://api.iowen.cn/favicon/${hostname}.png`,
    ];

    for (const src of candidates) {
      try {
        const res = await fetch(src);
        if (res.ok && res.headers.get("content-type")?.startsWith("image")) {
          return src;
        }
      } catch {
        continue;
      }
    }
  } catch {
    console.warn(`无法解析 URL: ${url}`);
  }
  return "";
}

async function importSunPanelConfig() {
  try {
    // 1. 读取 SunPanel 配置文件
    const sunPanelConfigContent = await fs.readFile(SUNPANEL_CONFIG_PATH, "utf-8");
    const sunPanelConfig = JSON.parse(sunPanelConfigContent);

    if (!sunPanelConfig.icons || !Array.isArray(sunPanelConfig.icons)) {
      console.error('SunPanel config does not contain a valid "icons" array.');
      return;
    }

    // 2. 解析并转换数据
    const flatNasGroups = [];
    console.log(`开始处理 ${sunPanelConfig.icons.length} 个分组...`);

    for (let groupIndex = 0; groupIndex < sunPanelConfig.icons.length; groupIndex++) {
      const group = sunPanelConfig.icons[groupIndex];
      const navItems = [];
      const children = group.children || [];

      console.log(
        `处理分组 [${groupIndex + 1}/${sunPanelConfig.icons.length}]: ${group.title || "未知分组"}`,
      );

      for (let itemIndex = 0; itemIndex < children.length; itemIndex++) {
        const item = children[itemIndex];
        let icon = item.icon?.src || "";
        const targetUrl = item.url || item.lanUrl;

        // 如果没有图标且有 URL，尝试自动获取
        if (!icon && targetUrl) {
          // console.log(`  正在获取图标: ${item.title} (${targetUrl})...`);
          const autoIcon = await getAutoIcon(targetUrl);
          if (autoIcon) {
            icon = autoIcon;
            // console.log(`  -> 获取成功: ${icon}`);
          }
        }

        navItems.push({
          id: `item-${groupIndex}-${itemIndex}-${Date.now()}`,
          title: item.title || "未知标题",
          url: item.url || "",
          lanUrl: item.lanUrl || "",
          icon: icon,
          isPublic: true, // 默认设置为公开
        });
      }

      flatNasGroups.push({
        id: `group-${groupIndex}-${Date.now()}`,
        title: group.title || "未知分组",
        items: navItems,
        preset: false, // 导入的组不是预设的
      });
    }

    // 获取当前的 FlatNas 配置，以便合并
    const currentFlatNasConfigRes = await fetch(FLATNAS_API_URL);
    const currentFlatNasConfig = await currentFlatNasConfigRes.json();

    // 合并新的分组到现有配置中
    const updatedFlatNasConfig = {
      ...currentFlatNasConfig,
      groups: [...(currentFlatNasConfig.groups || []), ...flatNasGroups],
    };

    // 3. 调用导入 API
    const response = await fetch(FLATNAS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatedFlatNasConfig),
    });

    if (response.ok) {
      console.log("SunPanel 配置已成功导入到 FlatNas。");
    } else {
      const errorText = await response.text();
      console.error(`导入失败: ${response.status} ${response.statusText} - ${errorText}`);
    }
  } catch (error) {
    console.error("导入过程中发生错误:", error);
  }
}

importSunPanelConfig();
