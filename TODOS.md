# KET English — TODOS (deferred from autoplan 2026-04-16)

Items deferred from the V1.0 autoplan review. Priority ordered.

## V1.1 (next sprint after V1.0 ships + validated)

- [ ] **音效反馈** — Web Audio API 生成 beep（答对/答错），已升级为 V1.0 Taste Decision，实现成本 < 30min
- [ ] **暗色模式** — CSS variables 已预留，只需添加 `prefers-color-scheme: dark` 覆盖
- [ ] **Whisper API 接入** — 系统B自动切分精度从"均匀估算"提升到真实时间戳，需要 API key
- [ ] **打印/PDF 周报** — 家长需求，非核心闭环

## V1.1-V1.2 (after validation)

- [ ] **系统B "无校正快速启动"模式** — 跳过时间轴校正，家长直接上传音频+原文，按句播放（降低首次使用门槛）
- [ ] **错因分类** — 系统A：区分"看错了"/"拼错了"/"完全不会"，统计页按错因展示
- [ ] **打印/PDF 周报** — 家长导出周度掌握报告

## V2.0 (explore after V1.x stable)

- [ ] **云同步/备份** — 需要后端，目前用 JSON 导出代替
- [ ] **系统A+B 互联** — 错词对应系统B中的难听句，打通学习闭环
- [ ] **AI 预测** — 预测下周哪些词会遗忘，提前安排复习
- [ ] **套题 JSON 分享** — 家庭间共享备考套题（需设计权限模型）
- [ ] **Anki 兼容导出** — 将词汇数据导出为 Anki 卡组格式，方便迁移

## 技术债 (解决时机: 当 Vanilla JS 维护成本明显上升时)

- [ ] **引入 TypeScript / 构建工具** — 当单个子系统 JS 超过 3000 行时，类型安全开始有明显回报
- [ ] **Alpine.js 迁移** — 如果 DOM 操作重复性太高，Alpine.js (15KB) 可在不引入构建工具的情况下降低代码量

## 已明确不做 (NOT doing, ever)

- AI 讲解、口语评分
- 多用户账号体系
- 公开题库分发
- 复杂游戏化/排名系统
- 排行榜/社交功能
