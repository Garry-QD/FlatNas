<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { useMainStore } from "../stores/main";

const props = defineProps<{
  show: boolean;
  title?: string;
  onSuccess: () => void;
}>();

const emit = defineEmits(["update:show"]);
const store = useMainStore();

const password = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const errorMsg = ref("");

watch(
  () => props.show,
  (newVal) => {
    if (newVal) {
      password.value = "";
      errorMsg.value = "";
      nextTick(() => {
        inputRef.value?.focus();
      });
    }
  },
);

const close = () => emit("update:show", false);

const confirm = async () => {
  try {
    const success = await store.login(store.username || "admin", password.value);
    if (success) {
      props.onSuccess();
      close();
    }
  } catch (e: unknown) {
    errorMsg.value = (e instanceof Error ? e.message : null) || "密码错误，请重试";
    password.value = "";
    inputRef.value?.focus();
  }
};
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
  >
    <div
      class="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all scale-100 border border-gray-100"
    >
      <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
        <h3 class="font-bold text-gray-800">{{ title || "请输入密码确认操作" }}</h3>
        <button @click="close" class="text-gray-400 hover:text-gray-600 leading-none text-xl">
          &times;
        </button>
      </div>

      <div class="p-6">
        <div class="mb-4">
          <input
            ref="inputRef"
            v-model="password"
            type="password"
            placeholder="请输入管理员密码"
            class="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-center text-lg tracking-widest"
            @keyup.enter="confirm"
          />
          <p v-if="errorMsg" class="text-red-500 text-xs mt-2 text-center">{{ errorMsg }}</p>
        </div>

        <div class="flex gap-3">
          <button
            @click="close"
            class="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-lg font-bold hover:bg-gray-200 transition-all"
          >
            取消
          </button>
          <button
            @click="confirm"
            class="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-bold hover:bg-blue-700 transition-all shadow-md"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
