<script setup lang="ts">
import { computed } from "vue";

// 生成唯一ID，避免多个组件实例间clipPath冲突
const uid = Math.random().toString(36).slice(2, 9);
const maskId = `icon-mask-${uid}`;

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

const finalIcon = computed(() => props.icon || "");

const isImg = computed(() => {
  const s = finalIcon.value;
  // 支持 http, data:image, blob: 以及包含 / 或 . 的本地路径，排除 SVG 代码
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

const isSvg = computed(() => {
  const s = finalIcon.value;
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
      return "M35 0 H65 A35 35 0 0 1 100 35 V65 A35 35 0 0 1 65 100 H35 A35 35 0 0 1 0 65 V35 A35 35 0 0 1 35 0 Z";
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

        <image
          v-if="isImg"
          :href="finalIcon"
          :x="imgGeometry.x"
          :y="imgGeometry.y"
          :width="imgGeometry.width"
          :height="imgGeometry.height"
          preserveAspectRatio="xMidYMid slice"
        />
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
