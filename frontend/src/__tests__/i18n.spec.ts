/**
 * i18n 国际化自动化验证测试
 * 覆盖：语言包文件存在性、JSON 合法性、键结构一致性、空值检测、配置注册一致性
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_LOCALES } from "@/plugins/i18n";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "..", "locales");

// ─── 辅助函数 ───

/** 递归收集 JSON 对象中所有叶子节点的路径 (如 "messages.saved") */
function collectLeafPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      paths.push(...collectLeafPaths(val as Record<string, unknown>, fullKey));
    } else {
      paths.push(fullKey);
    }
  }
  return paths.sort();
}

/** 根据点分路径取值 */
function getValueByPath(obj: Record<string, unknown>, dotPath: string): unknown {
  const segments = dotPath.split(".");
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

// ─── 测试 ───

describe("i18n 语言包完整性验证", () => {
  const allLocales = [...SUPPORTED_LOCALES];
  const localeFiles = ["common.json", "settings.json"] as const;

  // 加载参考语言 (zh-CN)
  const zhCNCommon = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, "zh-CN", "common.json"), "utf-8")
  );
  const zhCNSettings = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, "zh-CN", "settings.json"), "utf-8")
  );
  const zhCNCommonKeys = collectLeafPaths(zhCNCommon);
  const zhCNSettingsKeys = collectLeafPaths(zhCNSettings);

  // ── 1. 文件存在性 ──

  describe("语言包文件存在性", () => {
    for (const locale of allLocales) {
      for (const file of localeFiles) {
        it(`${locale}/${file} 应存在`, () => {
          const filePath = path.join(LOCALES_DIR, locale, file);
          expect(fs.existsSync(filePath)).toBe(true);
        });
      }
    }
  });

  // ── 2. JSON 合法性 ──

  describe("JSON 格式合法性", () => {
    for (const locale of allLocales) {
      for (const file of localeFiles) {
        it(`${locale}/${file} 应为合法 JSON`, () => {
          const filePath = path.join(LOCALES_DIR, locale, file);
          const raw = fs.readFileSync(filePath, "utf-8");
          expect(() => JSON.parse(raw)).not.toThrow();
          const parsed = JSON.parse(raw);
          expect(typeof parsed).toBe("object");
          expect(parsed).not.toBeNull();
        });
      }
    }
  });

  // ── 3. 键结构一致性 (以 zh-CN 为基准) ──

  describe("键结构一致性 — common.json", () => {
    for (const locale of allLocales) {
      if (locale === "zh-CN") continue;
      it(`${locale} 的 common.json 键应与 zh-CN 一致`, () => {
        const target = JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, locale, "common.json"), "utf-8")
        );
        const targetKeys = collectLeafPaths(target);
        expect(targetKeys).toEqual(zhCNCommonKeys);
      });
    }
  });

  describe("键结构一致性 — settings.json", () => {
    for (const locale of allLocales) {
      if (locale === "zh-CN") continue;
      it(`${locale} 的 settings.json 键应与 zh-CN 一致`, () => {
        const target = JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, locale, "settings.json"), "utf-8")
        );
        const targetKeys = collectLeafPaths(target);
        expect(targetKeys).toEqual(zhCNSettingsKeys);
      });
    }
  });

  // ── 4. 翻译值非空检测 ──

  describe("翻译值不应为空字符串", () => {
    for (const locale of allLocales) {
      for (const file of localeFiles) {
        it(`${locale}/${file} 中不应有空值`, () => {
          const filePath = path.join(LOCALES_DIR, locale, file);
          const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          const leaves = collectLeafPaths(parsed);
          const emptyKeys = leaves.filter((k) => {
            const v = getValueByPath(parsed, k);
            return typeof v === "string" && v.trim() === "";
          });
          expect(emptyKeys).toEqual([]);
        });
      }
    }
  });

  // ── 5. zh-CN 值不应被原样复制到其他语言 (翻译不应等于原文) ──

  describe("翻译值不应与 zh-CN 完全相同（非中文语言）", () => {
    const nonChineseLocales = allLocales.filter((l) => l !== "zh-CN" && l !== "zh-TW");

    for (const locale of nonChineseLocales) {
      for (const file of localeFiles) {
        const refFile = file as string;
        it(`${locale}/${refFile} 值不应与 zh-CN 完全一致`, () => {
          const refParsed = JSON.parse(
            fs.readFileSync(path.join(LOCALES_DIR, "zh-CN", refFile), "utf-8")
          );
          const targetParsed = JSON.parse(
            fs.readFileSync(path.join(LOCALES_DIR, locale, refFile), "utf-8")
          );
          const refLeaves = collectLeafPaths(refParsed);

          // 至少 80% 的键值应不同 (允许少量通用词如品牌名、占位符等相同)
          let sameCount = 0;
          for (const key of refLeaves) {
            const refVal = getValueByPath(refParsed, key);
            const targetVal = getValueByPath(targetParsed, key);
            if (refVal === targetVal) sameCount++;
          }
          const sameRatio = sameCount / refLeaves.length;
          expect(sameRatio).toBeLessThan(0.2);
        });
      }
    }
  });

  // ── 6. i18n 配置一致性 ──

  describe("i18n 配置注册一致性", () => {
    it("SUPPORTED_LOCALES 应包含默认语言 zh-CN", () => {
      expect(SUPPORTED_LOCALES).toContain("zh-CN");
    });

    it("SUPPORTED_LOCALES 中每个语言都有对应目录", () => {
      for (const locale of allLocales) {
        const dir = path.join(LOCALES_DIR, locale);
        expect(fs.existsSync(dir)).toBe(true);
        expect(fs.statSync(dir).isDirectory()).toBe(true);
      }
    });

    it("locales 目录中不应存在未注册的语言目录", () => {
      const dirs = fs.readdirSync(LOCALES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      const registered = new Set(allLocales);
      const unregistered = dirs.filter((d) => !registered.has(d as (typeof allLocales)[number]));
      expect(unregistered).toEqual([]);
    });
  });
});
