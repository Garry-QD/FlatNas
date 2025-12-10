import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import MemoWidget from "../../src/components/MemoWidget.vue";
import TodoWidget from "../../src/components/TodoWidget.vue";
import { useMainStore } from "../../src/stores/main";
import type { TodoItem } from "../../src/types";

describe("Widget Auto Save Logic", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("MemoWidget calls saveWidget on input change", async () => {
    const store = useMainStore();

    // Force isLogged to be true
    Object.defineProperty(store, "isLogged", { get: () => true });

    store.saveWidget = vi.fn().mockResolvedValue(undefined);

    const widget = reactive({
      id: "m1",
      type: "memo",
      data: "initial",
      enable: true,
      isPublic: false,
    });
    const wrapper = mount(MemoWidget, {
      props: { widget },
    });

    const textarea = wrapper.find("textarea");
    await textarea.setValue("new content");

    // Trigger debounce (1000ms)
    vi.advanceTimersByTime(2000);

    expect(store.saveWidget).toHaveBeenCalledWith("m1", "new content");
    expect(widget.data).toBe("new content");
  });

  it("TodoWidget calls saveWidget on add item", async () => {
    const store = useMainStore();
    Object.defineProperty(store, "isLogged", { get: () => true });
    store.saveWidget = vi.fn().mockResolvedValue(undefined);

    const widget = reactive<{
      id: string;
      type: string;
      data: TodoItem[];
      enable: boolean;
      isPublic: boolean;
    }>({ id: "t1", type: "todo", data: [], enable: true, isPublic: false });
    const wrapper = mount(TodoWidget, {
      props: { widget },
    });

    const input = wrapper.find('input[placeholder="添加待办..."]');
    await input.setValue("Task 1");
    await input.trigger("keyup.enter");

    // Trigger debounce (500ms)
    vi.advanceTimersByTime(1000);

    expect(store.saveWidget).toHaveBeenCalled();
    expect(widget.data).toHaveLength(1);
    const first = widget.data[0]!;
    expect(first.text).toBe("Task 1");
  });
});
