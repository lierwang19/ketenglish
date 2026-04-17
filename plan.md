<!-- /autoplan restore point: will be set by autoplan -->
# KET English — V1.0 开发计划

**版本**: V1.0  
**目标用户**: KET 备考家庭（小学生 + 家长）  
**交付形态**: 网页/PWA，本地优先  
**日期**: 2026-04-16

---

## 一、项目概述

本项目包含两个子系统，均以独立网页/PWA形式交付：

| 子系统 | 路径 | 核心定位 |
|--------|------|----------|
| 系统A：单词滚动复习 | `vocab-review/` | 旧词滚动复习机 + 会写词强化工具 |
| 系统B：听力句段精听播放器 | `listening-player/` | 句段精听播放器 + 错句回炉工具 |

两个子系统**共用一套技术栈**，但**数据完全独立**，可分开开发和部署。

---

## 二、技术栈决策

| 层级 | 选型 | 理由 |
|------|------|------|
| 前端 | HTML + CSS + Vanilla JS | 零依赖，直接打开，无需构建工具，小学生家庭最容易维护 |
| 样式 | 自定义 CSS（渐变、圆角、微动画） | 满足儿童友好 + 现代视觉要求，无需引入 CSS 框架 |
| 本地存储 | IndexedDB（via idb 轻量封装） | 支持结构化数据，不丢失，离线可用，无需后端 |
| 音频 | Web Audio API + HTML `<audio>` 元素 | 原生支持，满足变速/循环/定位需求 |
| 打包/部署 | PWA（manifest + service worker） | 手机可添加到主屏幕，离线访问，无需 App Store |
| 自动转写 | Whisper API（可选，P1） | V1.0 不强制，预留接入点 |

**不引入**: React/Vue/Angular、TypeScript（V1.0 阶段），Node.js 后端，数据库服务器。  
**理由**: 降低开发门槛，减少运维成本，家庭自用场景不需要服务端。

---

## 三、目录结构

```
KET Engish/
├── plan.md                        # 本文件
├── CLAUDE.md                      # Claude Code 引导
├── agent.md                       # 通用 AI Agent 引导
├── docs/
│   ├── KET单词滚动复习软件需求书_V1.0.md
│   └── KET听力句段精听播放器需求书_V1.0.md
├── shared/
│   └── db.js                      # IndexedDB 通用封装
├── vocab-review/                  # 子系统A
│   ├── index.html
│   ├── css/
│   │   └── main.css
│   ├── js/
│   │   ├── db.js                  # 数据层（words, progress, logs）
│   │   ├── scheduler.js           # 复习调度算法
│   │   ├── practice.js            # 练习题型逻辑
│   │   ├── stats.js               # 统计模块
│   │   └── app.js                 # 页面路由 + 主入口
│   └── assets/
│       └── icons/
└── listening-player/              # 子系统B
    ├── index.html
    ├── css/
    │   └── main.css
    ├── js/
    │   ├── db.js                  # 数据层（sets, segments, logs）
    │   ├── segmenter.js           # 自动切分算法
    │   ├── player.js              # 音频播放控制
    │   ├── editor.js              # 切分校正编辑器
    │   ├── difficult.js           # 错句本 + 回炉逻辑
    │   └── app.js                 # 页面路由 + 主入口
    └── assets/
        └── icons/
```

---

## 四、系统A：单词滚动复习

### 4.1 数据模型

**`words`** — 单词主表  
```
id, word, meaning_cn, part_of_speech, example_sentence,
word_type(recognition|writing), week_no, unit_name,
status(inactive|active|mastered|paused),
created_at, entered_pool_at, updated_at
```

**`word_progress`** — 学习进度  
```
id, word_id, mastery_level(red|yellow|green),
correct_count, wrong_count, consecutive_correct,
last_review_at, next_review_at, last_result, last_error_type
```

**`review_logs`** — 复习日志  
```
id, word_id, review_time, question_type, user_answer,
correct_answer, is_correct, response_time, error_type
```

**`weekly_batches`** — 周次管理  
```
id, week_no, batch_name, created_at
```

**`daily_tasks`** — 每日任务  
```
id, task_date, word_id, task_type, priority, status(pending|done|skipped)
```

### 4.2 核心算法：复习调度

**间隔序列（首次进入复习池后）**:  
第0天 → 第1天 → 第3天 → 第7天 → 第14天 → 第30天

**掌握等级晋降规则**:

| 词类型 | 等级 | 晋升条件 | 复习间隔 |
|--------|------|----------|----------|
| 认读词 | 红→黄 | 连续答对2次 | 1天后 |
| 认读词 | 黄→绿 | 连续答对3次 | 3天后 |
| 认读词 | 绿（抽查）| 答错降黄 | 7-14天 |
| 会写词 | 红→黄 | 连续拼对2次 | 1天后 |
| 会写词 | 黄→绿 | 连续拼对3次 | 2天后 |
| 会写词 | 绿（抽查）| 答错降黄 | 5-7天 |

**每日任务优先级（高→低）**:  
1. 到期红词（认读/会写）  
2. 到期黄词（认读/会写）  
3. 到期会写词绿色抽查  
4. 历史错词回炉  
5. 绿色词抽查（可在设置中关闭）

**当日错题机制**: 答错的词在本次任务后半段**再出现一次**。

### 4.3 练习题型

| 词类型 | 题型 | 实现方式 |
|--------|------|----------|
| 认读词 | 看英文选中文 | 4选1单选（含1个正确+3个干扰项） |
| 认读词 | 看中文选英文 | 4选1单选 |
| 会写词 | 看中文拼英文 | 输入框，不区分大小写，trim后比较 |
| 会写词 | 补全单词 | 缺若干字母，填空（随机隐藏2-4个字母） |

**反馈**: 提交后立即显示对错；错误时显示正确答案，停留1.5秒后自动进入下题。

### 4.4 页面列表

| 页面 | 主要功能 | 角色 |
|------|----------|------|
| 首页 | 今日任务概况、打卡天数、快速入口 | 孩子/家长 |
| 单词录入页 | 手动新增、批量导入CSV、标记类型和周次 | 家长 |
| 单词列表页 | 按周次/类型/掌握等级筛选查看 | 家长 |
| 今日任务页 | 按优先级自动出题，完成练习 | 孩子 |
| 错词本页 | 查看所有错词、筛选高危词 | 家长/孩子 |
| 统计页 | 每日/每周/累计掌握情况 | 家长 |
| 设置页 | 每日任务量上限、复习节奏、绿词抽查开关 | 家长 |

---

## 五、系统B：听力句段精听播放器

### 5.1 数据模型

**`listening_sets`** — 套题主表  
```
id, title, source, exam_type, remark, created_at, updated_at
```

**`audio_assets`** — 音频资源  
```
id, set_id, file_name, file_path(IndexedDB blob key), duration, part_no, created_at
```

**`transcripts`** — 原文  
```
id, set_id, part_no, question_no, full_text, language_type
```

**`segments`** — 句段（核心数据）  
```
id, set_id, part_no, question_no, segment_no,
start_time, end_time, segment_text,
status(auto|manual), created_at, updated_at
```

**`segment_logs`** — 训练日志  
```
id, segment_id, train_time, play_count, speed, loop_count, mode, is_difficult
```

**`difficult_segments`** — 错句本  
```
id, segment_id, mark_source(manual|auto), marked_at, resolved_at, priority(high|medium|low)
```

### 5.2 自动切分算法

**输入**: 原文文本（已知）+ 音频时长（已知）  
**方法**: 基于标点分句（句号/问号/感叹号作为切分点），均匀分配时间戳作为初始估计  
**输出**: segments 列表，带起止时间估计值  

**V1.0 简化方案**（不强依赖 ASR）:  
- 按句子分割原文文本
- 时间轴按文字数量比例估算（均匀分配）
- 家长手动拖动修正边界（这是主要使用路径）

**P1 增强**（可选）:  
- 接入 Whisper API 获取精确时间戳

### 5.3 音频播放控制

**核心能力**（Web Audio API + HTMLAudioElement）:
- 单句循环: `audio.currentTime = segment.start_time` + `ended` 事件重置
- 变速播放: `audio.playbackRate = 0.75 | 0.85 | 1.0`
- 定位播放: 直接设置 `currentTime`
- 前后句联听: 从 `prev.start_time` 播放到 `next.end_time`

**边界处理**: 
- 循环模式下，通过 `timeupdate` 事件检测是否到达 `end_time`，手动重置
- 避免依赖 `ended` 事件（end_time 不等于文件末尾）

### 5.4 训练模式

| 模式 | 描述 | 限制 |
|------|------|------|
| 精听模式 | 以句段为单位，单句循环、变速 | 无限制 |
| 考试模式 | 整题连续播放，不显示句段列表 | 禁止单句循环 |
| 复盘模式 | 只播放错句本 + 收藏句 | 聚焦难点 |

### 5.5 页面列表

| 页面 | 主要功能 | 角色 |
|------|----------|------|
| 首页 | 最近套题、今日错句回炉入口、进度概览 | 家长/孩子 |
| 套题管理页 | 新增套题、上传音频、录入原文 | 家长 |
| 切分校正页 | 展示/编辑句段列表、拆分/合并/拖动边界 | 家长 |
| 训练页 | 整题/单句播放、变速/循环控制、加入错句本 | 孩子 |
| 错句本页 | 高频难句、待回炉句段 | 孩子/家长 |
| 统计页 | 训练次数、最难句段、套题完成情况 | 家长 |
| 设置页 | 默认速度、循环次数、是否显示原文 | 家长 |

---

## 六、V1.0 开发阶段划分

### Phase 1：基础框架（约1-2天）
- [ ] 项目目录结构搭建
- [ ] IndexedDB 封装（CRUD + 数据迁移）
- [ ] PWA manifest + service worker 基础配置
- [ ] 公共 CSS 设计系统（颜色变量、字体、按钮、卡片）
- [ ] 单页应用路由（hash-based，无需 SPA 框架）

### Phase 2：系统A 核心（约3-4天）
- [ ] 单词录入页（手动新增 + CSV 导入）
- [ ] 单词列表页（筛选展示）
- [ ] 复习调度算法（间隔重复 + 优先级队列）
- [ ] 今日任务生成逻辑
- [ ] 练习题型实现（4选1 + 拼写输入 + 补全）
- [ ] 答题反馈 + 掌握等级更新
- [ ] 首页（今日任务概况）
- [ ] 错词本页

### Phase 3：系统A 完善（约1-2天）
- [ ] 统计页（每日/每周/累计）
- [ ] 设置页（任务量、节奏、绿词开关）
- [ ] 周复盘功能
- [ ] 错因分类（P1）

### Phase 4：系统B 核心（约3-4天）
- [ ] 套题管理页（新增套题、上传音频、录入原文）
- [ ] 音频文件存储（IndexedDB 大文件存储）
- [ ] 自动切分算法（文本分句 + 时间估算）
- [ ] 切分校正页（可视化编辑器）
- [ ] 训练页（整题播放 + 单句循环 + 变速）
- [ ] 错句本页
- [ ] 首页

### Phase 5：系统B 完善（约1-2天）
- [ ] 统计页
- [ ] 训练模式切换（精听/考试/复盘）
- [ ] 设置页
- [ ] 前后句联听功能

### Phase 6：整体收尾（约1天）
- [ ] 移动端适配优化
- [ ] 性能测试（IndexedDB 大数据量）
- [ ] PWA 离线缓存完善
- [ ] 跨浏览器兼容性测试（Safari/Chrome/Firefox）

---

## 七、关键技术风险

| 风险 | 严重度 | 缓解方案 |
|------|--------|----------|
| IndexedDB 存储大型音频文件（数十MB）| 高 | 先测试浏览器限额；考虑 File System Access API 作为备选 |
| 音频时间精度控制（循环边界漂移）| 中 | 用 `timeupdate` 事件 + 5ms 容差检测，而非 `ended` |
| Safari 对 Web Audio API 的限制（需用户手势触发）| 中 | 所有音频操作绑定到用户点击事件 |
| CSV 导入编码问题（中文乱码）| 低 | 使用 `FileReader` + `UTF-8` + `GBK` 自动检测 |
| 自动切分时间轴不准确 | 低 | 明确告知家长这是估算初稿，必须手动校正 |
| 页面数据量大时渲染性能 | 低 | 虚拟滚动（词汇 > 500 条时考虑） |

---

## 八、非功能要求

- **儿童友好**: 字体 ≥ 16px，按钮点击区域 ≥ 44px，操作步骤 ≤ 3步
- **本地优先**: 刷新页面不丢失任何数据，离线可用
- **移动优先**: 优先适配 375px-414px 手机宽度，平板自适应
- **中文界面**: 所有 UI 文案使用中文
- **视觉现代**: 圆角、渐变、微动画，不做简陋 MVP

---

## 九、V1.0 不做（明确排除）

- AI 讲解、口语评分
- 多用户账号体系
- 云同步、后端服务器
- 公开题库分发
- 复杂游戏化/排名系统
- 自动转写（Whisper，列为 P1 可选）
- React/Vue 等框架（Vanilla JS 完全够用）

---

## 十、验收标准

### 系统A
1. 家长能录入100个单词，标记30个会写词/70个认读词
2. 系统能自动生成每日复习任务，第二周继续带入未掌握词
3. 孩子能完成认读练习与拼写练习，错词自动回炉
4. 每日任务量可控（设置上限后不超量）
5. 家长能查看错词、掌握情况和每周复盘结果

### 系统B
1. 家长能创建套题并导入音频 + 原文
2. 系统生成可编辑的句段初切结果
3. 孩子能完成整题播放、单句循环、变速播放
4. 孩子能将难句加入错句本，系统正确展示
5. 刷新页面不丢失训练进度

---

## 十一、决策审计记录

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO-0 | 技术栈 Vanilla JS + IndexedDB | Mechanical | P5+P3 | 家庭自用工具，零依赖最优，用户已在 CLAUDE.md 确认 | React, Vue |
| 2 | CEO-0 | 模式: SELECTIVE EXPANSION | Mechanical | autoplan规则 | 需求明确的 greenfield 项目，以现有计划为基线，cherry-pick 扩展 | SCOPE EXPANSION |
| 3 | CEO-0E | 增加 PWA install prompt | Mechanical | P2 | 在 blast radius 内（manifest.json + index.html），CC < 30min，完整度提升明显 | defer |
| 4 | CEO-0E | 增加练习键盘快捷键 | Mechanical | P2 | 在 blast radius 内（practice.js），CC < 15min，儿童友好性提升 | defer |
| 5 | CEO-0E | 增加 CSV/JSON 数据导出 | Mechanical | P2 | 家长备份需求，在 blast radius 内（db.js），防止数据丢失场景 | defer |
| 6 | CEO-0E | 音效反馈 (correct/wrong beep) | Mechanical | P3 | 需要音频素材，不在 blast radius，defer 到 V1.1 | include |
| 7 | CEO-0E | 暗色模式 | Mechanical | P3 | CSS variables 支持但非 V1.0 核心价值，defer | include |
| 8 | CEO-0E | 浏览器端静默检测分段 | Mechanical | P3 | 复杂音频处理，非核心闭环，defer | include |

---

## Phase 1: CEO Review 分析

### Step 0A: 前提挑战

5 个前提经用户确认全部正确（2026-04-16）。

评估：前提设置合理，定位聚焦清晰。唯一潜在盲点：**假设家长有足够的技术能力导入音频文件**（系统 B）。如果家长不熟悉文件系统操作，导入流程的 UX 需要特别照顾。列为 Section 4 (Code Quality) 的 P1 关注点。

### Step 0B: 现有代码利用

无现有代码（greenfield）。两个子系统共享以下模式，应复用而非重建：
- IndexedDB 封装（`shared/db.js`）
- 哈希路由（两个子系统共用同一模式）
- 通用 CSS 设计令牌（颜色变量、间距、字体）
- 卡片/按钮/输入框基础组件样式

### Step 0C: Dream State Mapping

```
CURRENT STATE                     THIS PLAN (V1.0)             12-MONTH IDEAL
─────────────────────────         ──────────────────────────   ──────────────────────────
手工安排单词复习，旧词遗忘           自动间隔重复调度               系统A+B互联（错词对应难听句）
普通播放器反复拖进度条               句段精听播放器+错句回炉         AI预测下周哪些词会忘
家长靠直觉判断孩子掌握程度           家长统计面板+错词本             生成周报给老师
每次都要手动找到上次停的地方          进度持久化，刷新不丢失          云同步，多设备继续
```

### Step 0C-bis: 实现方案对比

```
APPROACH A: Vanilla JS + IndexedDB (已选定)
  Summary: 纯 HTML/CSS/JS，IndexedDB 持久化，无构建工具
  Effort:  M（约10-14天）
  Risk:    Low
  Pros:    零依赖；直接开 index.html；家长可直接放本地文件夹运行
  Cons:    无类型安全；大量 DOM 操作；超过 ~3000 行开始难维护
  Reuses:  IndexedDB idb 轻量封装（Layer 1）

APPROACH B: React + Vite + IndexedDB
  Summary: React 组件模型，Vite 构建，IndexedDB 持久化
  Effort:  M+（多 2-3 天配置，但长期更可维护）
  Risk:    Low-Med（需要 Node.js 环境，家长理解成本更高）
  Pros:    组件复用好；状态管理更清晰；类型安全（+TS）
  Cons:    需要 npm install / build；失去"直接打开 HTML"的简洁性

APPROACH C: Alpine.js + IndexedDB
  Summary: Alpine.js 响应式绑定，保持 HTML-first
  Effort:  S-M
  Risk:    Low
  Pros:    介于两者之间；15KB；无构建工具
  Cons:    社区较小；不如 React 成熟
```

**自动决策**: Approach A (Vanilla JS)。理由：家长使用场景对"直接打开 HTML"的要求 > 组件复用需求；P5 (explicit over clever)。

### Step 0D: SELECTIVE EXPANSION 分析

复杂度检查：
- vocab-review/: 7 个 JS 文件 + 1 CSS + 1 HTML = 9 个文件
- listening-player/: 7 个 JS 文件 + 1 CSS + 1 HTML = 9 个文件
- shared/: 1 文件
- 总计约 19 个文件，**超过 8 文件阈值**

但这是两个独立子系统，每个子系统内部 9 文件，在合理范围内。这不是过度工程，而是两个完整应用的必要模块分离。**不建议缩减**（P3 pragmatic）。

已接受的扩展范围（在原计划基础上新增）：
1. PWA install prompt（manifest.json 中添加 start_url、display: standalone，提示"添加到主屏幕"）
2. 练习键盘快捷键（空格=下一题，回车=提交，数字键=选择选项）
3. 数据导出功能（家长可导出 JSON 备份，防止 IndexedDB 清空数据丢失）

### Step 0E: 时间轴预测

```
HOUR 1 (基础框架):
  - 实现者需要知道：IndexedDB 的 schema 版本迁移策略（从 v1 开始，预留升级路径）
  - idb 库选择：使用 jakearchibald/idb (Layer 1, ~1KB) 而非手写 Promise 包装

HOUR 2-3 (核心逻辑):
  - 会碰到：复习调度算法的"今日任务生成"逻辑——什么时候截止算"到期"？
    建议：任务日期 <= today，不是 < today。凌晨 0:00 重置。
  - 会碰到：音频文件存储到 IndexedDB 的大文件限制（Safari < 500MB，Chrome < 1GB）
    建议：先显示存储使用量，超出时友好提示

HOUR 4-5 (集成):
  - 会惊讶：Safari 的 IndexedDB 在隐私浏览下会被清空，普通浏览下稳定
  - 会惊讶：Safari 的 Web Audio API 需要在用户手势后才能 resume AudioContext

HOUR 6+ (polish/tests):
  - 会希望早知道：应该在开始时就设计好"今日已完成"vs"任务已生成"的状态机
  - 会希望早知道：听力播放器的 timeupdate 事件在低端安卓上触发频率不稳定（建议 50ms 间隔检查）
```

### Step 0F: 模式确认

**模式: SELECTIVE EXPANSION** — 已选定。
以原计划范围为基线，新增3个扩展项（PWA install prompt、键盘快捷键、数据导出）。其余扩展机会 defer 到 TODOS.md。

### 已接受扩展（新增到计划范围）

1. **PWA install prompt**: 在 index.html 中监听 `beforeinstallprompt` 事件，显示"添加到主屏幕"提示
2. **练习键盘快捷键**: 空格键=下一题/播放，回车=提交答案，1-4数字键=选择选项 A-D
3. **数据导出（JSON 备份）**: 设置页新增"导出数据"按钮，导出 IndexedDB 全量数据为 JSON 文件

### 已拒绝/延期扩展（NOT in scope）

- 音效反馈（beep）: 需要音频素材，V1.1
- 暗色模式: CSS variables 已预留，V1.1
- 浏览器端静默检测自动分段: 复杂，需要 Web Audio API silence detection，V1.1+
- 打印/PDF 周报: 家长需求但非核心闭环，V1.1
- 套题 JSON 分享（家庭间导入导出）: 越界，设计原则是家庭自用
- 排行榜/社交功能: 明确排除在需求书中

---

## What Already Exists (现有代码利用地图)

| 子问题 | 现有代码 | 复用状态 |
|--------|----------|----------|
| IndexedDB CRUD | 无（greenfield） | 新建 shared/db.js |
| 哈希路由 | 无 | 两个子系统各自实现，共用相同模式 |
| 间隔重复算法 | 无（Anki 算法开源但超出需求） | 按需求书自定义简化版 |
| Web Audio 播放控制 | 无 | 新建 listening-player/js/player.js |
| 通用 CSS 组件 | 无 | 新建 shared CSS 设计令牌 |

---

## NOT in Scope (V1.0 明确不做)

| 项目 | 延期原因 |
|------|----------|
| 音效反馈 | 需要素材，V1.1 |
| 暗色模式 | CSS 预留，V1.1 |
| 浏览器端静默检测 | 复杂音频处理，V1.1+ |
| 打印/PDF 周报 | 非核心闭环，V1.1 |
| 套题 JSON 分享 | 超出家庭自用设计原则 |
| 音频 ASR 自动转写 | 已标注 P1 可选，需要 API key |
| 多用户账号 | 明确排除 |
| 云同步 | 明确排除 |

---

## Phase 1: CEO Review — 双视角共识表

### 两个 CEO 声音完整摘要

**Claude CEO Subagent（独立战略顾问）核心发现：**
- 两个子系统并行开发，第一个可用产品需等 10-14 天（HIGH）
- 系统 B 自动切分用"均匀估算"，实际不可用，需 Whisper 或降级方案（HIGH）
- IndexedDB 存音频在 iOS Safari 有配额风险，需提前专项测试（HIGH）
- 无内置词汇包，首次使用需家长先录入才能体验（HIGH）
- 目标受众不明确：自用还是推广给更多家庭（HIGH）
- Anki 替代方案未被分析（MEDIUM）
- 系统 B 切分操作对家长不友好，无降级模式（MEDIUM）

**Codex CEO Voice（GPT-5.4）核心发现：**
- "本地优先/无后端"是技术价值观，不是用户价值——应重构产品承诺为"1分钟每日使用，零管理，不丢进度"（CRITICAL）
- 两系统捆绑削弱切入点，应先发系统 A 验证 2 周留存率（HIGH）
- 系统 B 家长操作负担过重（上传音频+录入原文+手动校正），使用率会低（HIGH）
- 间隔复习间隔是手工拍板，如果效果不好无数据支撑（MEDIUM）
- 无同步/备份在设备切换或浏览器清存储时会触发信任失败（HIGH）
- 被排除的替代方案比计划承认的更值得讨论（MEDIUM）

### CEO 共识表

| 发现 | Claude 评级 | Codex 评级 | 共识行动 |
|------|-------------|------------|----------|
| 两系统同时开发削弱交付速度和验证效率 | HIGH | HIGH | **先完成系统 A，验证使用后再动系统 B** |
| 系统 B 家长操作负担是主要流失点 | HIGH | HIGH | **系统 B 需要"零校正快速启动"模式** |
| IndexedDB 大文件存储在 iOS Safari 未验证 | HIGH | HIGH | **系统 B 代码动工前先做 iPhone Safari 专项测试** |
| 数据备份/导出是必须功能，非可选 | MEDIUM | CRITICAL | **导出 JSON 从 P1 可选升级为 V1.0 强制** |
| 无内置词汇包导致首次使用门槛高 | HIGH | MEDIUM | **系统 A V1.0 内置至少一套 KET 常见词汇示例包** |
| 间隔复习算法缺乏数据可调性 | MEDIUM | MEDIUM | **复习间隔在设置页暴露为可调参数** |
| 系统 B 自动切分算法质量低 | HIGH | MEDIUM | **明确告知用户这是"初稿估算"，提供明显的手动跳过路径** |

### 关键分歧

| 点 | Claude 立场 | Codex 立场 | 处理方式 |
|----|-------------|------------|----------|
| Anki 替代方案 | 应补充分析为何不用 Anki | 未提及 | 记入计划，开发者自行评估（工具已确定，不回头） |
| 云同步 | 用户确认不需要 | 建议考虑轻量备份 | 数据导出（JSON）作为替代，维持"不做云同步"决策 |

### CEO Review 自动决策（新增）

| # | 决策 | 分类 | 原则 | 理由 |
|---|------|------|------|------|
| 9 | 先完成系统 A 再动系统 B | Mechanical | P3+P6 | 两个 CEO 声音一致，降低风险，优先验证 |
| 10 | 数据导出（JSON）升级为 V1.0 强制功能 | Mechanical | P1+P2 | 防止数据丢失是核心用户信任问题，blast radius 内 |
| 11 | 内置 KET 常见词汇示例包（约 100 词） | Mechanical | P2 | 降低首次使用门槛，CC < 1 天，效果明显 |
| 12 | 间隔复习参数（间隔天数）在设置页可调 | Mechanical | P1 | 数据可学习性，CC < 2h，已有设置页 |

---

## Phase 1: CEO Review — Sections 1-11

### Section 1: Architecture Review

**系统架构 ASCII 图（V1.0）:**

```
KET English PWA
├── vocab-review/                  (独立 PWA)
│   ├── index.html                 ──→ 哈希路由 (#/home, #/practice, #/words...)
│   ├── js/
│   │   ├── app.js ─────────────── 路由控制器 + 页面协调
│   │   ├── db.js ──────────────── IndexedDB 读写（idb 封装）
│   │   │                          ↕ words / word_progress / review_logs
│   │   │                          ↕ weekly_batches / daily_tasks
│   │   ├── scheduler.js ────────── 调度算法（间隔序列 + 优先级队列）
│   │   │   └── input: word_progress.next_review_at + today
│   │   │   └── output: daily_tasks 队列
│   │   ├── practice.js ─────────── 题型逻辑（4选1 / 拼写 / 补全）
│   │   │   └── input: daily_tasks + words
│   │   │   └── output: review_logs + word_progress 更新
│   │   └── stats.js ─────────────  统计聚合（从 review_logs 计算）
│   └── css/main.css              设计令牌 + 组件样式
│
├── listening-player/              (独立 PWA)
│   ├── index.html                 ──→ 哈希路由
│   ├── js/
│   │   ├── app.js ─────────────── 路由控制器
│   │   ├── db.js ──────────────── IndexedDB（含 Blob 音频存储）
│   │   │                          ↕ listening_sets / audio_assets / transcripts
│   │   │                          ↕ segments / segment_logs / difficult_segments
│   │   ├── segmenter.js ────────── 自动切分（文本分句 + 时间均匀估算）
│   │   ├── player.js ─────────────  音频播放控制（Web Audio API）
│   │   │   ├── timeupdate 事件监控循环边界
│   │   │   └── playbackRate 变速
│   │   ├── editor.js ─────────────  切分校正编辑器（DOM 拖拽）
│   │   └── difficult.js ──────────  错句本 + 回炉队列
│   └── css/main.css
│
└── shared/
    └── db.js                      IndexedDB 通用工具（两个子系统共用）

数据边界: 两个子系统 IndexedDB 数据库完全独立（不同 dbName）
通信边界: 无跨系统调用，无网络请求（V1.0 纯本地）
```

**耦合分析:** 两子系统完全解耦，共享设计令牌（CSS 变量）和 db.js 工具，无运行时依赖。耦合点：唯一是通过相同 shared/db.js，但各自使用不同 IndexedDB 数据库名称。可接受。

**单点故障:** IndexedDB 本身是单点故障——如果浏览器清除存储，所有数据丢失。缓解方案：数据导出功能（已计划）。

**安全架构:** 纯本地 PWA，无 API 调用，无认证边界。主要攻击面是导入文件（CSV、音频）。

**扩展性:** 10x 单词量（如 3000 词）、10x 套题：IndexedDB 可处理，但需要分页渲染。

**决策 #13 (Mechanical, P3):** 两个子系统使用不同的 `IDBDatabase` 实例（`ket-vocab-v1` 和 `ket-listening-v1`），绝不共享同一数据库。理由：清晰边界，独立版本管理。

### Section 2: Error & Rescue Map

| 代码路径 | 可能失败的情况 | 错误类型 |
|----------|----------------|----------|
| `db.js` — IndexedDB 打开/读写 | 浏览器隐私模式，配额超限 | `DOMException` |
| `db.js` — 大型 Blob 写入（音频） | iOS Safari 配额超限（~50MB） | `QuotaExceededError` |
| `player.js` — AudioContext 创建 | Safari 需用户手势 | `NotAllowedError` |
| `player.js` — 音频解码 | 文件格式不支持/损坏 | `MediaError` |
| `segmenter.js` — 文本分句 | 空原文/纯数字原文 | JS TypeError (null) |
| `practice.js` — 生成干扰项 | 词库不足 4 词时 4选1无法凑够 | ArrayIndexOutOfBounds |
| CSV 导入 | 编码错误（GBK/UTF-8 混用） | FileReader 返回乱码 |
| Service Worker 更新 | 旧缓存拦截新代码 | 无明显错误，但行为异常 |

**Error → 用户可见行为:**

| 错误 | 处理方式 | 用户看到 |
|------|----------|----------|
| `QuotaExceededError` | 捕获，提示腾空空间 | "存储空间不足，请删除部分套题" |
| `NotAllowedError` (AudioContext) | 在用户点击时再 resume | 播放按钮再点一次即可 |
| `MediaError` | 捕获，标记该音频文件损坏 | "该音频文件无法播放，请重新上传" |
| IndexedDB 不可用（隐私模式） | 检测并阻止进入，显示提示 | "请在普通浏览模式下使用本应用" |
| 词库 < 4 词时 4选1 | 用全部词凑满（允许重复干扰项）| 正常题目显示 |
| CSV 乱码 | 尝试 GBK 重新解码，仍失败提示 | "CSV 格式错误，请检查文件编码" |

**决策 #14 (Mechanical, P1):** 所有 IndexedDB 操作统一封装到 `db.js` 的 `try/catch`，确保每个读写操作有明确的错误日志和用户提示路径。

### Section 3: Security & Threat Model

**攻击面（本地 PWA，无服务端）:**

| 威胁 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| CSV 注入（Formula Injection）| 低 | 低 | 显示为纯文本，不用 Excel 渲染 |
| 音频文件恶意 Blob | 低 | 低 | 浏览器沙箱隔离，仅用于播放 |
| XSS：用户输入的单词/原文渲染 | 中 | 中 | **必须 `textContent` 而非 `innerHTML`** |
| Service Worker 劫持缓存 | 低 | 中 | HTTPS 部署时 SW 受同源策略保护 |
| IndexedDB 其他 origin 访问 | 不可能 | — | 浏览器同源隔离 |

**最高优先级安全规则（必须在代码中实现）:**
- 所有用户输入（单词、释义、原文）渲染时使用 `textContent`，**禁止** `innerHTML`
- CSV 解析不执行任何公式（不用 eval）
- 音频 Blob URL 用完立即 `URL.revokeObjectURL()`

**决策 #15 (Mechanical, P1):** 代码规范：所有动态内容渲染使用 `el.textContent = value`，永不使用 `el.innerHTML = value`，除非内容来自代码本身（非用户输入）。

### Section 4: Data Flow & Interaction Edge Cases

**系统 A — 每日任务生成数据流:**
```
words + word_progress
  ├──→ [filter] next_review_at <= today
  ├──→ [priority sort] 红>黄>绿>回炉>抽查
  ├──→ [cap] min(设置上限, 到期词数)
  └──→ daily_tasks 表

Shadow paths:
  nil next_review_at    → 视为"今天到期"，纳入任务
  词库为空              → 显示空状态，"还没有录入单词"
  所有词均为绿色        → 仅抽查模式，提示"词汇全部掌握！今日仅抽查"
  当日任务已完成        → 显示完成状态，不重复生成
```

**关键交互边界案例:**

| 交互 | 边界情况 | 处理方式 |
|------|----------|----------|
| 练习中刷新页面 | 已答未提交的题目丢失 | 当前题目重置，不影响已提交进度（IndexedDB 已写入） |
| 音频播放中切换页面 | AudioContext 挂起 | 实现 `visibilitychange` 事件暂停/恢复 |
| CSV 导入 100+ 单词 | 批量写 IndexedDB | 用 `transaction` 批量提交，失败则回滚全部 |
| 当日跨零点使用 | 任务日期计算错误 | 任务日期以 ISO 日期字符串（YYYY-MM-DD）本地时区为准 |
| 单词拼写输入框（会写词）| 用户粘贴含空格/特殊字符 | `.trim().toLowerCase()` 后比较 |
| 音频片段起止时间重叠 | 切分校正时拖动越界 | 强制 `end_time > start_time + 0.1s`，越界时弹回 |

**决策 #16 (Mechanical, P1):** 所有 IndexedDB 批量写入使用单次 `transaction`，保证原子性（成功则全部写入，失败则全部回滚）。

### Section 5: Code Quality Review

**模块职责划分检查（计划层面）:**
- `db.js`: 数据层，只做 CRUD，不含业务逻辑 ✓
- `scheduler.js`: 调度算法，只读 db，输出任务队列 ✓
- `practice.js`: 题型逻辑 + 评分，不含调度 ✓
- `app.js`: 路由 + 页面协调，不含业务逻辑 ✓

**潜在 DRY 违反（提前标记）:**
- 两个子系统的 `db.js` 可能重复哈希路由代码 → 应提取到 `shared/router.js`
- 两个子系统的 CSS 变量可能重复定义 → 应提取到 `shared/design-tokens.css`

**命名规范（预设）:**
- 函数命名：动词开头，如 `generateDailyTasks()`, `updateMasteryLevel()`
- 数据库函数：`getWordById()`, `saveReviewLog()`, `updateWordProgress()`
- 事件处理：`onAnswerSubmit()`, `onPlaybackSpeedChange()`

**过度工程检查:** 19 个文件，但分为 2 个独立 PWA。每个 PWA 内部 9 文件，逻辑清晰，无明显过度抽象。可接受。

**决策 #17 (Mechanical, P5):** 提取 `shared/router.js`（哈希路由）和 `shared/design-tokens.css`（CSS 变量），两个子系统各自 import。避免重复。

### Section 6: Test Review（计划层面）

**新 UX 流程（需测试）:**
```
系统 A:
  - 单词录入 → 保存 → 出现在词汇列表
  - 今日任务生成 → 按优先级排序 → 完成后状态更新
  - 练习作答 → 正确/错误 → 掌握等级更新
  - 错词回炉 → 再次出现在任务中
  - CSV 导入 → 词汇正确写入 IndexedDB

系统 B:
  - 音频上传 → 存储 Blob → 可播放
  - 原文输入 → 自动切分 → 生成 segments
  - 句段编辑 → 保存 → 下次加载正确时间轴
  - 单句循环 → 精确在 end_time 处重置
  - 变速播放 → 0.75x/0.85x/1.0x 正确生效
  - 难句标记 → 出现在错句本
```

**测试策略（纯前端项目，无测试框架配置）:**

由于这是 Vanilla JS 项目，不引入 Jest/Vitest 等测试框架（V1.0 无构建工具）。采用以下策略：

| 测试类型 | 方式 |
|----------|------|
| 核心算法（调度、优先级、掌握等级）| 在 `scheduler.js` 内写内联断言函数，dev 模式下可触发 |
| 手动测试清单 | 维护在 `docs/test-checklist.md` |
| 浏览器兼容性 | 手动在 Safari/Chrome/Firefox 测试关键路径 |
| IndexedDB 大文件测试 | 专项脚本：在 iOS Safari 写入 30MB Blob，验证读取 |

**决策 #18 (Mechanical, P3):** V1.0 不引入测试框架（保持零依赖），在 `scheduler.js` 和 `practice.js` 内写自验证函数，创建 `docs/test-checklist.md` 维护手动测试清单。

### Section 7: Performance Review

**关键性能路径:**

| 场景 | 预估 | 风险 | 缓解 |
|------|------|------|------|
| 每日任务生成（1000 词） | < 100ms | 低 | IndexedDB 全表读 + JS 排序，1000 行完全可接受 |
| 4选1 生成干扰项 | < 5ms | 低 | 内存中随机抽样 |
| 音频 Blob 存储（30MB）| 2-5s | 高 | 写入时显示进度 + 在 iOS Safari 专项测试 |
| 音频 Blob 读取播放 | < 1s | 中 | 用 `URL.createObjectURL()` 流式播放，不全量加载到内存 |
| 词汇列表渲染（500+词）| 潜在卡顿 | 中 | 500词以上启用虚拟滚动（已在风险表列出） |
| `timeupdate` 循环检测 | 每帧触发 | 中 | 轻量检测（比较两个数字），不做复杂计算 |

**决策 #19 (Mechanical, P3):** 音频 Blob 使用 `URL.createObjectURL()` 流式引用而非将完整 ArrayBuffer 写入内存；Blob 本体存 IndexedDB，URL 每次播放时创建，播放结束时 revoke。

### Section 8: Observability & Debuggability

**V1.0 本地家庭工具，无服务端，观测方案简化:**

| 观测点 | 实现方式 |
|--------|----------|
| 用户操作日志 | `review_logs` 和 `segment_logs` 表完整记录，可在统计页展示 |
| IndexedDB 存储占用 | 使用 `navigator.storage.estimate()` 显示存储占用量 |
| 错误捕获 | `window.onerror` + `window.onunhandledrejection`，展示用户可操作的错误提示 |
| 调试模式 | 开发时 `localStorage.setItem('ket-debug', '1')` 开启详细控制台日志 |

**决策 #20 (Mechanical, P5):** 实现 `window.onerror` 全局错误捕获，捕获后在页面底部显示"遇到了一个问题，请刷新页面"提示，同时 `console.error` 输出详细信息供开发者调试。

### Section 9: Deployment & Rollout

**部署形态:** 静态文件 + Docker nginx（已准备好 Dockerfile + docker-compose.yml）

| 部署场景 | 处理方式 |
|----------|----------|
| 更新静态文件 | 修改代码 → `docker-compose up --build` → 刷新浏览器 |
| Service Worker 更新 | 新 SW 安装后，`skipWaiting()` + `clients.claim()` 强制接管 |
| IndexedDB Schema 升级 | `onupgradeneeded` 回调，版本号递增迁移，V1.0 从 v1 开始 |
| 数据迁移失败 | `onupgradeneeded` 内如果出错，`transaction.abort()` 回滚整次升级 |
| 回滚 | git revert + `docker-compose up --build`，数据不受影响（IndexedDB 持久化） |

**部署后验证清单（5分钟检查）:**
1. 访问首页，检查 Service Worker 注册成功
2. 录入一个单词，刷新页面，确认数据持久化
3. 系统 B：上传 1MB 测试音频，验证播放
4. 手机浏览器：访问局域网地址，确认移动端布局

### Section 10: Long-Term Trajectory

**技术债评估:**

| 债类型 | 引入内容 | 量化 |
|--------|----------|------|
| 代码债 | Vanilla JS 无类型，>3000 行后可读性下降 | 低（V1.0 估计 ~2000 行） |
| 测试债 | 无自动化测试框架，手动测试清单 | 中（可接受，家庭自用工具） |
| 运维债 | 无监控/告警，本地工具无需 | 低 |
| 文档债 | 无 API 文档（Vanilla JS，无需） | 低 |

**可逆性评级:** 4/5（本地 PWA，随时可重写；IndexedDB Schema 升级需迁移脚本，但数据结构简单）

**12 个月路径:**
- V1.0 → V1.1: 暗色模式、音效反馈
- V1.1 → V1.2: Whisper API 接入，系统 B 自动切分质量大幅提升
- V2.0: 考虑是否引入云同步（需要后端）

**平台潜力:** `shared/db.js` 可演进为通用的 KET 学习数据层，如果将来加入第三个子系统（如写作练习）可直接复用。

### Section 11: Design & UX Review（UI 范围已检测）

**信息架构检查 — 用户首先看到什么:**

**系统 A 首页:** 今日任务数量（大数字） → 打卡进度 → 开始按钮 ✓（正确层级）
**系统 B 首页:** 最近套题列表 → 今日错句入口 ✓

**交互状态覆盖检查:**

| 功能 | 加载 | 空状态 | 错误 | 成功 | 部分 |
|------|------|--------|------|------|------|
| 单词列表 | ✓ | **计划中未明确** | 需补 | ✓ | — |
| 每日任务 | ✓ | **"暂无任务"状态未定义** | 需补 | ✓ | — |
| 音频上传 | **进度条未规划** | — | 需补 | ✓ | — |
| 切分校正 | ✓ | — | **切分失败未定义** | ✓ | — |

**用户旅程一致性:**
- 孩子路径：首页 → 今日任务 → 练习 → 完成反馈 ✓（路径清晰）
- 家长路径：录入 → 列表管理 → 统计复盘 ✓（路径清晰）
- 首次使用路径：**计划中未描述**。新家长第一次打开应用，看到什么？→ 需要 onboarding 引导

**移动优先状态:** 计划中明确"375px-414px 优先"，可接受。

**无障碍基础:** 计划中未提及 aria-label、对比度、tab 顺序。

**决策 #21 (Mechanical, P1):** 补充到计划中：
- 所有空状态（空词库、空任务、空套题）有明确提示文案 + 引导动作按钮
- 首次使用显示引导卡片（3步：录入单词 → 开始复习 → 查看统计）
- 音频上传显示进度条（文件读取 + IndexedDB 写入进度）

**用户流程 ASCII 图（系统 A 核心路径）:**

```
[首页]
  ├── 有任务 ──→ [今日任务页] ──→ [练习题] ──→ [提交] ──→ [对/错反馈]
  │                               └── 错题 ──→ [后半段再次出现]
  │                                              └──→ [完成页] ──→ 返回首页
  └── 无任务 ──→ "今日任务已完成！" 或 "还没有单词，去录入吧"

[家长路径]
  ├── [单词录入页] ──→ 手动 / CSV 导入 ──→ [词汇列表页]
  ├── [统计页] ──→ 每日/每周掌握曲线
  └── [设置页] ──→ 任务量上限 / 复习节奏
```

---

## Phase 1: CEO Review — Completion Summary

**CEO 双声模式:** Claude subagent + Codex GPT-5.4（均已完成）

**CEO 共识表（最终）:**
```
CEO DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid?                   YES     YES    CONFIRMED
  2. Right problem to solve?           YES     MOSTLY CONFIRMED*
  3. Scope calibration correct?        A先B后  A先B后 CONFIRMED
  4. Alternatives sufficiently         MEDIUM  LOW    DISAGREE→TASTE
     explored?
  5. Competitive/market risks covered? LOW     LOW    CONFIRMED
  6. 6-month trajectory sound?         MOSTLY  MOSTLY CONFIRMED*
═══════════════════════════════════════════════════════════════
*注: 两个模型均认同核心方向正确，但都提出"数据备份/导出"和
"系统A优先于系统B"是重要的实施顺序调整，已升级为计划修订项。
DISAGREE → Taste Decision #1: 是否需要内置 KET 词汇包（Claude: 强烈建议，Codex: 未提及）
```

**CEO 阶段自动决策汇总（#9-#21）共 13 项全部为 Mechanical，无 User Challenge。**

**关键修订（已写入计划）:**
1. 开发顺序改为系统 A 全完成后再动系统 B
2. 数据导出（JSON）升级为 V1.0 强制功能
3. 内置 KET 常见词汇示例包（约 100 词）
4. 所有 IndexedDB 操作封装 try/catch
5. 所有用户输入使用 `textContent` 渲染（禁止 innerHTML）
6. `shared/router.js` + `shared/design-tokens.css` 提取共用代码
7. 空状态定义 + 首次使用引导卡片
8. 音频上传进度条

**Phase 1 COMPLETE.**
Codex: 6 项关注。Claude subagent: 10 项问题。
Consensus: 5/6 确认，1 分歧（词汇包）→ 已自动决策为包含。
推进到 Phase 2: Design Review。

---

## Phase 2: Design Review

**设计完整度初评: 4/10**
计划描述了功能，未定义设计令牌（颜色/字体/间距）、组件视觉规格、空状态文案、情感弧线。无 DESIGN.md，以通用设计原则为准。

设计双声模式（DESIGN_NOT_AVAILABLE for visual mockups — OpenAI key not configured，降级为文本规范模式）

### CLAUDE SUBAGENT — 设计独立评审

**1. 信息层级问题（HIGH）**
首页"今日任务数量（大数字）"的文案框架未定义。对8岁孩子，"12题"让人气馁，"还剩3题"让人有冲劲。文案框架是核心设计决策，不是实现细节。
→ 修复：首页主数字固定为"还剩 X 题"文案框架。

**2. 角色混用（HIGH）**
系统 B 首页同时服务家长（套题管理）和孩子（训练入口），无角色区分。
→ 修复：系统 B 首页加"孩子/家长"模式切换，默认进入孩子训练视图。

**3. 大量缺失状态（HIGH）**
- 练习中途退出再回来（部分完成）→ 未描述
- 音频上传中途退出是否可恢复 → 未描述
- 首次使用引导完成后跳哪里 → 未描述
- 所有绿色词时的任务页 → 未描述文案

**4. 情感弧线断裂（HIGH）**
- 进入练习前无开场铺垫（"今天共12题，加油！"）
- 1.5秒错误反馈时间太短，孩子来不及看正确答案
- 完成屏未定义（仅"完成反馈"，未说是文字还是动画）
- 错词复现时孩子不知道为什么，会感到挫败
→ 修复：加练习开场屏（题数预告）；错误反馈延长至2.5秒；完成屏有庆祝动画；错词复现加提示文案。

**5. 设计令牌完全缺失（CRITICAL）**
无颜色HEX值、无字体族、无间距系统、无圆角值、无按钮样式、无4选1布局定义。
→ 修复：`Phase 1 基础框架`必须先产出 `shared/design-tokens.css`。

**6. 儿童友好性不足（HIGH）**
- 键盘快捷键对手机孩子无用，降低意义
- 音效被 defer 到 V1.1，但对低年龄段孩子是核心反馈
- 拼写题缺少"单词长度下划线"视觉支撑
- 练习页无题数进度条（孩子不知道还剩几题）

### CODEX — 设计 UX 挑战

**层级服务于开发者，不是用户（CRITICAL）**
计划以数据模型和页面列表组织，而非用户会话流程。对孩子的真实层级应该是：开始今天的任务 → 看进度 → 从错误中恢复 → 结束。对家长：快速录入内容 → 管理负担 → 验证进度 → 备份数据。

**响应式策略是事后补救（HIGH）**
"移动优先"加宽度范围不是布局策略。缺少：密度规则、拇指操作区、持久控制（底部导航）、小屏幕音频播放器布局、家长在平板端的编辑工作流。

**无障碍规格太弱（HIGH）**
字体大小和触摸目标不等于无障碍。缺少：焦点顺序、颜色对比度、错误信息、动效降级、屏幕阅读器标签、音频控件语义。

**最大的"实现时会被迫发明"的歧义:**
- 首次使用空状态设计
- 家长设置最小化路径
- iOS IndexedDB 失败降级 UX
- 孩子/家长模式切换 UX
- 移动端音频播放器布局

### 设计双声共识表

```
DESIGN DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Info hierarchy serves user?       NO      NO     CONFIRMED: problem
  2. Interaction states specified?     NO      NO     CONFIRMED: critical gap
  3. Emotional arc designed?          PARTIAL  NO     CONFIRMED: gap
  4. Responsive strategy intentional? NO      NO     CONFIRMED: gap
  5. Accessibility requirements?      NO      NO     CONFIRMED: gap
  6. Visual design specific enough?   NO      NO     CONFIRMED: critical gap
═══════════════════════════════════════════════════════════════
6/6 CONFIRMED — 两个模型完全一致，设计规格是计划的核心缺陷。
无分歧，无 User Challenge。
```

### 设计 7 个维度评审 + 自动决策

**维度 1: 信息架构 (3/10)**
- 问题：页面清单存在，但每个页面的信息层级未定义。
- 自动决策 #22 (Mechanical, P1): 在计划中补充每个关键页面的"用户首先看到什么"说明。已在 Section 11 开始，此处系统化补全。

关键页面信息层级规范：

| 页面 | 第1层（最显眼）| 第2层 | 第3层 |
|------|--------------|-------|-------|
| 系统A首页 | 还剩 X 题（大号数字）| 开始复习按钮 | 打卡天数 + 掌握分布 |
| 练习页 | 当前题目（题干大字）| 选项/输入框 | 进度条（第N题/共M题） |
| 完成页 | 庆祝动画 + "全部完成！"| 本次对错汇总 | 返回首页按钮 |
| 系统B训练页 | 播放控制（大按钮）| 当前句段文本 | 速度/循环开关 |

**维度 2: 空状态设计 (2/10)**

自动决策 #23 (Mechanical, P1): 所有空状态必须定义文案+引导动作。

| 页面 | 空状态文案 | 引导动作 |
|------|----------|--------|
| 系统A首页-无单词 | "还没有单词，先去录入吧" | [去录入] 按钮 |
| 系统A首页-今日已完成 | "🎉 今天的任务完成了！明天继续！" | [查看统计] 按钮 |
| 系统A首页-全绿状态 | "所有词都学会了！今天抽查几个?" | [开始抽查] 按钮 |
| 系统B首页-无套题 | "还没有套题，让家长来添加吧" | [添加套题] 按钮（家长模式） |
| 词汇列表-无结果 | "没有找到符合条件的单词" | [清除筛选] 链接 |

**维度 3: 错误状态设计 (2/10)**

自动决策 #24 (Mechanical, P1): 所有错误状态必须定义用户可见的文案和可操作路径。

| 错误场景 | 用户看到 | 可操作路径 |
|----------|----------|-----------|
| IndexedDB 不可用（隐私模式）| "请在普通浏览模式下使用，数据才能正常保存" | 无操作，仅提示 |
| 存储空间不足（音频上传）| "空间不足，无法保存音频。请删除旧套题" | [管理套题] 按钮 |
| 音频文件格式不支持 | "该格式不支持，请上传 MP3 或 M4A 文件" | [重新上传] 按钮 |
| 网络断开（Service Worker 未缓存资源）| "当前页面无法加载，请检查网络连接" | [重试] 按钮 |
| CSV 编码错误 | "文件读取失败，请确认 CSV 使用 UTF-8 编码保存" | [重新选择] 按钮 |

**维度 4: 用户旅程完整性 (4/10)**

练习状态机（补充到计划）：
```
[开场屏]
  "今天共 N 题，加油！"
  [开始] ──→ [第 1 题]
               │
               ├── 答对 ──→ [正确反馈 0.8s] ──→ [下一题]
               │
               └── 答错 ──→ [错误反馈 2.5s，显示正确答案]
                             ├── 继续 ──→ [下一题]
                             └── (错词加入后半段回炉队列)
                                         │
                             [后半段出现错词] ──→ "你之前答错了，再试一次！"
                                                   ├── 答对 ──→ 正常流程
                                                   └── 答错 ──→ 不再重复，继续

[完成屏]
  庆祝动画（CSS only，无音频素材）
  "今天全部完成！共 N 题，答对 M 题"
  连续打卡天数更新
  [查看统计] [返回首页]
```

自动决策 #25 (Mechanical, P1): 上述状态机写入 practice.js 规格。错误反馈时间从 1.5s 延长到 2.5s。

**维度 5: 移动端响应式 (3/10)**

自动决策 #26 (Mechanical, P1): 补充移动端布局规则到计划：

| 规则 | 具体规范 |
|------|---------|
| 底部导航 | 固定 bottom: 0，高度 60px，4个 tab（今天/词汇/统计/设置） |
| 拇指操作区 | 主要操作按钮在屏幕下半部（60%以下），单手可达 |
| 拼写输入 | 键盘弹出时，输入框跟随 viewport 调整，不被键盘遮挡（用 `visualViewport` API） |
| 音频播放器 | 固定在底部（系统B训练页），高度 80px，播放/暂停按钮居中 56px |
| 平板（768px+）| 列表和内容区左右分栏，家长管理页最大受益 |

**维度 6: 无障碍基础 (2/10)**

自动决策 #27 (Mechanical, P1): 补充最低无障碍要求（不追求完整 WCAG AA，但覆盖基础）：

| 要求 | 具体实现 |
|------|---------|
| 颜色对比度 | 正文文字对背景对比度 ≥ 4.5:1 |
| 焦点样式 | 所有可交互元素有明显 `:focus` 样式（不去掉 outline） |
| 按钮语义 | 使用 `<button>` 而非 `<div onclick>`，播放控件有 `aria-label` |
| 颜色不是唯一区分 | 红/黄/绿掌握等级同时有图标/文字标注，不只靠颜色 |
| 动效降级 | 检测 `prefers-reduced-motion`，微动画在该设置下禁用 |

**维度 7: 设计令牌规范（CRITICAL — 必须在 Phase 1 前完成）**

自动决策 #28 (Mechanical, P1): `shared/design-tokens.css` 必须包含以下精确值，在 Phase 1 基础框架阶段第一天产出：

```css
/* shared/design-tokens.css — KET English 设计令牌 */
:root {
  /* 主色 */
  --color-primary: #4F7BF7;        /* 蓝紫，按钮/链接 */
  --color-primary-light: #EEF2FF;  /* 浅蓝背景 */

  /* 状态色（掌握等级）*/
  --color-red: #F44336;     /* 红词（未掌握）*/
  --color-yellow: #FFC107;  /* 黄词（学习中）*/
  --color-green: #4CAF50;   /* 绿词（已掌握）*/

  /* 语义色 */
  --color-success: #4CAF50;
  --color-error: #F44336;
  --color-warning: #FF9800;
  --color-text-primary: #1A1A2E;
  --color-text-secondary: #64748B;
  --color-bg: #F8FAFF;
  --color-surface: #FFFFFF;

  /* 间距（8px 栅格）*/
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;

  /* 圆角 */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 9999px;

  /* 字体 */
  --font-family: 'PingFang SC', 'Helvetica Neue', sans-serif;
  --font-size-sm: 14px;
  --font-size-base: 16px;
  --font-size-lg: 18px;
  --font-size-xl: 22px;
  --font-size-2xl: 28px;
  --font-size-hero: 48px;  /* 首页大数字 */

  /* 阴影 */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.10);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.12);

  /* 动效 */
  --transition-fast: 150ms ease;
  --transition-base: 250ms ease;
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
```

**设计阶段 USER CHALLENGE（需确认）:**
两个模型一致指出"音效对儿童是核心反馈，被 defer 到 V1.1 是错误"。但这不是 User Challenge，因为这是设计判断而非方向改变。

**自动决策 #29 (Taste, P1):** 使用 Web Audio API `AudioContext.createOscillator()` 在代码内生成答对/答错 beep（无需外部音频素材），升级为 V1.0 必须功能。CC < 30min，blast radius 内（practice.js）。列为 Taste Decision（两模型建议 vs 原计划 defer）。

---

## Phase 2: Design Review — 完成摘要

**设计评审评分（7维度）:**

| 维度 | 评分 | 关键行动 |
|------|------|---------|
| 信息架构 | 3/10 | 已补充每页信息层级规范 |
| 空状态 | 2/10 | 已补充全部空状态文案 |
| 错误状态 | 2/10 | 已补充全部错误状态文案 |
| 用户旅程 | 4/10 | 已补充练习状态机 + 情感弧线 |
| 移动响应式 | 3/10 | 已补充移动布局规则 |
| 无障碍 | 2/10 | 已补充基础无障碍规范 |
| 设计令牌 | 0/10 | 已输出完整 design-tokens.css 规范 |

**Phase 2 Taste Decision:**
- TD#1: 内置 Web Audio beep 音效（两模型均建议升级为 V1.0）→ 标记为 Taste，最终门控时呈现

**新增自动决策 #22-29（共 8 项，全部 Mechanical/Taste）**

**Phase 2 COMPLETE.**
Codex: 7 项关注。Claude subagent: 6 个问题。
Consensus: 6/6 确认（设计规格是核心缺陷）。
关键修订已写入计划（设计令牌、状态机、空状态、错误状态、移动布局规则）。
推进到 Phase 3: Eng Review。

---

## Phase 3: Eng Review

### CLAUDE SUBAGENT — 工程独立评审（关键发现）

**[CRITICAL] scheduler.js: generateDailyTasks() 缺少幂等性**
凌晨 00:01 生成任务后，早上再打开会重复生成同一天任务，掌握等级错误计算。
→ 修复：写入前 `SELECT task_date = today` 检查是否已存在，存在则返回缓存。

**[CRITICAL] scheduler.js: updateMasteryLevel() 降级时 consecutive_correct 未归零**
红→黄→绿后答错降黄，`consecutive_correct` 未清零，下次只需答对 1 次就重新升绿，间隔重复失效。
→ 修复：任何降级操作必须 `consecutive_correct = 0`。

**[CRITICAL] 日期计算: 毫秒偏移而非日历天**
`Date.now() + 86400000` 会导致下午答题的词到第二天早上还没"到期"（24小时没过）。
→ 修复：`next_review_at` 全程用 ISO 日期字符串（YYYY-MM-DD），加 N 天用 date-arithmetic，不用毫秒偏移。

**[CRITICAL] listening-player/db.js: 音频 Blob + 元数据非原子写入**
Blob 写到一半配额超限，`audio_assets` 元数据已提交但 Blob 丢失 → 损坏套题。
→ 修复：Blob 存储和元数据写入在同一 `IDBTransaction` 内，事务级原子性。

**[HIGH] player.js: timeupdate 事件在 iOS Safari 节流到 250ms**
2秒短句段在 0.75x 速度下，循环边界检测窗口可能飞越。
→ 修复：用 `requestAnimationFrame` 替代 `timeupdate`，在 rAF 回调检查 `currentTime >= segment.end_time`，精度 16ms。

**[HIGH] scheduler.js: 任务去重 — 回炉词与到期词重复**
同一个词既在回炉队列又在今天到期，会出现两次。
→ 修复：`generateDailyTasks()` 最终输出前按 `word_id` 去重，保留最高优先级实例。

**[HIGH] 错误显示路径 XSS: 用户文件名拼接到 innerHTML**
错误提示如 `"无法读取文件: " + file.name` 拼接到 innerHTML，文件名含 HTML 会 XSS。
→ 修复：全部错误显示路径用 `textContent`，绝不拼接到 `innerHTML`。

**[MEDIUM] CSV 解析器: 不应手写 split(',')**
引号内换行、全角逗号、GBK 编码都会导致手写解析器崩溃。
→ 修复：引入 `papaparse`（7KB，CDN 引入，无需构建工具），V1.0 强制使用。

**[MEDIUM] shared/db.js vs js/db.js 架构歧义**
计划两处描述矛盾：`shared/db.js` 是通用工具 vs 业务层。
→ 修复：`shared/db.js` 只放 `openDB` + 底层工具；各子系统 `js/db.js` 放业务 Schema。

### CODEX — 工程架构挑战

**Vanilla JS 在系统 A 合理，在系统 B 是技术风险**
System A（表单+调度+本地状态）Vanilla JS 完全够用。System B（Blob存储+音频时序+编辑器交互+SW生命周期+iOS配额）在零构建工具约束下会变成调试噩梦。

**[CRITICAL] skipWaiting() + clients.claim() 与 IDB Schema 迁移竞态（最危险的单行代码）**
SW 激活后立刻接管所有 tab，此时旧页面的 in-memory 状态 + 新 Schema 可能不兼容，触发数据错误，用户感知为"更新后随机损坏"。
→ 修复：SW 更新时不立刻 claim，而是显示"新版本可用，点击更新"提示，用户确认后再刷新。

**[HIGH] "回滚=数据不受影响"是错的**
V1 Schema 回滚到 V0 代码，IndexedDB 没有向下兼容保证，旧代码读新 Schema 会崩溃。
→ 修复：每个 Schema 版本必须有回滚迁移脚本；或承认"无法回滚到旧 Schema，只能前进"。

**[HIGH] 系统 B 数据摄取未建模**
上传中断、重复资源、孤儿 transcript/segment 行、切分后重新摄取的冲突 → 全部未定义。

**[HIGH] "IndexedDB 不丢失"在 iOS Safari 下不成立**
存储压力、App 被驱逐、隐私浏览 → IndexedDB 可被清除。这不是"缓解"，这是用户真实会碰到的。
→ 修复：在所有涉及 IndexedDB 的首次加载时，检测存储健康状态，建议用户定期导出。

### 工程双声共识表

```
ENG DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?               MOSTLY  PARTIAL DISAGREE*
  2. Test coverage sufficient?         NO      NO     CONFIRMED: gap
  3. Performance risks addressed?      MOSTLY  MOSTLY CONFIRMED
  4. Security threats covered?         MOSTLY  MOSTLY CONFIRMED
  5. Error paths handled?              PARTIAL PARTIAL CONFIRMED: gap
  6. Deployment risk manageable?       PARTIAL NO     CONFIRMED: gap
═══════════════════════════════════════════════════════════════
*DISAGREE: Claude — System A/B 架构均合理；Codex — System B 在 Vanilla JS 下是风险。
→ Taste Decision #2: 系统 B 是否需要构建工具（papaparse 已解决 CSV，rAF 已解决音频，风险可接受）
→ 自动决策（P3）: 保持 Vanilla JS，但 papaparse 通过 CDN 引入，不添加构建工具。
```

### Section 3 — 测试计划（写入磁盘）

见 `~/.gstack/projects/KETEngish/test-plan-20260416.md`（如下内容同时写入 plan.md）

**关键测试矩阵:**

| 测试项 | 类型 | 优先级 | 实现方式 |
|--------|------|--------|---------|
| 每日任务生成幂等性（跨零点两次调用）| 单元 | P0 | `scheduler.js` 内联断言 |
| 掌握等级升降 + consecutive_correct 归零 | 单元 | P0 | `scheduler.js` 内联断言 |
| 日期计算（下午答题，次日早上是否到期）| 单元 | P0 | `scheduler.js` 内联断言 |
| 任务去重（回炉词与到期词重复）| 单元 | P0 | `scheduler.js` 内联断言 |
| 词库 < 2 词时 4选1 干扰项生成 | 单元 | P0 | `practice.js` 内联断言 |
| 音频 Blob + 元数据原子写入（写一半失败）| 集成 | P0 | iOS Safari 专项脚本 |
| IndexedDB Schema v1→v2 迁移成功 | 集成 | P1 | 手动：v1 数据 + v2 代码 |
| SW 更新后旧 tab 数据一致性 | 集成 | P1 | 手动：两个 tab 同时打开 |
| iOS Safari 存储配额超限提示 | 集成 | P1 | 手动：iPhone 填满存储测试 |
| timeupdate/rAF 循环边界精度（0.75x）| 单元 | P1 | `player.js` 内联断言 |
| CSV 导入（GBK、含引号、含换行）| 集成 | P1 | 手动测试用例文件 |
| XSS：文件名含 HTML 标签 | 安全 | P1 | 手动：上传名为 `<img>.mp3` 的文件 |
| 全部绿色词时首页空状态正确显示 | UI | P2 | 手动 |
| 完成屏庆祝动画触发 | UI | P2 | 手动 |

**手动测试清单文件:** `docs/test-checklist.md`（Phase 1 基础框架阶段创建）

### 工程新增自动决策（#30-#38）

| # | 决策 | 分类 | 原则 | 要点 |
|---|------|------|------|------|
| 30 | generateDailyTasks() 加幂等性检查 | Mechanical | P1 | 防止跨零点重复生成 |
| 31 | updateMasteryLevel() 降级时 consecutive_correct=0 | Mechanical | P1 | 间隔重复正确性保证 |
| 32 | next_review_at 用 YYYY-MM-DD 而非毫秒偏移 | Mechanical | P5 | 时区安全，无歧义 |
| 33 | 音频 Blob + 元数据同一 IDBTransaction | Mechanical | P1 | 原子性，防损坏 |
| 34 | player.js 用 rAF 替代 timeupdate 检测边界 | Mechanical | P1 | iOS Safari 精度 |
| 35 | 任务生成按 word_id 去重 | Mechanical | P5 | 防优先级冲突 |
| 36 | CSV 解析用 papaparse（CDN）| Mechanical | P3 | 7KB，零构建工具，可靠 |
| 37 | SW 更新改为用户确认（不自动 claim）| Mechanical | P1 | 防 IDB 竞态损坏 |
| 38 | 每次冷启动检测 IndexedDB 存储健康状态 | Mechanical | P1 | 用户感知数据安全 |

### 失败模式注册表（关键补充）

| 失败模式 | 触发条件 | 严重度 | 处理方式 |
|----------|----------|--------|---------|
| 间隔重复算法静默失效 | consecutive_correct 未归零 | 关键 | 内联断言 + 单元测试 |
| 跨零点任务重复生成 | 无幂等性检查 | 关键 | 生成前检查 |
| 音频 Blob 部分写入损坏 | 配额超限 mid-write | 关键 | 原子事务 |
| SW 更新数据竞态 | skipWaiting+claim | 高 | 用户确认模式 |
| iOS Safari 数据蒸发 | 存储压力/隐私模式 | 高 | 健康检测 + 导出提醒 |
| 循环边界飞越 | iOS timeupdate 250ms 节流 | 高 | rAF 替代 |
| CSV 解析崩溃 | 引号/换行/GBK | 中 | papaparse |
| XSS 通过文件名 | innerHTML + file.name | 高 | textContent 强制 |

---

## Phase 3: Eng Review — 完成摘要

**Phase 3 COMPLETE.**
Claude subagent: 9 个问题（4 个 CRITICAL）。
Codex: 5 个高优先问题（1 个 CRITICAL: SW 竞态）。
Consensus: 5/6 确认，1 分歧（系统B架构是否需要构建工具）→ Taste Decision #2，自动决策保持 Vanilla JS + papaparse CDN。

关键修订写入计划：
- 4 个算法 CRITICAL 修复（幂等性、consecutive_correct、日期计算、原子事务）
- rAF 替代 timeupdate
- SW 更新改为用户确认模式
- papaparse 替代手写 CSV 解析
- 测试矩阵写入 test-checklist.md

Phase 3.5 (DX Review): 跳过 — 无开发者面向范围（纯家庭消费工具）。
推进到 Phase 4: Final Approval Gate。

---

## Phase 4: Final Approval Gate

### 全部自动决策汇总（共 38 项）

所有决策均为 Mechanical（直接执行），除以下 Taste Decisions：

#### Taste Decisions（合理人士可能有不同意见，已自动选择）

| TD | 内容 | 自动选择 | 原因 |
|----|------|---------|------|
| TD#1 | 内置 KET 词汇示例包 | ✅ 包含 | 两个 CEO 声音均认为降低首次门槛是核心需求 |
| TD#2 | 系统B保持 Vanilla JS | ✅ 保持 | papaparse CDN + rAF 已解决主要风险，无需构建工具 |
| TD#3 | 音效 Web Audio API beep | ✅ V1.0 包含 | 两个设计声音均认为对儿童是核心反馈；CC < 30min |

#### 无 User Challenge
两个模型没有发现"用户明确要做 X 但两个模型都建议不做 X"的场景。
所有建议均是增补计划细节，而非反对用户的方向。

### 计划最终修订清单（所有 3 个阶段合并）

**新增到 V1.0 范围（vs 原计划）:**
1. ✅ PWA install prompt（manifest.json）
2. ✅ 练习键盘快捷键（桌面用户）
3. ✅ 数据导出 JSON（必须功能，非可选）
4. ✅ 内置 KET 示例词汇包（约 100 词）
5. ✅ 复习间隔在设置页可调
6. ✅ 音效 Web Audio API beep（代码生成，无外部素材）
7. ✅ papaparse（CDN）替代手写 CSV 解析
8. ✅ shared/router.js + shared/design-tokens.css 提取
9. ✅ 空状态文案全部定义（6 个页面）
10. ✅ 错误状态文案全部定义（5 个错误类型）
11. ✅ 练习状态机 + 情感弧线（开场屏/完成屏/错词提示）
12. ✅ 移动端布局规则（底部导航/拇指区/键盘处理）
13. ✅ 无障碍基础规范（对比度/焦点/语义/动效降级）
14. ✅ design-tokens.css 精确值（颜色/字体/间距/圆角/阴影）
15. ✅ generateDailyTasks() 幂等性
16. ✅ 降级时 consecutive_correct=0
17. ✅ 日期计算改为 YYYY-MM-DD
18. ✅ 音频 Blob + 元数据原子事务
19. ✅ rAF 替代 timeupdate 检测循环边界
20. ✅ 任务按 word_id 去重
21. ✅ SW 更新改为用户确认模式（不自动 claim）
22. ✅ 冷启动 IndexedDB 健康检测
23. ✅ 全局错误处理（window.onerror + textContent）

**开发顺序确认:**
- 系统 A 全部完成（Phase 2 + 3）→ 使用 2 周验证 → 才开始系统 B（Phase 4 + 5）

**Deferred 到 TODOS.md:**
- 见 `TODOS.md`（已创建）

---

## GSTACK REVIEW REPORT

| Review | Phases | Runs | Status | Key Findings |
|--------|--------|------|--------|--------------|
| CEO Review | Step 0A-0F + Dual Voices + Sections 1-11 | 1 | ✅ DONE | 12个自动决策；先做系统A；数据导出升级必须 |
| Design Review | 7维度 + Dual Voices | 1 | ✅ DONE | design-tokens、状态机、空状态全部补全 |
| Eng Review | Dual Voices + Test Plan | 1 | ✅ DONE | 4个CRITICAL算法修复；SW竞态；rAF替代 |
| DX Review | — | 0 | ⏭ SKIPPED | 无开发者面向范围（消费工具） |

**VERDICT: APPROVED — 可以开始写代码。**
执行顺序: Phase 1（基础框架 + design-tokens）→ Phase 2（系统A核心）→ Phase 3（系统A完善）→ 使用2周 → Phase 4（系统B）

**测试计划写入:** `~/.gstack/projects/KETEngish/test-plan-20260416.md`
**延期项目:** `TODOS.md`
**总决策数:** 38 项 Mechanical + 3 项 Taste，0 项 User Challenge




