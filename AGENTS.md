## AGENTS.md -- TabOut: 编码助手安装与配置指南

你正在为安装 **TabOut** 的用户提供帮助。你的工作不仅仅是完成技术设置——还要让他们对使用它感到兴奋。

---

## 第 0 步 -- 介绍产品

在做任何技术操作之前，先告诉用户他们即将获得什么：

> **TabOut** 将你的新标签页替换为一个干净的仪表盘，展示你所有打开的标签页，按域名分组。
> 它的亮点：
> - **一眼看清所有标签页** 按域名分组展示在网格中
> - **🧭 Nav List 导航列表** 快速访问常用网站
> - **🎨 自定义 Logo** 支持自定义品牌标识
> - **🏠 默认页为 TabOut** 打开新标签页直接进入仪表盘
> - **主页分组** Gmail、X、LinkedIn、YouTube、GitHub 等主页单独归为一组，方便清理
> - **关闭标签页带特效** 令人满足的 swoosh 音效 + 彩纸特效
> - **重复检测** 标记重复打开的标签页
> - **点击任意标签页标题即可跳转** 甚至跨 Chrome 窗口
> - **稍后保存** 将标签页加入书签清单，关闭前保存
> - **100% 本地** 无服务器，无账号，无数据发送
> 它只是一个 Chrome 扩展。设置大约需要 1 分钟。

---

## 第 1 步 -- 克隆仓库

```bash
git clone https://github.com/EvanTop/TabOut.git
cd TabOut
```

---

## 第 2 步 -- 安装 Chrome 扩展

这是唯一需要用户手动操作的步骤。请尽可能简化。

**首先**，打印 `extension/` 文件夹的完整路径：

```bash
echo "Extension folder: $(cd extension && pwd)"
```

**然后**，将路径复制到剪贴板：

- macOS: `cd extension && pwd | pbcopy && echo "Path copied to clipboard"`
- Linux: `cd extension && pwd | xclip -selection clipboard 2>/dev/null || echo "Path: $(pwd)"`
- Windows: `cd extension && echo %CD% | clip`

**然后**，打开扩展页面：

```bash
open "chrome://extensions"
```

**然后**，一步步引导用户：

> 我已将扩展文件夹路径复制到你的剪贴板。现在：
> 1. 你应该能看到 Chrome 的扩展页面。在**右上角**，开启 **开发者模式**（一个开关）。
> 2. 开启开发者模式后，左上角会出现 **"加载已解压的扩展程序"** 按钮。点击它。
> 3. 文件选择器将打开。按 **Cmd+Shift+G**（Mac）或 **Ctrl+L**（Windows/Linux）打开"前往文件夹"栏，然后**粘贴**我复制的路径（Cmd+V / Ctrl+V），按回车。
> 4. 点击 **"选择"** 或 **"打开"**，扩展将安装。
> 你应该能在扩展列表中看到 "TabOut"。

**同时**，直接打开文件浏览器作为备用：

- macOS: `open extension/`
- Linux: `xdg-open extension/`
- Windows: `explorer extension\`

---

## 第 3 步 -- 功能导览

扩展加载完成后：

> 一切就绪！打开一个**新标签页**，你将看到 TabOut。
> 使用方法：
> 1. **你的打开标签页按域名分组** 以网格布局展示。
> 2. **主页**（Gmail 收件箱、X 主页、YouTube 等）在顶部单独分组。
> 3. **🧭 Nav List** 导航列表提供常用网站的快捷入口。
> 4. **🎨 自定义 Logo** 在页面顶部展示你的品牌标识。
> 5. **点击任意标签页标题** 直接跳转到该标签页。
> 6. **点击 X** 关闭单个标签页（伴随 swoosh + 彩纸）。
> 7. **点击 "关闭全部 N 个标签页"** 关闭整个分组。
> 8. **重复标签页** 以琥珀色 "(2x)" 标记。点击 "关闭重复" 保留一个。
> 9. **稍后保存** 点击书签图标将标签页加入清单。保存的标签页显示在侧边栏。
> 就这样！无需运行服务器，无需配置文件。一切开箱即用。

---

## 关键信息

- TabOut 是纯 Chrome 扩展。无服务器，无 Node.js，无 npm。
- 保存的标签页存储在 `chrome.storage.local` 中（跨会话持久化）。
- 100% 本地。无数据发送到任何外部服务。
- 更新方式：`cd TabOut && git pull`，然后在 `chrome://extensions` 中重新加载扩展。
- 新增功能：Nav List 导航列表、自定义 Logo、默认页为 TabOut。
