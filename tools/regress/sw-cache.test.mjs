#!/usr/bin/env node
// sw.js 的缓存保留逻辑单元测试。
// 回归套件用 ?develop 跳过 Service Worker，覆盖不到这段，所以单独测。
//   node tools/regress/sw-cache.test.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SW = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../sw.js'), 'utf8');

// 从 sw.js 里取出 nochanges 与 isProtected，在 node 里求值
const nochangesSrc = SW.match(/let nochanges = \[[\s\S]*?\]/)[0];
const isProtectedSrc = SW.match(/function isProtected\(url\) \{[\s\S]*?\n\}/)[0];
const isProtected = new Function(`${nochangesSrc};${isProtectedSrc};return isProtected;`)();

// [说明, URL, 是否应当保留]
const CASES = [
    // GitHub Pages：部署在 /win12/ 下
    ['Pages 字体',        'https://win12-online.github.io/win12/fonts/dos.ttf', true],
    ['Pages jQuery',      'https://win12-online.github.io/win12/scripts/jq.min.js', true],
    ['Pages 图标 CSS',    'https://win12-online.github.io/win12/bootstrap-icons.css', true],
    ['Pages 应用图标',    'https://win12-online.github.io/win12/apps/icons/setting/home.png', true],
    ['Pages 壁纸',        'https://win12-online.github.io/win12/img/bg.svg', true],
    // 根路径部署（wrangler.jsonc 把整个仓库挂在 Worker 根；index.html 指向组织根域）
    ['根部署 字体',       'https://win12.tech/fonts/dos.ttf', true],
    ['根部署 jQuery',     'https://win12.tech/scripts/jq.min.js', true],
    ['根部署 图标 CSS',   'https://win12.tech/bootstrap-icons.css', true],
    ['根部署 壁纸',       'https://win12.tech/img/bg.svg', true],
    // 应当被清掉的：会随版本变动的代码与页面
    ['desktop.js',        'https://win12.tech/desktop.js', false],
    ['desktop.html',      'https://win12.tech/desktop.html', false],
    ['desktop.css',       'https://win12.tech/desktop.css', false],
    ['数据表',            'https://win12.tech/data/notices.js', false],
    ['Pages desktop.js',  'https://win12-online.github.io/win12/desktop.js', false],
    // 边界
    ['非法 URL',          'not-a-url', false],
];

let fail = 0;
for (const [name, url, want] of CASES) {
    const got = isProtected(url);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(18)} 期望${want ? '保留' : '清除'} 实际${got ? '保留' : '清除'}`);
}
console.log(fail === 0 ? `\n全部 ${CASES.length} 项通过` : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
