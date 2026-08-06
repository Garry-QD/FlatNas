import { createI18n, type I18n } from "vue-i18n";
import zhCNCommon from "@/locales/zh-CN/common.json";
import zhCNSettings from "@/locales/zh-CN/settings.json";

// 默认语言内联打包进主 chunk，零额外首屏开销
const defaultMessages = {
  common: zhCNCommon,
  settings: zhCNSettings,
};

export const SUPPORTED_LOCALES = ["zh-CN", "en-US", "ja-JP", "de-DE", "zh-TW", "fr-FR", "es-ES"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "zh-CN";

/** 全局 i18n 实例引用（供 Pinia store 等非组件上下文使用） */
let i18nGlobalInstance: I18n["global"] | null = null;

export function getI18n(): I18n["global"] {
  if (!i18nGlobalInstance) {
    throw new Error("i18n has not been initialized yet. Call createAppI18n() first.");
  }
  return i18nGlobalInstance;
}

export function createAppI18n(): I18n {
  const i18n = createI18n({
    legacy: false, // Composition API 模式
    locale: DEFAULT_LOCALE,
    fallbackLocale: DEFAULT_LOCALE,
    messages: {
      [DEFAULT_LOCALE]: defaultMessages,
    },
  });
  i18nGlobalInstance = i18n.global;
  return i18n;
}
