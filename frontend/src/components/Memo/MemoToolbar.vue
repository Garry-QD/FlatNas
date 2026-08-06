<script setup lang="ts">



const emit = defineEmits<{
  (e: 'command', cmd: string, val?: string): void
}>();

const commands = [
  { 
    cmd: 'bold', 
    label: '粗体', 
    icon: '<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4h-1v4h1a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6V4zm5 6h3a2 2 0 0 0 0-4h-3v4zm0 8h3a2 2 0 0 0 0-4h-3v4z"/>' 
  },
  { 
    cmd: 'italic', 
    label: '斜体', 
    icon: '<path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/>' 
  },
  { separator: true },
  { 
    cmd: 'formatBlock', 
    val: 'H1', 
    label: 'H1', 
    text: 'H1'
  },
  { 
    cmd: 'formatBlock', 
    val: 'H2', 
    label: 'H2', 
    text: 'H2'
  },
  { separator: true },
  { 
    cmd: 'insertUnorderedList', 
    label: '列表', 
    icon: '<path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/>'
  },
  { 
    cmd: 'formatBlock', 
    val: 'PRE', 
    label: '代码', 
    icon: '<path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>'
  },
  { 
    cmd: 'formatBlock', 
    val: 'BLOCKQUOTE', 
    label: '引用', 
    icon: '<path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>'
  }
];

interface CommandItem {
  cmd?: string;
  val?: string;
  label?: string;
  icon?: string;
  text?: string;
  separator?: boolean;
}

const handleCommand = (item: CommandItem) => {
  if (item.cmd) {
    emit('command', item.cmd, item.val);
  }
};
</script>

<template>
  <div class="flex items-center gap-1 mt-0 pt-0 border-t border-gray-200/20 flex-wrap -mx-4 -mb-4 px-0 pb-0">
    <template v-for="(item, index) in commands" :key="index">
      <div v-if="item.separator" class="w-px h-4 bg-gray-400/30 mx-1"></div>
      <button
        v-else
        type="button"
        class="
          p-1.5 rounded transition-all duration-200
          text-gray-600 hover:text-[#0052D9] hover:bg-white/40
          focus:outline-none focus:ring-2 focus:ring-[#0052D9]/50
          disabled:opacity-40 disabled:cursor-not-allowed
          active:scale-95
        "
        :aria-label="item.label"
        :title="item.label"
        @click="handleCommand(item)"
      >
        <svg 
          v-if="item.icon" 
          viewBox="0 0 24 24" 
          class="w-4 h-4 fill-current" 
          v-html="item.icon"
        ></svg>
        <span v-else class="text-[10px] font-bold w-4 h-4 flex items-center justify-center">{{ item.text }}</span>
      </button>
    </template>
  </div>
</template>
