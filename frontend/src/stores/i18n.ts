import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import type { SupportedLocale } from "@/plugins/i18n";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, getI18n } from "@/plugins/i18n";

export type { SupportedLocale } from "@/plugins/i18n";

/**
 * i18n 状态管理 Store
 * - 维护当前语言状态
 * - 按需动态加载语言包（import() 异步模块）
 * - 持久化到 localStorage
 */
export const useI18nStore = defineStore("i18n", () => {
  // Pinia setup store 不在 Vue 组件上下文中，不能调用 useI18n()，
  // 需要通过模块级单例 getI18n() 获取 i18n 实例
  const i18n = getI18n();

  const currentLocale = ref<SupportedLocale>(DEFAULT_LOCALE);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const availableLocales = computed(() => [...SUPPORTED_LOCALES]);

  const isRTL = computed(() => false);

  /**
   * 切换语言并动态加载语言包
   * @param persist - 是否持久化到 localStorage（用户手动选择时 true，初始化自动检测时 false）
   */
  async function setLocale(locale: SupportedLocale, persist = false) {
    if (locale === currentLocale.value) return;
    if (!SUPPORTED_LOCALES.includes(locale)) {
      console.warn(`Unsupported locale: ${locale}`);
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      // 如果语言包未加载，动态 import（common + settings）
      const messages = (i18n.messages as { value: Record<string, unknown> }).value;
      if (!messages[locale]) {
        const [common, settings] = await Promise.all([
          import(`@/locales/${locale}/common.json`),
          import(`@/locales/${locale}/settings.json`),
        ]);
        i18n.setLocaleMessage(locale, {
          common: common.default,
          settings: settings.default,
        });
      }

      currentLocale.value = locale;
      const localeRef = i18n.locale;
      if (typeof localeRef !== "string") {
        (localeRef as { value: string }).value = locale;
      }

      // 仅用户手动切换时持久化到 localStorage
      if (persist) {
        localStorage.setItem("flatnas-locale", locale);
      }
    } catch (e) {
      error.value = (e as Error).message;
      console.error("Failed to load locale:", e);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 初始化：用户手动选择 > 浏览器语言（首次访问）> 默认中文
   */
  function initLocale(savedLocale?: string) {
    const stored = localStorage.getItem("flatnas-locale");
    const browserLang = navigator.language;
    let locale: string;

    if (savedLocale) {
      locale = savedLocale;
    } else if (stored && SUPPORTED_LOCALES.includes(stored as SupportedLocale)) {
      // 用户手动选择的语言优先
      locale = stored;
    } else if (browserLang && SUPPORTED_LOCALES.includes(browserLang as SupportedLocale)) {
      // 首次访问时匹配浏览器语言
      locale = browserLang;
    } else {
      locale = DEFAULT_LOCALE;
    }

    if (SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
      void setLocale(locale as SupportedLocale, false);
    }
  }

  return {
    currentLocale,
    loading,
    error,
    availableLocales,
    isRTL,
    setLocale,
    initLocale,
  };
});

/**
 * Composable 封装：便捷访问 i18n 实例
 */
export function useAppI18n() {
  const i18n = useI18n();
  const store = useI18nStore();

  return {
    t: i18n.t,
    locale: i18n.locale,
    currentLocale: store.currentLocale,
    availableLocales: store.availableLocales,
    setLocale: store.setLocale,
    loading: store.loading,
  };
}
