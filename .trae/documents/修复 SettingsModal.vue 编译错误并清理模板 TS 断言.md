## 问题分析
- 错误类型：`Invalid end tag`（Vue 编译器在解析模板时触发）
- 发生位置：`src/components/SettingsModal.vue`
  - `SettingsModal.vue:73` 在 `</script>` 和 `<template>` 之间存在游离 JS 代码：`function md5(...)`。该段代码包含 `<<`、`>>>` 等符号，被 HTML 解析器误认为是标签，导致模板解析失败。
  - 模板中出现 TypeScript 断言（`as any`），Vue 模板表达式不支持 TS 类型断言，可能引发编译异常。
- 相关文件：`src/components/GridPanel.vue` 也在模板中使用了 `as any`（`GridPanel.vue:203`、`GridPanel.vue:282`）。
- 相关类型：`src/types.ts:30-35` 中的 `AppConfig.iconShape` 联合类型与 `IconShape.vue` 的 `shape` Prop 一致，无需任何断言。

## 影响范围
- 设置弹窗整体渲染失败：`SettingsModal.vue` 中所有 Tab（外观、组件、搜索、账户）无法显示。
- 顶部搜索区域与图标形状预览在 `GridPanel.vue` 中也可能受 `as any` 影响，造成编译或运行异常。
- 开发环境 HMR 与构建流程受阻，`vite-plugin-vue-inspector` 的解析报错阻断页面启动。

## 修复方案
1. 移除游离 JS 代码
   - 删除 `SettingsModal.vue:73` 开始至函数结束的整段 `function md5(...)`。当前仓库未使用该函数（仅此处存在，已检索确认），删除最稳妥。
   - 如未来需要哈希：将其迁移到 `src/utils/hash.ts` 并在 `<script setup>` 中按需引入与使用。
2. 清理模板中的 TS 断言
   - `SettingsModal.vue`
     - `:shape="store.appConfig.iconShape as any"` → `:shape="store.appConfig.iconShape"`（`SettingsModal.vue:154`、`SettingsModal.vue:176`）
     - `v-model="(store.appConfig.iconShape as any)"` → `v-model="store.appConfig.iconShape"`（`SettingsModal.vue:164`）
   - `GridPanel.vue`
     - `v-model="(effectiveEngine as any)"` → `v-model="effectiveEngine"`（`GridPanel.vue:203`）
     - `:shape="store.appConfig.iconShape as any"` → `:shape="store.appConfig.iconShape"`（`GridPanel.vue:282`）
   - 说明：`IconShape.vue` 的 `shape` 与 `types.ts:30` 的 `AppConfig.iconShape` 类型完全一致；`effectiveEngine` 是 `computed<string>`，直接绑定无类型问题。
3. 保持功能逻辑不变
   - 不改动现有交互与数据流（Pinia 的 `useMainStore`、`searchEngines` 拖拽、`defaultSearchEngine/rememberLastEngine` 等）。

## 错误处理与日志
- `SettingsModal.vue`
  - `handleFileChange` 中已存在 `try/catch` 与用户提示；补充：对 `fetch('/api/data')` 的响应状态进行校验并在非 `ok` 时 `console.error('[Import] post failed', r.status)`。
  - `handleReset` 中对 `fetch('/api/reset')` 校验 `ok`，失败时输出 `[Reset] failed` 的详细错误。
  - `handleExport` 失败时保留 `console.error(e)`，补充前缀 `[Export]` 便于定位。
- 统一日志前缀：`[SettingsModal]`、`[GridPanel]`，便于筛选与排查。

## 单元测试（Vitest）
- 新增测试文件：
  - `tests/components/SettingsModal.spec.ts`
    - 断言：能成功导入组件并通过 `createApp(SettingsModal, { show: false })` 挂载/卸载，不抛异常（验证模板可编译）。
  - `tests/components/GridPanel.spec.ts`
    - 准备：`createPinia()` 注入、`createApp` 挂载，验证组件可加载（不要求完整 UI 断言，关注编译与生命周期不报错）。
- 覆盖点：确保移除 `as any` 后模板编译成功；`SettingsModal.vue` 无游离 JS 导致的解析错误。

## 开发环境验证
- 启动：`npm run dev`，确认本地地址 `http://localhost:5173/` 正常打开。
- 快速巡检：
  - 打开设置弹窗，浏览四个 Tab，确认无编译告警与交互异常。
  - 顶部搜索框引擎选择下拉框可正常工作（记忆与默认切换逻辑保持原样）。
  - 组件区的图标形状预览渲染正常，符合 `AppConfig.iconShape`。

## 记录与说明
- 根因：单文件组件结构被破坏（`</script>` 后出现 JS 代码），导致 HTML 解析误将位运算符当成标签；另有模板层 TS 断言不被支持。
- 解决：删除游离代码、移除不必要的 TS 断言，保持类型系统与运行时一致。
- 影响面恢复：设置弹窗、顶部搜索与整体开发运行环境恢复正常，无新副作用。

——请确认以上修复方案。确认后我将按上述步骤实现修改、补充日志与单元测试，并在本地完整验证。