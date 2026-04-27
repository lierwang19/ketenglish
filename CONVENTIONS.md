# 项目约定

记录目录结构、文件命名、代码组织方式。任何新建文件之前，先翻这份。

---

## 顶层目录结构

```
KET Engish/
├── README.md              人类入口
├── CONVENTIONS.md         本文件
├── claude.md              Claude Code 引导
├── agent.md               通用 AI Agent 引导
├── TODOS.md               当前待办
├── plan.md                早期规划稿（历史，逐步退役）
│
├── docs/                  产品文档
│   ├── decisions/         ADR（架构决策记录）
│   │   ├── INDEX.md       决策索引
│   │   └── NNNN-标题.md   单次决策
│   ├── KET单词滚动复习软件需求书_V1.0.md
│   ├── KET听力句段精听播放器需求书_V1.0.md
│   └── *.pdf              教材资料
│
├── shared/                两子系统共用底层
│   ├── db.js              IndexedDB 通用工具（无业务 schema）
│   ├── design-tokens.css  设计令牌（颜色、间距、字号）
│   ├── feedback.js        Toast / 加载遮罩
│   ├── router.js          哈希路由
│   └── theme.js           暗色主题切换
│
├── vocab-review/          子系统 A：单词复习
│   ├── index.html         单页 HTML，含所有页面 section
│   ├── manifest.json      PWA 清单
│   ├── sw.js              Service Worker
│   ├── css/main.css       本子系统样式
│   ├── js/                业务模块
│   │   ├── app.js         入口 + 路由注册 + 各页面渲染
│   │   ├── db.js          业务 IndexedDB schema 和 CRUD
│   │   ├── scheduler.js   间隔重复算法
│   │   ├── practice.js    在线刷题（次要）
│   │   ├── settings.js    设置读写
│   │   ├── stats.js       复盘统计
│   │   └── textbook-importer.js  教材批量导入
│   ├── data/              内置词表 JSON
│   ├── vendor/            第三方库（如 tesseract OCR）
│   └── assets/            图标、图片
│
├── listening-player/      子系统 B：听力精听（结构同上）
│
├── docker-compose.yml     本地起 nginx
├── Dockerfile
├── nginx.conf
└── .gitignore
```

---

## 文件 / 模块命名

- **目录** 全小写中划线：`vocab-review/`、`listening-player/`、`docs/decisions/`
- **JS 模块** 全小写中划线：`textbook-importer.js`、`app.js`
- **CSS** 全小写中划线：`design-tokens.css`、`main.css`
- **ADR 文件**：`NNNN-中文短标题.md`，编号四位补零（`0001-` 起），标题用中文方便检索
- **截图 / 临时资料** 不入库（`.gitignore` 已排除常见模式，新增前先确认）

---

## 代码组织约束

### 子系统边界

- `shared/` 只放**通用工具**，不写业务规则，不依赖任何子系统
- 子系统内部：`js/db.js` 定义 IndexedDB schema 和 CRUD，业务规则放对应模块（`scheduler.js` / `practice.js` 等）
- 子系统之间不互相 import。需要共用，往 `shared/` 里抽

### IndexedDB 事务

- 多 store 原子操作必须**单事务**完成（参考 `vocab-review/js/db.js` 的 `deleteWeek`）
- 事务回调内**只能 await IDB 请求**，不能 await fetch / setTimeout 等非 IDB Promise（事务会自动 commit 中断）
- 详细约束见 `shared/db.js` 的 `withTransaction` JSDoc

### Service Worker

- 每个子系统独立一个 `sw.js`，作用域是子系统目录（`/vocab-review/`、`/listening-player/`）
- **任何 cache 资源变化（HTML / JS / CSS / data）都必须 bump `CACHE_NAME` 版本号**，否则用户拿不到新代码
- 自动激活模型：`self.skipWaiting()` + `clients.claim()` + 页面侧 `controllerchange` 自动 reload。原因见 [ADR 0003](docs/decisions/0003-SW自动激活更新模型.md)

### 危险操作

- 任何**清空 / 删除**类操作必须用 `confirmDanger()` 打字校验对话框，不能用 `window.confirm`
- 异步按钮处理器用 `withBusy(btn, fn)` 包装，防止重复点击
- 详见 [ADR 0004](docs/decisions/0004-危险操作打字校验确认.md)

### 注释和命名

- 注释默认不写。只在"为什么"非显然时写一行（如绕过浏览器 bug、跨模块隐含约定）
- 不写"做了什么"的注释 —— 标识符自己应该说清
- 中文注释 OK，但**类型 / 状态值 / 枚举字符串保持英文**（如 `'spelling' / 'recognition'`、`'red' / 'yellow' / 'green'`），方便 grep

---

## 何时新建 vs 何时改现有

**改现有文件**：90% 情况下的默认。优先复用 `shared/`、复用现有页面 section、复用现有 CSS 类。

**新建文件** 才考虑的场景：
- 新增一个独立子系统（`shared/` 之外）
- 业务模块超过 ~500 行且能清晰分割
- 新增 ADR、新增 vendor 第三方库

**新建前必做**：
1. grep 一下功能名，确认没有现成的能用
2. 确认放进现有目录（不要往根上扔）
3. 文件命名遵守上面的小写中划线规则

---

## AI 协作约定

- Claude Code 主开发，Codex 复核（详见根目录 `CLAUDE.md` 工作区规范）
- 重要决策（产品方向、IA 重构、技术选型）写 ADR，不要散落在 commit message 里
- 提交前优先把改动交给 Codex 跑一轮 review

---

## 提交信息

- 中文为主，可加英文 prefix（`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`）
- 一句话说清"做了什么"，正文展开"为什么这么做"
- 与某次 ADR 相关时，正文里链一下：`参考 docs/decisions/0006-...md`
