语言 / Language: [English](README.md) | **简体中文**

# Memo App

一个支持文件附件、富文本、剪藏（Clips）和全文搜索的个人备忘录应用。完全构建于 Cloudflare 之上 —— SvelteKit + Workers + D1（SQLite）+ R2（对象存储）+ Pages。

线上地址：`https://memo.1000600.xyz`

---

## 架构

| 层级 | 技术 |
|---|---|
| 前端 | SvelteKit 2 + Svelte 5（runes），托管于 Cloudflare Pages |
| 后端 | Cloudflare Worker，TypeScript + [Hono](https://hono.dev) 4（`worker.ts`） |
| ORM | [Drizzle ORM](https://orm.drizzle.team) 用于 D1 的增删改查；仅在 Drizzle 无法处理的地方使用原生 SQL（FTS5 虚拟表、`settings` 的 upsert） |
| 数据库 | Cloudflare D1（SQLite + FTS5） |
| 文件存储 | Cloudflare R2 |

前端直接与 Worker API（`https://memo-worker.ausz.workers.dev`）通信，每个请求都通过 `?t=` 查询参数携带的 token 鉴权。Worker 与前端是**独立部署**的两个部分 —— 详见[部署](#部署)。

---

## 功能

### 首页
- **网格 / 列表视图**切换，跨会话保持
- **标签筛选栏**，显示每个标签的数量 —— 标签不区分大小写（统一存为小写）
- **全文搜索**，覆盖标题、描述、笔记、标签、UID、文件名、说明文字和剪藏内容（基于 FTS5）
- 右侧边缘的**时间轴滑块**（网格视图下）—— 拖动即可按日期跳转
- **排序**：最新 / 最旧 / 最近更新；置顶备忘录始终排在最前
- **复制备忘录** —— 复制全部元数据和文件，生成一份新备忘录
- **回收站** —— 软删除、恢复、永久删除（同时清除 R2 中的对象）、清空回收站
- **存储用量指示器** —— 显示 R2 总用量，对比一个仅作展示用的 10 GB 标签（并非强制配额）
- **⟳ 重建索引** —— 在数据库结构变更后重建 FTS5 搜索索引
- **iOS 快捷指令设置** —— 内置指南，提供 Worker 地址、token 和备忘录 ID，方便配置 Shortcuts 自动化（见 [iOS 快捷指令快速捕获](#ios-快捷指令快速捕获)）

### 备忘录详情页 —— 笔记
富文本笔记编辑器（`contenteditable`，基于 `document.execCommand`），停止输入 2 秒后或失焦时自动保存（⌘S 也可手动保存）。工具栏包含：
- 文字样式（标题 / 副标题 / 正文）、加粗、斜体、下划线、删除线
- 字号加减、文字颜色选择器、高亮颜色（4 种预设 + 移除高亮）
- **Menlo 等宽字体**下拉菜单（11px / 12px / 默认）—— 将选中内容包裹为 Menlo 字体，适用于从终端 / 代码粘贴过来但丢失了原始格式的文本
- 无序 / 有序列表、分页符、增加 / 减少缩进、复选框任务、清空
- 粘贴的图片会以 base64 `data:` 图片形式直接内嵌到笔记中

### 备忘录详情页 —— 剪藏（Clips）
一个独立于主笔记的轻量捕获面板，在 R2 中以独立的 `_snippets` JSON 数组存储。点击 **📋 剪藏**，粘贴内容，填写标题：
- **自动保存**：停止输入 / 粘贴 1200 毫秒后自动保存，失焦或粘贴图片时立即保存 —— 无需记得手动点击保存
- **保存剪藏**按钮依然保留，作为明确的"确认并关闭"操作；**取消**会丢弃正在编辑的草稿
- 支持粘贴图片（同笔记一样以 base64 内嵌）
- 拥有自己独立的 **Menlo 等宽字体**工具栏（11px / 12px / 默认）
- 以可折叠卡片列表形式呈现，支持一键展开 / 折叠全部、行内改名、删除，以及"复制为纯文本"
- **导出剪藏为 .md** —— 将每条剪藏导出为独立的 Markdown 文件，打包为一个 `.zip`
- 也可以通过 [iOS 快捷指令快速捕获](#ios-快捷指令快速捕获)接口远程创建

> **关于粘贴保真度的说明**：无论是笔记还是剪藏，都从不对粘贴内容做任何清理 —— 系统剪贴板提供的 HTML 会被原样保留。字体 / 颜色 / 表格能否在粘贴后保留，完全取决于来源应用（例如 Warp 会将 AI 输出渲染为真正的 HTML 并完整保留这些信息；而 Terminal.app 以及大多数终端中的 Claude Code 会话，通常只会把纯文本放到剪贴板上）。上面提到的 Menlo 字体工具，就是在粘贴内容丢失样式时的一个手动补救手段。

### 备忘录详情页 —— 文件
- 支持拖拽上传、点击浏览、或**上传文件夹**（基于 `webkitdirectory` 的批量上传）
- 虚拟文件夹（本质是 key 前缀）—— 可新建、重命名、删除；可将文件拖入 / 拖出文件夹
- 网格 / 列表视图，可按名称 / 类型 / 日期 / 大小排序
- 支持图片 / 视频 / 音频 / PDF 的**灯箱预览**，可用键盘导航
- 每个文件可单独设置**说明文字和标签**（会计入全文搜索）
- 每个文件均支持软删除（回收站 → 恢复或永久删除）
- **多选批量操作**：打标签、移动、删除、下载（打包为 zip）
- 上传进度条，支持取消；**单文件 100 MB 上限**，前端和服务端均会强制执行（对应 Cloudflare 免费套餐的 R2 上限）

### 备忘录详情页 —— 备忘录信息及其他工具
- UID、标签（自动补全所有已存在标签）、链接（标签 + URL）、创建日期、封面图选择器 —— 均自动保存
- 若未设置封面图，会**自动使用第一张上传的图片**作为封面
- **二维码标签** —— 可打印的标签，包含二维码（通过 `api.qrserver.com` 生成）、备忘录 ID 和 UID
- **将笔记导出为独立 HTML** —— 生成一份自包含、带样式的 HTML 文档，包含标题 / 描述 / 链接 / 剪藏 / 文件
- **将笔记发送给自己** —— 通过 [Resend](https://resend.com) 发送邮件，并附带完整的 HTML 导出文件
- **添加到 Google 日历** —— 深度链接跳转到 `calendar.google.com`，预填备忘录的标题 / 笔记内容；支持分别设置"电话"和"短信"两个不同的日历 ID，保存在 `settings` 表中

### 分享页
公开、无需登录的只读页面，地址为 `/share?token={share_token}`（在备忘录详情页生成 / 撤销分享链接）。展示封面、标题 / 描述 / 标签、笔记内容、剪藏（只读，可折叠）以及文件列表（拥有独立的灯箱和下载链接）。

### 深色模式
通过右下角悬浮按钮切换，保存在 `localStorage` 中。全部主题样式均基于 CSS 自定义属性实现。

### iOS 快捷指令快速捕获
两个需要鉴权的 Worker 接口，让 Shortcuts.app 自动化流程可以直接将内容推送进某个备忘录：
- `POST /quick-capture` —— JSON 请求体，`type: "text"` 会创建一条新剪藏，`type: "image"|"file"` 会上传一个 base64 编码的文件
- `POST /quick-capture-file` —— 原始二进制请求体上传（无需 base64 编码开销），用于 iOS 分享面板

---

## 数据模型

### D1 —— `memos` 表（当前运行时结构，见 `src/db/schema.ts`）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT 主键 | UUID |
| `memo_id` | TEXT 唯一 | 格式为 `YYYYMMDD-XXXXXXX` |
| `uid` | TEXT | 可选的人类可读标识符，如 `STOR-001` |
| `title` | TEXT | |
| `description` | TEXT | |
| `cover_file` | TEXT | 相对于备忘录前缀的 R2 key |
| `tags` | TEXT | JSON 数组，全部小写 |
| `pinned` | INTEGER | 0 或 1 |
| `links` | TEXT | `{label, url}` 组成的 JSON 数组 |
| `search_text` | TEXT | 去范式化后的搜索索引文本 |
| `share_token` | TEXT | 可为空 —— 生成公开分享链接时写入 |
| `deleted_at` | TEXT | 软删除标记 —— 未删除时为 NULL |
| `created_at` | TEXT | ISO 8601 格式 |
| `updated_at` | TEXT | ISO 8601 格式 |

### D1 —— `settings` 表

| 列 | 类型 | 说明 |
|---|---|---|
| `key` | TEXT 主键 | 例如 `gcal_call_id`、`gcal_sms_id` |
| `value` | TEXT | |

此外还有一个 `memos_fts` FTS5 虚拟表及其同步触发器，通过原生 SQL 管理（详见 `schema.sql` 及 `POST /search/rebuild`）—— Drizzle 不支持虚拟表，因此这部分是手写的，独立于 `drizzle/` 目录下的 migration 文件之外。

`schema.sql` 是一个完整的从零搭建脚本（会先删除再重建所有表），需要手动与 `src/db/schema.ts` 保持同步；`drizzle/` 目录则为使用 `drizzle-kit migrate` 的场景保留了增量式的 migration 历史记录。目前两者描述的是同一个最终状态 —— 如果给 `schema.ts` 新增了列，请同时更新这两处。

### R2 —— 每个备忘录下的 key（前缀为 `memo-{uuid}/`）

| Key | 内容 |
|---|---|
| `filename` 或 `folder/filename` | 已上传的文件 |
| `_note` | 富文本笔记的 HTML |
| `_meta` | JSON：`{ files: {key: {caption, tags}}, folders: [], trash: [...] }` |
| `_snippets` | 剪藏的 JSON 数组：`[{id, title, content, created_at}]` |
| `_trash/filename` | 已软删除的文件 |

---

## 部署

本应用有**两个独立部署的部分**——请不要混淆二者。

### 前端（Cloudflare Pages）

推送到 `main` 分支——GitHub Actions（`.github/workflows/deploy-pages.yml`）会自动构建并部署。

- 触发条件：`src/**`、`static/**`、`svelte.config.js`、`vite.config.ts`、`package.json`、`package-lock.json` 发生变更
- 执行 `npm ci && npm run build`，然后运行 `wrangler pages deploy .svelte-kit/cloudflare --project-name=memo-frontend`

所需的 GitHub secrets：

| Secret | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 拥有 Cloudflare Pages 编辑权限的 API token |
| `CLOUDFLARE_ACCOUNT_ID` | 你的 Cloudflare 账户 ID |

### Worker

**Worker 没有 CI 自动部署流程**——需要手动部署：

```sh
sh deploy.sh
```

该脚本会用 esbuild 打包 `worker.ts`，将打包产物连同 `wrangler.toml` 一起复制到一个临时目录，再从该临时目录执行 `wrangler deploy`。

> **切勿直接在仓库根目录运行 `wrangler deploy`。** `wrangler.jsonc`（由 `@sveltejs/adapter-cloudflare` 为 Pages 构建自动生成）没有配置 D1/R2 绑定 —— 如果 wrangler 读取到的是这个文件而不是 `wrangler.toml`，就会部署出一个无法访问数据库的、损坏的 worker。`deploy.sh` 存在的意义正是为了避免这个问题。

### 数据库结构

首次搭建时执行一次，将结构应用到 D1：

```sh
wrangler d1 execute memo-db --file=schema.sql
```

该脚本会一次性创建两张表（`memos`、`settings`）以及 FTS5 索引和触发器。

部署了包含数据库结构变更的 worker 后，请在首页点击 **⟳ 重建索引**，重建 FTS5 搜索索引。

---

## 测试

两套独立的测试套件，分别对应本应用独立部署的两个部分：

```sh
npm test          # worker —— 使用 Vitest + @cloudflare/vitest-pool-workers，在真实的 workerd
                   # 运行时中通过 Miniflare 针对真实的 D1/R2 绑定运行。完全本地化，不会触碰生产环境。
npm run test:e2e   # 前端 —— 使用 Playwright，驱动真实的 Chromium 浏览器，针对生产构建
                    # （npm run build && preview）运行。所有发往 Worker 的请求都会被拦截并
                    # mock（详见 test-e2e/helpers.ts），因此同样不会触碰生产环境。
```

两者都只是冒烟级别的覆盖（鉴权、核心增删改查、两个编辑器的自动保存行为），并非详尽覆盖 —— 文件上传 / 灯箱 / 分享页 / 邮件 / 日历 / iOS 快速捕获目前尚无测试覆盖。

---

## 鉴权

一个共享密码保护除 `/share/*` 之外的所有路由。在 Cloudflare 控制台中将其设置为 Worker secret：

**Workers & Pages → memo-worker → Settings → Variables and Secrets → `MEMO_AUTH_TOKEN`**

该 token 会以 `?t={token}` 的形式附加在每一次 API 请求上，并保存在前端的 `localStorage` 中。任何接口返回 `401` 都会清除已保存的 token 并重新提示输入。

邮件相关配置（`OWNER_EMAIL`、`RESEND_API_KEY`、`RESEND_FROM`）也是以同样的方式配置的 —— 作为 Worker secrets，而非通过任何设置界面。目前没有专门的设置页面；`settings` 这张 D1 表目前仅被用于存储两个 Google 日历 ID。

---

## Cloudflare 资源

| 资源 | 名称 | ID |
|---|---|---|
| Worker | `memo-worker` | — |
| Worker 地址 | `memo-worker.ausz.workers.dev` | — |
| Pages 项目 | `memo-frontend` | — |
| D1 数据库 | `memo-db` | `2554e206-c3d9-45a9-a5b6-96e06e428e1d` |
| R2 存储桶 | `memo-files` | — |

---

## 已知遗留问题

- 首页显示的 10 GB 存储用量数字只是一个展示用的标签，并非强制配额。
