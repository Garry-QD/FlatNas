// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import SettingsModal from "../../src/components/SettingsModal.vue";
import { useMainStore } from "../../src/stores/main";

// Mock child components to avoid rendering issues
vi.mock("../../src/components/IconUploader.vue", () => ({ default: { template: "<div></div>" } }));
vi.mock("../../src/components/WallpaperLibrary.vue", () => ({
  default: { template: "<div></div>" },
}));
vi.mock("../../src/components/PasswordConfirmModal.vue", () => ({
  default: { template: "<div></div>" },
}));
vi.mock("../../src/components/DockerWidget.vue", () => ({ default: { template: "<div></div>" } }));
vi.mock("../../src/components/SystemStatusWidget.vue", () => ({
  default: { template: "<div></div>" },
}));
vi.mock("../../src/components/RssSettings.vue", () => ({ default: { template: "<div></div>" } }));
vi.mock("../../src/components/SearchSettings.vue", () => ({
  default: { template: "<div></div>" },
}));
vi.mock("vue-draggable-plus", () => ({ VueDraggable: { template: "<div><slot></slot></div>" } }));

// Mock localStorage
const localStorageMock = (function () {
  let store: Record<string, string> = {};
  return {
    getItem: function (key: string) {
      return store[key] || null;
    },
    setItem: function (key: string, value: string) {
      store[key] = value.toString();
    },
    clear: function () {
      store = {};
    },
    removeItem: function (key: string) {
      delete store[key];
    },
  };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

describe("SettingsModal Custom JS Logic", () => {
  it("shows disclaimer by default and hides textarea", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useMainStore();
    store.appConfig.customJsDisclaimerAgreed = false;

    const wrapper = mount(SettingsModal, {
      props: { show: true },
      global: { plugins: [pinia] },
    });

    // Switch to "开放中心" tab (activeTab = 'lucky-stun')
    // We need to access internal state or trigger the tab click.
    // Finding the button for "开放中心"
    const buttons = wrapper.findAll("button");
    const openCenterBtn = buttons.find((b) => b.text().includes("开放中心"));
    expect(openCenterBtn).toBeTruthy();
    await openCenterBtn?.trigger("click");

    // Check for disclaimer
    expect(wrapper.text()).toContain("安全免责声明");
    expect(wrapper.text()).toContain("XSS (跨站脚本) 攻击风险");

    // Textarea should not be visible (v-else)
    const textarea = wrapper.find('textarea[placeholder*="console.log"]');
    expect(textarea.exists()).toBe(false);
  });

  it("shows textarea after agreeing to disclaimer", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useMainStore();
    store.appConfig.customJsDisclaimerAgreed = false;

    const wrapper = mount(SettingsModal, {
      props: { show: true },
      global: { plugins: [pinia] },
    });

    // Switch to tab
    const buttons = wrapper.findAll("button");
    const openCenterBtn = buttons.find((b) => b.text().includes("开放中心"));
    await openCenterBtn?.trigger("click");

    // Find checkbox and check it
    const checkbox = wrapper.find('input[type="checkbox"]'); // There might be multiple checkboxes, need to be specific
    // The disclaimer checkbox is inside the warning box.
    // Let's find the specific label text "我已阅读并同意"
    const labels = wrapper.findAll("label");
    const disclaimerLabel = labels.find((l) => l.text().includes("我已阅读并同意"));
    expect(disclaimerLabel).toBeTruthy();

    const disclaimerCheckbox = disclaimerLabel?.find('input[type="checkbox"]');
    await disclaimerCheckbox?.setValue(true);

    // Verify store update
    expect(store.appConfig.customJsDisclaimerAgreed).toBe(true);

    // Verify textarea visibility
    const textarea = wrapper.find('textarea[placeholder*="console.log"]');
    expect(textarea.exists()).toBe(true);
  });
});
