# 重构工程笔记

本文件记录**实测得出**的结论。凡是标了「实测」的，都跑过真实浏览器验证，不是从规范推断的。
重构过程中若与这些结论冲突，以本文件为准并重新实测。

---

## 1. 加载顺序：ES module 与 classic `defer` 的相对次序【实测】

`desktop.html` 的脚本区（`:3278-3300`）是手工排的 `defer` 链，且 `tauri/tauri_api.js:82-83`
在**解析期**就调用 `updateAboutAppEntrypoints()` —— 这只在 `desktop.js` 排在它前面时才成立。
转 ES 模块后这个保证还成不成立，实测结果：

| 场景 | 结果 |
|---|---|
| `<script type="module">` 在前（模块图 5 层深）、classic `defer` 在后 | **模块图全部求值完毕**后才轮到 classic defer ✅ |
| 同上，但 module 里有**顶层 await** | **classic defer 抢先执行**，全局尚未装上 ❌ |
| classic `defer` 排在 module 标签之前 | classic 抢先执行 ❌ |

**由此得出的三条硬规则：**
1. `<script type="module" src="src/main.js">` 必须排在 `tauri/*.js` **之前**
2. **模块图里绝对不能出现顶层 `await`** —— 它会静默破坏顺序保证，且只在桌面版(Tauri)才看得出后果
3. 仍然要把 `tauri_api.js:82-83` 的解析期调用移进 `boot.js`，让正确性不依赖于第 1 条

复现用例保存在 `tools/regress/` 的开发记录中（`ordertest`），可随时重跑。

---

## 2. 哪些全局真的在 `window` 上【实测 + 静态分析】

**classic script 里顶层的 `const`/`let` 只进全局词法环境，不会成为 `window` 的属性**，
只有 `function` 和 `var` 会。这一点直接影响 `globals.js` 的写法，也影响任何测试代码。

在 71 个「必须保持全局」的名字里：

- **47 个已经在 `window` 上**（`function` / `var`）：
  `openapp` `showcm` `shownotice` `showwin` `hidewin` `maxwin` `minwin` `focwin` `stop`
  `toggletheme` `saveDesktop` `setIcon` `runcmd` `resizewin` `taskbarclick` `sys_setting`
  `topmost` `run_cmd` `wifiStatus` `voiceBall` `news` … 等

- **25 个只在词法环境、不在 `window` 上**（`const` / `let`）：
  `apps` `page` `nts` `cms` `dps` `icon` `setData` `widgets` `m_tab` `taskmgrTasks` `langc`
  `date` `server` `pages` `nomax` `copilot` `isDark` `autoUpdate` `font_window` `edit_mode`
  `deltaLeft` `start` `wait` `padding` `cell` `cols` `rows`

内联 handler 两种都能访问（bare 标识符在没有词法绑定时会落到 `window` 属性上），
所以 barrel 统一用 `window.X = X` 是安全的。
但**测试代码不能写 `window.cms`**，必须走间接 eval（见 `tools/regress/determinism.mjs` 的 `__g()`）。

---

## 3. `globals.js` 需要 accessor 的只有 4 个【静态分析，已人工核对】

模块的 `window.X = X` 是**值拷贝**。如果这个绑定之后会被重新赋值，就会 split-brain：
模块内改了，`window.X` 还是旧值；内联 handler 改了 `window.X`，模块内的绑定还是旧值。

扫描「在属主文件之外被赋值」的全局，初筛出 6 个，人工核对后 **3 个是误报**：

| 名字 | 判定 |
|---|---|
| `icon` | ❌ 误报 —— `apps.js:1482` 是**默认参数** `icon = ''` |
| `date` | ❌ 误报 —— `apps.js:1814` 是**局部 `const` 声明** |
| `deltaLeft`(desktop.js) | ❌ 误报 —— `desktop.js:2587` 是**局部 `let`**，遮蔽了同名全局 |
| **`run_cmd`** | ✅ 真外部写 —— `module/apps.js:163` |
| **`autoUpdate`** | ✅ 真外部写 —— `desktop.html:1656` 内联 handler |
| **`font_window`** | ✅ 真外部写 —— `desktop.html:2139`、`:2217` 内联 handler |
| **`deltaLeft`**(真) | ✅ 真外部写 —— `module/tab.js:22,25`、`module/widget.js:210` |

**结论：`globals.js` 里只有 `run_cmd`、`autoUpdate`、`font_window`、`deltaLeft` 需要
`Object.defineProperty` 的 get/set 转发；其余 67 个直接值赋值即可。**

---

## 4. 回归套件【已自测】

`tools/regress/` —— 用 DOM / `page.evaluate` 断言，**不用截图**（本机截图不可靠）。

```bash
node tools/regress/run.mjs --save baseline-v1   # 采集当前树为命名基线
node tools/regress/run.mjs --against baseline-v1 # 与命名基线对比
node tools/regress/run.mjs                       # 与 ../win12-baseline 工作树对比
```

单次采集约 55s/locale，跑 zh-CN 与 en 两个 locale。

**已完成的两项自测：**
1. **确定性**：两棵内容等价的工作树、两个 locale → **0 处差异**。
   （靠 `determinism.mjs` 冻结 `Date`/`Math.random`/`performance.now`，并拦截 12 个非确定性外部 API 主机）
2. **灵敏度**：故意注入两个回归 → 全部捕获，共 20 处差异：
   - 改 `--href` 设计变量 → `computedStyles.__customProps.--href` 命中
   - 把 `toggletheme` 改名 → 三路独立命中：
     - `shell.themeThrew: TypeError`
     - `shell.theme.mid`（dark 类没加上）
     - **`contextMenus.desktop.handlerErrors[0]: 未定义的全局 toggletheme()`**

第三条尤其关键：右键菜单的 HTML **渲染得一模一样**，只有 handler 里引用的名字没了。
只比对渲染结果的话会漏掉——这正是 C1（内联 handler 只认全局）的典型失败模式。

---

## 5. 已知的基线噪音

采集时有 4 条控制台错误，**基线与重构版完全相同**，属预期：
- `获取 star 数量时出错: TypeError: Failed to fetch` —— `api.github.com` 被拦截
- `ReferenceError: loadPyodide is not defined` —— `unpkg.com` 的 Pyodide 被拦截（数 MB，且只有 python 应用用得到）

阶段 1 之前，以下 3 条关闭路径在基线上**确定会抛 TypeError**（`openapp` 用 camelCase 而
`hidewin` 用原名，`apps['code-editor']` / `apps['camera-notice']` 是 `undefined`）：
`hidewin('code-editor')` @ `apps.js:2186`、`hidewin('camera-notice')` @ `desktop.html:2511,2532`。
阶段 1 修好后要求这三条干净，届时重采 `baseline-v2`。

---

## 6. 工作目录

- 基线工作树：`../win12-baseline`（`git worktree`，checkout 在 `main`）
- `~/Documents` 是本地目录，**不走 iCloud**，无同步抖动风险
- 仓库里有 41 个零字节的 `"* 2.*"` 文件，创建时间 2026-05-08，**早于本次 clone 三个月**，
  未被 git 跟踪，与本次重构无关
