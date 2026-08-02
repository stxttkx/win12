// 采集一棵工作树的完整行为快照。
// 原则：一律用 DOM / page.evaluate 断言，不用截图（本机截图不可靠）。
import { determinismScript, shouldBlock } from './determinism.mjs';

const BOOT_TIMEOUT = 45000;

/** 计算样式快照要比对的选择器 —— 覆盖 shell 各区域 + 窗口各状态 + 共享组件 */
const STYLE_SELECTORS = [
    ':root', 'body', '#dock-box', '#taskbar', '#toolbar', '#start-btn', '#search-btn',
    '#start-menu', '#startmenu-l', '#startmenu-r', '#search-win', '#widgets', '#control',
    '#datebox', '#copilot', '#desktop', '#cm', '#dp', '#descp', '#notice-back', '#notice',
    '#window-fill', '#open-dock', '#loadback', '#voiceBall', '#desktop-widgets',
    '.window.calc', '.window.calc>.titbar', '.window.calc>.content',
    '.window.explorer', '.window.explorer>.titbar', '.window.setting', '.window.taskmgr',
    '.window.about', '.window.notepad', '.window.terminal', '.window.edge', '.window.word',
    '.window.defender', '.window.msstore', '.window.whiteboard', '.window.vscode',
    '.window.calc>.titbar>div>.wbtg', '.window.calc>.loadback',
];

const STYLE_PROPS = [
    'display', 'position', 'width', 'height', 'top', 'left', 'right', 'bottom',
    'color', 'background-color', 'background-image', 'border-radius', 'border',
    'box-shadow', 'opacity', 'transform', 'transition', 'z-index', 'overflow',
    'font-family', 'font-size', 'font-weight', 'line-height', 'padding', 'margin',
    'flex-direction', 'align-items', 'justify-content', 'gap', 'backdrop-filter',
];

export async function preparePage(browser, { locale }) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (shouldBlock(req.url())) req.abort('blockedbyclient').catch(() => {});
        else req.continue().catch(() => {});
    });
    await page.evaluateOnNewDocument(determinismScript());
    await page.evaluateOnNewDocument(`try { localStorage.setItem('lang', ${JSON.stringify(locale)}); } catch (e) {}`);
    return page;
}

async function bootDesktop(page, origin) {
    // ?develop 跳过 service worker 注册，避免缓存干扰
    await page.goto(`${origin}/desktop.html?develop`, { waitUntil: 'load', timeout: BOOT_TIMEOUT });
    await page.waitForFunction(
        () => typeof window.openapp === 'function'
            && document.querySelectorAll('.window').length > 0
            && document.querySelector('#desktop')
            && getComputedStyle(document.querySelector('#loadback')).display === 'none',
        { timeout: BOOT_TIMEOUT, polling: 100 }
    );
    await settle(page, 400);
}

const settle = (page, ms) => page.evaluate(d => new Promise(r => setTimeout(r, d)), ms);

/** 关掉过渡动画，让几何测量稳定；两侧注入完全一致 */
const freezeTransitions = page => page.evaluate(() => document.documentElement.classList.add('notrans'));
const thawTransitions = page => page.evaluate(() => document.documentElement.classList.remove('notrans'));

// ---------------------------------------------------------------- 采集步骤

/** 启动结构：窗口数量、id、class 顺序、拖拽下标配对对齐（C2 / C3） */
const captureBootStructure = page => page.evaluate(() => {
    const wins = [...document.querySelectorAll('.window')];
    const titbars = [...document.querySelectorAll('.window>.titbar')];
    return {
        windowCount: wins.length,
        // classList[1] 就是 app id —— 这是承重墙，顺序错一个全盘皆错
        windowIds: wins.map(w => w.classList[1]),
        windowClassLists: wins.map(w => [...w.classList].join(' ')),
        titbarCount: titbars.length,
        // 下标配对是否对齐：titbars[i] 必须是 wins[i] 的直接子元素
        titbarPairingAligned: wins.every((w, i) => titbars[i] && titbars[i].parentElement === w),
        titbarPairingMismatches: wins.map((w, i) =>
            (titbars[i] && titbars[i].parentElement === w) ? null : `#${i} ${w.classList[1]}`
        ).filter(Boolean),
        shellRegionIds: [...document.body.children].map(e => e.id || `.${e.className}`).filter(Boolean),
        htmlClass: document.documentElement.className,
        i18nApplied: (() => {
            const el = document.querySelector('[data-i18n="setting.name"]');
            return el ? el.textContent.trim() : null;
        })(),
        i18nUntranslatedKeys: [...document.querySelectorAll('[data-i18n]')]
            .filter(e => /^\[[\w.\-]+\]$/.test(e.textContent.trim())).length,
    };
});

/** 逐个应用：开 → 断言 → 最大化 → 还原 → 最小化 → 还原 → 关闭 */
async function captureApps(page) {
    const ids = await page.evaluate(() =>
        [...document.querySelectorAll('.window')].map(w => w.classList[1])
    );
    const result = {};
    for (const id of ids) {
        result[id] = await page.evaluate(async (appId) => {
            const errBefore = window.__errors.length;
            const q = () => document.querySelector('.window.' + CSS.escape(appId));
            const snap = el => {
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return {
                    classes: [...el.classList].join(' '),
                    display: getComputedStyle(el).display,
                    rect: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) },
                };
            };
            const wait = ms => new Promise(r => setTimeout(r, ms));
            const out = { camel: appId.replace(/-(\w)/g, (_, c) => c.toUpperCase()) };
            const APPS = window.__g('apps');           // apps 是 let，不在 window 上
            out.hasAppObject = !!(APPS && APPS[out.camel]);
            out.hasInit = !!(APPS && APPS[out.camel] && APPS[out.camel].init);
            // hidewin 用的是原名而非 camel —— 这正是已知 bug 的来源，一并记录
            out.hasAppObjectByRawName = !!(APPS && APPS[appId]);

            try { window.openapp(appId); } catch (e) { out.openThrew = String(e); }
            await wait(250);
            out.afterOpen = snap(q());
            out.taskbarButton = !!document.querySelector('#taskbar>.' + CSS.escape(appId));
            out.focused = !!(q() && q().classList.contains('foc'));

            try { window.maxwin(appId); } catch (e) { out.maxThrew = String(e); }
            await wait(250);
            out.afterMax = snap(q());
            try { window.maxwin(appId); } catch (e) { out.unmaxThrew = String(e); }
            await wait(250);
            out.afterUnmax = snap(q());

            try { window.minwin(appId); } catch (e) { out.minThrew = String(e); }
            await wait(250);
            out.afterMin = snap(q());
            try { window.minwin(appId); } catch (e) { out.unminThrew = String(e); }
            await wait(250);
            out.afterUnmin = snap(q());

            try { window.hidewin(appId); } catch (e) { out.closeThrew = String(e); }
            await wait(250);
            out.afterClose = snap(q());
            out.taskbarButtonAfterClose = !!document.querySelector('#taskbar>.' + CSS.escape(appId));
            out.errors = window.__errors.slice(errBefore);
            return out;
        }, id);
    }
    return result;
}

/** 右键菜单：逐个渲染 + 逐个触发 handler。
 *  cms 的 payload 是「存成字符串的 JS」，只比对 HTML 抓不到全局被私有化的回归。 */
const captureContextMenus = page => page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    for (const id of Object.keys(window.__g('cms') || {})) {
        const errBefore = window.__errors.length;
        const rec = { rendered: null, itemCount: 0, handlerErrors: [] };
        try {
            const fakeEvent = { clientX: 400, clientY: 300, preventDefault() {}, stopPropagation() {}, target: document.body };
            window.showcm(fakeEvent, id, null);
            await wait(80);
            const cm = document.querySelector('#cm');
            rec.rendered = cm ? cm.innerHTML : null;
            const items = cm ? [...cm.querySelectorAll('a[onmousedown], a[onclick]')] : [];
            rec.itemCount = items.length;
            // 逐个执行 handler 源码，断言不抛异常（不真正点击，避免打开一堆窗口）
            for (const it of items) {
                const src = it.getAttribute('onmousedown') || it.getAttribute('onclick') || '';
                if (!src.trim()) continue;
                // 只做「引用的标识符是否可解析」检查：把函数体编译一次并静态取顶层调用名
                for (const name of new Set([...src.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]))) {
                    if (['if', 'for', 'while', 'switch', 'return', 'function', 'catch', 'typeof'].includes(name)) continue;
                    if (typeof window[name] === 'undefined') {
                        rec.handlerErrors.push(`${id}: 未定义的全局 ${name}() —— 来自 ${src.slice(0, 60)}`);
                    }
                }
            }
        } catch (e) { rec.handlerErrors.push('showcm threw: ' + String(e)); }
        try { document.querySelector('#cm').classList.remove('show', 'show-begin'); } catch {}
        rec.consoleErrors = window.__errors.slice(errBefore);
        out[id] = rec;
    }
    return out;
});

/** 通知/对话框：同上，逐个渲染 + 校验按钮 handler 引用的全局都还在 */
const captureNotices = page => page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    for (const id of Object.keys(window.__g('nts') || {})) {
        const errBefore = window.__errors.length;
        const rec = { rendered: null, buttons: 0, handlerErrors: [] };
        try {
            window.shownotice(id);
            await wait(80);
            const n = document.querySelector('#notice');
            rec.rendered = n ? n.innerHTML : null;
            const btns = n ? [...n.querySelectorAll('[onclick]')] : [];
            rec.buttons = btns.length;
            for (const b of btns) {
                const src = b.getAttribute('onclick') || '';
                for (const name of new Set([...src.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]))) {
                    if (['if', 'for', 'while', 'switch', 'return', 'function', 'catch', 'typeof'].includes(name)) continue;
                    if (typeof window[name] === 'undefined') {
                        rec.handlerErrors.push(`${id}: 未定义的全局 ${name}() —— 来自 ${src.slice(0, 60)}`);
                    }
                }
            }
            window.closenotice();
            await wait(60);
        } catch (e) { rec.handlerErrors.push('shownotice threw: ' + String(e)); }
        rec.consoleErrors = window.__errors.slice(errBefore);
        out[id] = rec;
    }
    return out;
});

/** shell 交互：开始菜单 / 搜索 / 小组件 / 控制中心 / 日期面板 / 主题 / 任务栏预览 */
const captureShellInteractions = page => page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const st = sel => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const cs = getComputedStyle(e);
        return { classes: e.className, display: cs.display, opacity: cs.opacity, transform: cs.transform };
    };
    const out = {};
    for (const [name, sel] of [['start-menu', '#start-menu'], ['search', '#search-win'],
                               ['widgets', '#widgets'], ['control', '#control'], ['datebox', '#datebox']]) {
        const errBefore = window.__errors.length;
        out[name] = { before: st(sel) };
        try { window.openDockWidget(name === 'start-menu' ? 'start-menu' : name); } catch (e) { out[name].openThrew = String(e); }
        await wait(300);
        out[name].after = st(sel);
        try { window.openDockWidget(name === 'start-menu' ? 'start-menu' : name); } catch (e) { out[name].closeThrew = String(e); }
        await wait(300);
        out[name].afterToggleBack = st(sel);
        out[name].errors = window.__errors.slice(errBefore);
    }
    // 主题切换来回一次，必须回到原状
    const themeBefore = document.documentElement.className;
    try { window.toggletheme(); } catch (e) { out.themeThrew = String(e); }
    await wait(300);
    const themeMid = document.documentElement.className;
    try { window.toggletheme(); } catch {}
    await wait(300);
    out.theme = { before: themeBefore, mid: themeMid, after: document.documentElement.className };
    return out;
});

const captureComputedStyles = (page, selectors, props) => page.evaluate((sels, ps) => {
    const out = {};
    for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) { out[sel] = null; continue; }
        const cs = getComputedStyle(el);
        const rec = {};
        for (const p of ps) rec[p] = cs.getPropertyValue(p);
        out[sel] = rec;
    }
    // 另外单独抓 :root 上的全部自定义属性（设计变量层的验收依据）
    const rootCS = getComputedStyle(document.documentElement);
    const vars = {};
    for (const name of ['--theme-1', '--theme-2', '--href', '--shadow', '--s3d', '--bgul', '--text', '--bg',
                        '--unfoc', '--foc', '--line', '--acrylic', '--icon', '--hover', '--active']) {
        const v = rootCS.getPropertyValue(name);
        if (v) vars[name] = v.trim();
    }
    out['__customProps'] = vars;
    return out;
}, selectors, props);

const captureStorage = page => page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
    }
    return { keys: Object.keys(out).sort(), values: out, writeOrder: window.__lsWrites };
});

// ---------------------------------------------------------------- 编排

export async function capture(browser, { origin, locale, label }) {
    const page = await preparePage(browser, { locale });
    const snap = { meta: { origin, locale, label } };

    await bootDesktop(page, origin);

    // Pass 1 —— 静止态计算样式（不冻结过渡，否则量不到 transition）
    snap.computedStyles = await captureComputedStyles(page, STYLE_SELECTORS, STYLE_PROPS);
    snap.bootErrors = await page.evaluate(() => window.__errors.slice());

    // Pass 2 —— 交互（冻结过渡让几何稳定）
    await freezeTransitions(page);
    snap.boot = await captureBootStructure(page);
    snap.shell = await captureShellInteractions(page);
    snap.contextMenus = await captureContextMenus(page);
    snap.notices = await captureNotices(page);
    snap.apps = await captureApps(page);
    await thawTransitions(page);

    snap.storage = await captureStorage(page);
    snap.allErrors = await page.evaluate(() => window.__errors.slice());

    await page.close();
    return snap;
}

export { STYLE_SELECTORS, STYLE_PROPS };
