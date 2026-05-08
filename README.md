# TabOut

> 🚀 基于 [tab-out](https://github.com/zarazhangrui/tab-out) 的二次创作版本，新增多项实用功能。

**TabOut** 是一个 Chrome 扩展，它将你的新标签页替换为所有打开标签页的仪表盘。让这个仪表盘可以设置为起始页，同时里面还能收藏网址，也保留的原有的功能！一举三得！

无服务器。无需账号。无外部 API 调用。纯 Chrome 扩展。

**如果对你有用，记得给个星星✨✨✨**

---

## ✨ 新增功能（二创版）

| 功能 | 说明 |
|------|------|
| **🧭 Nav List** | 新增导航列表，快速访问常用网站 |
| **🎨 自定义 Logo** | 支持自定义品牌标识和 Logo |
| **🏠 默认页为 TabOut** | 打开新标签页时，默认直接显示 TabOut 仪表盘 |
| **📊 域名分组** | 标签页按域名自动分组，一目了然 |
| **🏠 主页分组** | Gmail、X、YouTube、LinkedIn、GitHub 等主页单独归为一组 |
| **🎉 关闭特效** | 关闭标签页时带有 swoosh 音效 + 彩纸特效 |
| **🔍 重复检测** | 检测重复打开的标签页，一键清理 |
| **📌 稍后保存** | 将标签页加入书签清单，稍后处理 |
| **🔧 Localhost 分组** | 显示端口号，方便区分本地开发项目 |
| **🔒 100% 本地** | 数据永不离开你的设备 |

---

## 📦 安装

### 方式一：使用编码助手（推荐）

将你的编码助手（Claude Code、Codex 等）发送此仓库链接，并说 **"install this"**：

```
https://github.com/EvanTop/TabOut
```

助手会引导你完成安装，大约 1 分钟。

### 方式二：手动安装

**1. 克隆仓库**

```bash
git clone https://github.com/EvanTop/TabOut.git
cd TabOut
```

**2. 加载 Chrome 扩展**

1. 打开 Chrome，进入 `chrome://extensions`
2. 开启右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择仓库中的 `extension/` 文件夹

**3. 打开新标签页**

TabOut 将自动显示。

---

## 🎯 如何使用

```
你打开一个新标签页
  -> TabOut 展示你所有打开的标签页，按域名分组
  -> 主页（Gmail、X 等）在顶部单独分组
  -> 点击任意标签页标题即可跳转
  -> 关闭不再需要的分组（伴随音效 + 彩纸）
  -> 将标签页保存到"稍后处理"清单
```

一切运行在 Chrome 扩展内部。无外部服务器，无 API 调用，无数据发送。保存的标签页存储在 `chrome.storage.local` 中。

---

## 🛠 技术栈

| 项目 | 技术 |
|------|------|
| 扩展 | Chrome Manifest V3 |
| 存储 | chrome.storage.local |
| 音效 | Web Audio API（合成音效，无文件） |
| 动画 | CSS 过渡 + JS 彩纸粒子 |

---

## 📁 项目结构

```
TabOut/
├── extension/           # Chrome 扩展主目录
│   ├── manifest.json    # 扩展清单
│   ├── newtab.html      # 新标签页 HTML
│   ├── newtab.css       # 样式文件
│   ├── newtab.js        # 主逻辑脚本
│   ├── background.js    # 后台脚本
│   ├── icons/           # 扩展图标
│   └── ...
├── README.md            # 项目说明
├── AGENTS.md            # 编码助手安装指南
├── LICENSE              # MIT 许可证
└── .gitignore           # Git 忽略文件
```

---

## 🙏 致谢

本项目基于 [Zara](https://github.com/zarazhangrui) 的 [tab-out](https://github.com/zarazhangrui/tab-out) 进行二次创作，感谢原作者的出色工作！

---

## 📄 许可证

MIT License

---

**Built by [Evan](https://evan.xin)**


