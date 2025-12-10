/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { createApp } from "vue";
import { createPinia } from "pinia";
import GridPanel from "@/components/GridPanel.vue";

describe("GridPanel", () => {
  it("imports and mounts with Pinia without error", () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ groups: [], widgets: [], appConfig: {} }),
    });
    expect(GridPanel).toBeDefined();
    vi.spyOn(window, "open").mockImplementation(() => null);
    const app = createApp(GridPanel);
    app.use(createPinia());
    const el = document.createElement("div");
    document.body.appendChild(el);
    app.mount(el);
    app.unmount();
    expect(true).toBe(true);
  });
});
