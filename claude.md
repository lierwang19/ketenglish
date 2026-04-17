# KET English — 项目引导文件 (Claude)

## 项目概述

本项目为 **KET 备考家庭** 提供两款轻量学习工具，均以网页/PWA形式交付，面向小学生及其家长使用。

### 子系统 A：KET 单词滚动复习系统

**定位**：旧词滚动复习机 + 会写词强化工具。不替代孩子的新词学习方式，专注于把"已学过的词"纳入科学复习。

**核心能力**：
- 按周录入单词，区分认读词/会写词
- 自动生成每日复习任务（基于间隔重复：第0/1/3/7/14/30天）
- 红/黄/绿三层掌握分级，错词自动回炉
- 每日任务量可控，不会随周数增加无限膨胀
- 家长可视化统计与每周复盘

**关键业务规则**：
- 每日任务优先级：到期红词 > 到期黄词 > 到期会写词 > 历史错词回炉 > 绿色词抽查
- 认读词题型：看英文选中文、看中文选英文
- 会写词题型：看中文拼英文、补全单词（缺字母）
- 当日做错的词需在本次任务后半段再次出现

### 子系统 B：KET 听力句段精听播放器

**定位**：句段精听播放器 + 错句回炉工具。解决听不清、跟不上、难以反复抠句的问题。

**核心能力**：
- 家长导入音频与原文，系统自动初切句段
- 人工校正切分（拆分/合并/拖动边界）
- 单句循环、变速播放（0.75x/0.85x/1.0x）、前后句联听
- 错句本与回炉机制
- 精听模式 / 考试模式 / 复盘模式切换

**关键业务规则**：
- 训练节奏：整题听一次 → 句段精听 → 整题再听一次
- 错句回炉三级优先级：高危句 > 一般难句 > 已解决句
- 考前阶段降低单句循环、提高整题训练占比

---

## 技术栈

| 层级 | 技术选型 |
|------|----------|
| 前端 | HTML + CSS + JavaScript（网页/PWA） |
| 样式 | Vanilla CSS，现代设计美学（渐变、微动画、暗色主题） |
| 数据存储 | IndexedDB / SQLite（本地优先，预留云同步） |
| 音频处理 | Web Audio API / 原生 Audio 元素 |
| 自动转写 | Whisper / 第三方 ASR（可选，非 V1.0 强制） |

## 目录结构（规划）

```
KET Engish/
├── claude.md              # Claude Code 项目引导
├── agent.md               # 通用 AI Agent 项目引导
├── docs/                  # 需求文档
│   ├── KET单词滚动复习软件需求书_V1.0.md
│   └── KET听力句段精听播放器需求书_V1.0.md
├── vocab-review/          # 子系统A：单词滚动复习
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── assets/
└── listening-player/      # 子系统B：听力精听播放器
    ├── index.html
    ├── css/
    ├── js/
    └── assets/
```

## 设计原则

1. **儿童友好**：字体清晰、按钮大、操作路径短、进入即可开始任务
2. **视觉出色**：使用现代设计语言（圆角、柔和渐变、微动画、卡通配色），不做简陋 MVP
3. **本地优先**：数据持久化在本地，页面刷新不丢失进度
4. **中文界面**：所有 UI 文案使用中文
5. **移动优先**：优先适配手机和平板，桌面端自适应

## 数据模型

### 单词系统核心表
- `words` — 单词主表（英文、中文、词性、词类型、周次等）
- `word_progress` — 学习进度（掌握等级、连续正确次数、下次复习时间等）
- `review_logs` — 复习日志
- `weekly_batches` — 周次管理
- `daily_tasks` — 每日任务

### 听力系统核心表
- `listening_sets` — 套题主表
- `audio_assets` — 音频资源
- `transcripts` — 原文
- `segments` — 句段（起止时间、文本、状态）
- `segment_logs` — 训练日志
- `difficult_segments` — 错句本

## V1.0 边界

**做**：核心复习/精听闭环、错词/错句回炉、基础统计
**不做**：AI 讲解、口语评分、社交排名、云同步、公开题库分发

## 需求详情

完整需求书位于 `docs/` 目录：
- [单词滚动复习需求书](docs/KET单词滚动复习软件需求书_V1.0.md)
- [听力精听播放器需求书](docs/KET听力句段精听播放器需求书_V1.0.md)

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
