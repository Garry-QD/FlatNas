import { ref, watch, onMounted, onUnmounted } from "vue";
import { useMainStore } from "../stores/main";

export function useWallpaperRotation() {
  const store = useMainStore();

  const pcWallpapers = ref<string[]>([]);
  const mobileWallpapers = ref<string[]>([]);

  let pcInterval: ReturnType<typeof setInterval> | null = null;
  let mobileInterval: ReturnType<typeof setInterval> | null = null;

  const fetchWallpapers = async () => {
    try {
      const res = await fetch(store.appConfig.wallpaperApiPcList || "/api/backgrounds");
      if (res.ok) pcWallpapers.value = await res.json();
      if (pcWallpapers.value.length === 0) {
        pcWallpapers.value = ["default-wallpaper.svg"];
      }

      const resMobile = await fetch(
        store.appConfig.wallpaperApiMobileList || "/api/mobile_backgrounds",
      );
      if (resMobile.ok) mobileWallpapers.value = await resMobile.json();
      if (mobileWallpapers.value.length === 0) {
        mobileWallpapers.value = ["default-wallpaper.svg"];
      }
    } catch (e) {
      console.error("Failed to fetch wallpapers for rotation", e);
      if (pcWallpapers.value.length === 0) pcWallpapers.value = ["default-wallpaper.svg"];
      if (mobileWallpapers.value.length === 0) mobileWallpapers.value = ["default-wallpaper.svg"];
    }
  };

  const rotate = (type: "pc" | "mobile") => {
    const list = type === "pc" ? pcWallpapers.value : mobileWallpapers.value;
    if (list.length === 0) return;

    const mode =
      type === "pc" ? store.appConfig.pcRotationMode : store.appConfig.mobileRotationMode;

    let nextWallpaper = "";

    if (mode === "random" || !mode) {
      const randomIndex = Math.floor(Math.random() * list.length);
      nextWallpaper = list[randomIndex] || "";
    } else {
      // Sequential - we need to find current index
      const currentUrl =
        type === "pc" ? store.appConfig.background : store.appConfig.mobileBackground;
      // Extract name from URL: /backgrounds/name.jpg or /mobile_backgrounds/name.jpg
      const prefix = type === "pc" ? "/backgrounds/" : "/mobile_backgrounds/";
      // Be careful with URL encoding if used, but usually it's plain
      
      let currentName = "";
      if (currentUrl === "/default-wallpaper.svg") {
        currentName = "default-wallpaper.svg";
      } else if (currentUrl?.startsWith(prefix)) {
        currentName = currentUrl.replace(prefix, "");
      }

      let currentIndex = -1;
      if (currentName) {
        currentIndex = list.indexOf(decodeURIComponent(currentName));
        if (currentIndex === -1) {
          currentIndex = list.indexOf(currentName);
        }
      }

      const nextIndex = (currentIndex + 1) % list.length;
      nextWallpaper = list[nextIndex] || "";
    }

    let url = "";
    if (nextWallpaper === "default-wallpaper.svg") {
      url = "/default-wallpaper.svg";
    } else {
      const base =
        type === "pc"
          ? store.appConfig.wallpaperPcImageBase || "/backgrounds"
          : store.appConfig.wallpaperMobileImageBase || "/mobile_backgrounds";
      const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
      url = `${trimmed}/${encodeURIComponent(nextWallpaper)}`;
    }

    if (type === "pc") {
      store.appConfig.background = url;
    } else {
      store.appConfig.mobileBackground = url;
    }
  };

  const updatePcInterval = () => {
    if (pcInterval) clearInterval(pcInterval);
    if (store.appConfig.pcRotation) {
      const minutes = Math.max(1, store.appConfig.pcRotationInterval || 30);
      pcInterval = setInterval(() => rotate("pc"), minutes * 60 * 1000);
    }
  };

  const updateMobileInterval = () => {
    if (mobileInterval) clearInterval(mobileInterval);
    if (store.appConfig.mobileRotation) {
      const minutes = Math.max(1, store.appConfig.mobileRotationInterval || 30);
      mobileInterval = setInterval(() => rotate("mobile"), minutes * 60 * 1000);
    }
  };

  // Watchers
  watch(
    () => [store.appConfig.pcRotation, store.appConfig.pcRotationInterval],
    () => {
      updatePcInterval();
    },
  );

  watch(
    () => [store.appConfig.mobileRotation, store.appConfig.mobileRotationInterval],
    () => {
      updateMobileInterval();
    },
  );

  // Also watch if fixedWallpaper is toggled - if so, disable both?
  watch(
    () => store.appConfig.fixedWallpaper,
    (val) => {
      if (val) {
        store.appConfig.pcRotation = false;
        store.appConfig.mobileRotation = false;
      }
    },
  );

  onMounted(() => {
    fetchWallpapers().then(() => {
      // Initial check
      updatePcInterval();
      updateMobileInterval();
    });
  });

  onUnmounted(() => {
    if (pcInterval) clearInterval(pcInterval);
    if (mobileInterval) clearInterval(mobileInterval);
  });

  return {
    rotate,
  };
}
