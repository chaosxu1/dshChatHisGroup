# dshChatHisGroup · 历史会话分组

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）Web 界面加一个**「历史会话」页签**：在会话页签行（`对话 / 轨迹 / 上下文 / 编队` 之后）点开，就在右侧主区域看到全部历史会话，可按工作区 / 时间 / 自定义分组浏览，点任意一条直接进入那条会话。

纯浏览器侧插件：不新增 Host 服务、不写 DOM、不追加会话事件。

## 功能

**入口**：打开任意会话，页签行最右侧的「历史会话」。

**三种分组方式**（工具条切换，选择会被记住）：

| 分组方式 | 说明 |
| --- | --- |
| 按工作区（默认） | 按工作区成组，组内按最近活动排序；不属于任何工作区的会话归入「未分组」 |
| 按时间 | 今天 / 昨天 / 近 7 天 / 近 30 天 / 更早 |
| 按分组 | 自己命名分组，把会话移进去；没归组的进「未分组」 |

**按分组页的操作**

- `＋ 新建分组` → 输入名称回车创建（仅「按分组」页有此按钮）
- 分组标题右侧悬停出现 `重命名` / `删除`（删除会二次确认，组内会话回到「未分组」）
- 会话行右侧悬停出现「移动到分组」图标：**三种分组方式下都有**，可以把正在看的会话直接归类；菜单里还能 `新建分组并移入`，所以一个分组都没有时也不会点开无解
- 归类后，非「按分组」页会给 2.6 秒的操作提示（如「已移入「笔记工程」」）；在「按分组」页里会话行会立刻跳到目标组，不再额外提示

**分组标签与筛选**

- 在「按时间」「按工作区」页，已归类的会话行尾会显示所属分组的小标签；**点这个标签** → 跳到「按分组」页，只保留这一组的会话（其他组和未分类的都过滤掉），并自动展开这一组
- 「按分组」页工具条有 `全部分组` 下拉，可按组名过滤会话；选中某个分组时会自动展开它；手动切换分组方式时筛选自动清空，避免切回来只剩一组
- 分组方式的当前项用**蓝色文字 + 蓝色下划线**标示，未选中为三级灰度文字（token、线高、圆角、内缩都与上方页签一致）

**其他**

- 搜索框：即时按会话标题、工作区名过滤
- `显示已归档`：默认隐藏已归档会话；勾选后以灰色显示并标「已归档」，不可点击打开（与侧栏行为一致）
- 折叠：点分组标题折叠/展开，折叠状态与分组方式一起保存在浏览器本地
- 点击一行：打开该会话；若目标会话上次也停在「历史会话」页签，会自动切回「对话」

## 数据与边界

- 数据全部来自框架已投影好的两份快照：会话目录（`useSessions`）与工作区快照（`useWorkspaces`，含置顶 / 归档集合）。本插件**不订阅会话事件、不写 DOM、不追加任何会话事件**。
- 与侧栏一致的可见性口径：隐藏子代理来源的会话、隐藏未开始的空白会话。
- 没有 Host 侧服务、工具或命令；`index.js` 是空实现的 Host 半边。
- 分组定义、折叠状态存在浏览器 `localStorage` 的 `dsh.session-history.view.v1`（仅本机本浏览器；不写会话日志）。

## 安装

用 dsh 的 `plugin_manager` 安装，**不要手改 profile 的 `package.json` / `cordis.patch.yml`**。

### 方式 A：从目录安装（link，适合长期跟进）

```powershell
git clone https://github.com/chaosxu1/dshChatHisGroup.git
```

```
plugin_manager → install_bundle
target = <克隆目录的绝对路径>
```

pnpm 记成 `link:` 依赖，之后改 `client.js` 只需刷新页面（F5）即可生效。

### 方式 B：打包成 tgz 再装（拷贝，适合固定版本）

```powershell
cd dshChatHisGroup
npm pack
```

```
plugin_manager → install_bundle
target = <克隆目录>\dsh-session-history-1.0.0.tgz
```

用 tgz 装是**实体拷贝**，装完与源码目录无关，源码目录移动或删除都不影响已装好的插件。

### 升级与坑

- **版本号不变时 pnpm 可能沿用 `node_modules` 里已有的旧条目**（表现为该目录仍是指向源码的 junction，等于没重装）。规矩是：先 `remove_bundle`，再 `install_bundle`；或改版本号后重新打包。装完可以核对 `node_modules/dsh-session-history` 是否为实体目录（`Get-Item … | Select LinkType` 为空）
- 停用：在 profile 的 `cordis.patch.yml`（最后一个 patch 层）里按 id 关闭，重启 dsh：
  ```yaml
  - id: session-history
    disabled: true
  ```
- 彻底卸载：`plugin_manager → remove_bundle`，目标 `dsh-session-history`

## 目录结构

```
package.json        包清单：bundle patch + dsh.client（浏览器半边）+ 测试脚本
cordis.patch.yml    bundle patch：插入 id 为 session-history 的一行
index.js            Host 半边（空实现）
client.js           浏览器半边：注册 conversation.view 页签 + 页面本身
locale/{zh,en}.json 插件市场里的标题与描述
icon.svg            插件图标（原创）
test/smoke.cjs      渲染/交互冒烟测试（假 React，无需浏览器）
```

## 测试

```powershell
npm test
```

不依赖浏览器和 React 安装：脚本用一个极简 React 假实现调用真实组件函数，并对控件的 `onChange` / `onClick` 做状态重放，断言分组、筛选、自动展开、下划线样式等 15 组用例。

## 兼容性与适配点

依赖的框架接口只有四处，dsh 大版本升级后若其中任何一处变化，只需改 `client.js`：

- 槽位 `conversation.view`（注册页签；`id = history`、`order = 40`）
- 标准 props `useSessions`（会话目录）、`useWorkspaces`（工作区 / 置顶 / 归档集合）
- 宿主 props `sessionId` 与 `openView`（打开会话后切回「对话」页签）
- 客户端服务 `ctx.uiWorkspace.openSession`（打开指定会话）

`package.json` 的 `dsh.engines.dsh` 目前为 `>=0.2.1-rc.3`，不设上限。若某次升级后页签不再出现（`conversation.view` 下没有 `history` 注册），按上面四处对照新版本的类型声明，改完重新打包安装即可。

## 已知限制

- 视觉表现只在浅色主题 + 常规窗口宽度下确认过；深色主题、极窄窗口的排版未逐一验证
- 分组是**浏览器本地**数据，不跟随会话日志同步到其他机器或浏览器
- 会话只能归档、不能删除，因此本插件也不提供删除入口

## 许可

MIT
