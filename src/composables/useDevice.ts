import { computed, type Ref } from "vue";
import { useWindowSize } from "@vueuse/core";

export function useDevice(deviceMode?: Ref<"auto" | "desktop" | "tablet" | "mobile" | undefined>) {
  const { width } = useWindowSize();
  const autoKey = computed(() => {
    const w = width.value;
    if (w < 768) return "mobile" as const;
    if (w < 1024) return "tablet" as const;
    return "desktop" as const;
  });
  const deviceKey = computed(() => {
    const mode = deviceMode?.value || "auto";
    if (mode === "auto") return autoKey.value;
    if (mode === "desktop" || mode === "tablet" || mode === "mobile") return mode;
    return autoKey.value;
  });
  const isMobile = computed(() => deviceKey.value === "mobile");
  const isTablet = computed(() => deviceKey.value === "tablet");
  const isDesktop = computed(() => deviceKey.value === "desktop");
  return { deviceKey, isMobile, isTablet, isDesktop };
}
