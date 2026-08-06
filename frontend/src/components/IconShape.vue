<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMainStore } from "../stores/main";

// 生成唯一ID，避免多个组件实例间clipPath冲突
const uid = Math.random().toString(36).slice(2, 9);
const maskId = `icon-mask-${uid}`;
const store = useMainStore();

const props = defineProps<{
  shape: string;
  size?: number;
  bgClass?: string;
  icon?: string;
  imgScale?: number;
}>();

const sizePx = computed(() => props.size ?? 48);
const scaleVal = computed(() => (props.imgScale ?? 100) / 100);

const imgGeometry = computed(() => {
  const s = scaleVal.value;
  const dim = 100 * s;
  const pos = (100 - dim) / 2;
  return { x: pos, y: pos, width: dim, height: dim };
});

const isImg = computed(() => {
  const s = props.icon || "";
  return (
    !!s &&
    (s.startsWith("http") ||
      s.startsWith("data:image") ||
      s.startsWith("blob:") ||
      s.includes("/") ||
      s.includes(".")) &&
    !s.trim().startsWith("<svg")
  );
});

const finalIcon = computed(() => {
  const icon = props.icon || "";
  if (isImg.value) {
    return store.getAssetUrl(icon);
  }
  return icon;
});

// --- 图片加载错误处理 ---
const imgLoadError = ref(false);

// 当 icon 变化时重置错误状态
watch(
  () => props.icon,
  () => {
    imgLoadError.value = false;
  },
);

const onImageError = (_event: Event) => {
  if (!imgLoadError.value) {
    imgLoadError.value = true;
    console.warn("[IconShape] 图标加载失败，回退到文字显示:", finalIcon.value);
  }
};

/** 从图标 URL 提取回退文字（取文件名首字符或 emoji） */
const fallbackText = computed(() => {
  const icon = props.icon || "";
  // 尝试从 URL 路径提取文件名
  try {
    const parts = icon.split("/");
    const last = parts[parts.length - 1] || icon;
    const name = last.split(".")[0] || last;
    if (name && name.length > 0) return name.slice(0, 2).toUpperCase();
  } catch {
    // ignore
  }
  return "?";
});

const isSvg = computed(() => {
  const s = props.icon || "";
  return !!s && s.trim().startsWith("<svg");
});

const textScale = computed(() => ((props.size ?? 48) >= 48 ? 0.52 : 0.56) * scaleVal.value);

const resolvedFillClass = computed(() => {
  const cls = props.bgClass || "fill-gray-100";
  if (cls.startsWith("#") || cls.startsWith("rgb") || cls.startsWith("hsl")) return "";
  if (cls.includes("bg-")) return cls.replace(/\bbg-/g, "fill-");
  return cls;
});

const fillStyle = computed(() => {
  const cls = props.bgClass;
  if (cls && (cls.startsWith("#") || cls.startsWith("rgb") || cls.startsWith("hsl"))) {
    return { fill: cls };
  }
  return {};
});

const pathD = computed(() => {
  switch (props.shape) {
    case "circle":
      return "M50 0 A50 50 0 1 0 50 100 A50 50 0 1 0 50 0 Z";
    case "rounded":
      // Apple Squircle (iOS icon shape) approximation
      return "M 50,0 C 72.9,0 82.2,0 89.2,4.5 C 95.5,8.5 98.5,14.5 99.5,21.8 C 100,27.8 100,37.1 100,50 C 100,62.9 100,72.2 99.5,78.2 C 98.5,85.5 95.5,91.5 89.2,95.5 C 82.2,100 72.9,100 50,100 C 27.1,100 17.8,100 10.8,95.5 C 4.5,91.5 1.5,85.5 0.5,78.2 C 0,72.2 0,62.9 0,50 C 0,37.1 0,27.8 0.5,21.8 C 1.5,14.5 4.5,8.5 10.8,4.5 C 17.8,0 27.1,0 50,0 Z";
    case "square":
      return "M0 0 H100 V100 H0 Z";
    case "diamond":
      return "M50 0 L100 50 L50 100 L0 50 Z";
    case "hexagon":
      return "M50 0 L93.3 25 L93.3 75 L50 100 L6.7 75 L6.7 25 Z";
    case "octagon":
      return "M29.3 0 H70.7 L100 29.3 V70.7 L70.7 100 H29.3 L0 70.7 V29.3 Z";
    case "pentagon":
      return "M50 0 L97.5 34.5 L79.4 90.5 H20.6 L2.5 34.5 Z";
    case "leaf":
      return "M50 0 C80 0 100 30 100 60 C100 83 80 100 60 100 C38 100 22 87 18 72 C12 54 18 32 32 20 C40 12 45 0 50 0 Z";
    default:
      return "M24 0 H76 A24 24 0 0 1 100 24 V76 A24 24 0 0 1 76 100 H24 A24 24 0 0 1 0 76 V24 A24 24 0 0 1 24 0 Z";
  }
});
</script>

<template>
  <div
    v-if="shape !== 'hidden'"
    class="relative flex items-center justify-center overflow-hidden flex-shrink-0"
    :style="{ width: sizePx + 'px', height: sizePx + 'px' }"
  >
    <svg
      :width="sizePx"
      :height="sizePx"
      viewBox="0 0 100 100"
      class="absolute inset-0"
      :style="{ backgroundColor: 'transparent' }"
    >
      <defs>
        <mask :id="maskId">
          <rect x="0" y="0" width="100" height="100" fill="black" />
          <path :d="pathD" fill="white" />
        </mask>
      </defs>

      <g :mask="shape === 'none' ? undefined : `url(#${maskId})`">
        <!-- 背景层：放入裁剪区域内，解决边缘溢出白边问题 -->
        <rect
          v-if="shape !== 'none'"
          x="0"
          y="0"
          width="100"
          height="100"
          class="transition-all duration-300"
          :class="resolvedFillClass"
          :style="fillStyle"
        />

        <!-- 图片图标：加载成功显示图片，失败则回退到文字 -->
        <template v-if="isImg && !imgLoadError">
          <image
            :href="finalIcon"
            :x="imgGeometry.x"
            :y="imgGeometry.y"
            :width="imgGeometry.width"
            :height="imgGeometry.height"
            preserveAspectRatio="xMidYMid slice"
            @error="onImageError"
          />
        </template>
        <!-- 图片加载失败回退文字 -->
        <text
          v-else-if="isImg && imgLoadError"
          x="50"
          y="55"
          text-anchor="middle"
          dominant-baseline="middle"
          :font-size="sizePx * 0.4"
          font-family="system-ui"
          fill="#999"
        >
          {{ fallbackText }}
        </text>
        <foreignObject v-else-if="isSvg" x="0" y="0" width="100" height="100">
          <div
            v-html="finalIcon"
            class="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
            :style="{ transform: `scale(${scaleVal})` }"
          ></div>
        </foreignObject>
        <text
          v-else
          x="50"
          y="55"
          text-anchor="middle"
          dominant-baseline="middle"
          :font-size="sizePx * textScale"
          font-family="system-ui"
          fill="#111"
        >
          {{ finalIcon }}
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.fill-gray-100 {
  fill: rgb(243 244 246);
}
.fill-white {
  fill: #ffffff;
}
</style>
