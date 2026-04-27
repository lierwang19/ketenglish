# KET English

为 KET 备考家庭做的两款轻量学习工具，纯网页 / PWA，本地数据，离线可用。

**用户对象：家长**（不是孩子）。家长用它给孩子备课、出题、批改、复盘；孩子在纸上做题。

---

## 子系统

### vocab-review/ — KET 单词滚动复习

家长录入每周老师布置的单词，系统按 **0/1/3/7/14/30 天间隔重复** 自动生成每日复习清单。家长导出题卡 → 孩子在纸上做 → 家长拍照上传 → OCR 批改 → 错词自动回炉。

底栏 4 个 tab：
- **今日**：今日清单 + 导出题卡 + 上传答卷批改
- **词库**：按周次管理单词、录入新一周
- **复盘**：掌握度、高频错词、周报
- **设置**：每日量、数据导入导出

### listening-player/ — KET 听力句段精听播放器

家长导入音频与原文，系统自动初切句段，支持单句循环、变速、错句回炉。

> 状态：单词系统是当前主力开发对象；听力系统骨架已搭，深度开发未开始。

### shared/ — 两子系统共用

底层工具：IndexedDB 封装、设计令牌、哈希路由、主题切换、Toast 反馈。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | 原生 HTML + CSS + JavaScript（ES Module） |
| 路由 | 自写哈希路由（`shared/router.js`） |
| 数据 | IndexedDB（`shared/db.js` 工具 + 各子系统 `js/db.js` 业务 schema） |
| 离线 | Service Worker（每个子系统一个 `sw.js`） |
| 部署 | Docker + nginx 静态托管 |

不使用前端框架。原因见 [decisions/0001](docs/decisions/0001-技术栈选型.md)。

---

## 本地运行

直接用任何静态服务器打开根目录即可。推荐：

```bash
# 方式 1：项目自带的 docker-compose
docker-compose up

# 方式 2：任何静态服务器
cd "KET Engish" && python3 -m http.server 8080
# 然后打开 http://localhost:8080/vocab-review/
```

> ⚠️ 必须通过 HTTP 服务访问，不能用 `file://` 直接打开 —— Service Worker 和 ES Module 都需要 HTTP 协议。

---

## 文档地图

| 文件 | 给谁看 | 内容 |
|---|---|---|
| [README.md](README.md) | 任何人 | 你正在看的这份 |
| [CONVENTIONS.md](CONVENTIONS.md) | 开发者 / AI | 目录结构、文件命名、代码约定 |
| [docs/decisions/INDEX.md](docs/decisions/INDEX.md) | 开发者 / 未来的我 | 历次产品和技术决策的来龙去脉 |
| [docs/](docs/) | 产品 | 需求书、教材资料 |
| [claude.md](claude.md) | Claude Code | AI 引导 |
| [agent.md](agent.md) | 通用 AI Agent | AI 引导 |
| [TODOS.md](TODOS.md) | 我 | 待办清单 |

---

## V1.0 边界

**做**：核心复习/精听闭环、错词/错句回炉、基础统计、本地数据。

**不做**：AI 讲解、口语评分、社交排名、云同步、公开题库分发。
