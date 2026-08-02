/* i18n 与桌面版探测的引导层。
 * 从 desktop.js 抽出，必须早于 data/context-menus.js 与 data/notices.js —— 
 * 那两张表的值里有 ${lang(...)} / ${isTauriApp()}，在对象字面量求值时就会执行。
 * 也必须早于 tauri/tauri_api.js：后者在解析期直接调用 updateAboutAppEntrypoints()。
 * 依赖：langc（data/languages.js）、jQuery + jquery.i18n.properties（head 内同步加载）。
 */
'use strict';
function loadlang(code) {
    $.i18n.properties({
        name: 'lang',
        path: 'lang/lang/', // 目录
        language: code,
        mode: 'map',
        callback: function () {
            $('[data-i18n]').each(function () {
                // 标签的内容
                // console.log($(this).data("i18n"));
                // console.log($.i18n.prop($(this).data("i18n")));
                // if($.i18n.prop($(this).data("i18n"))!=$(this).html())console.log($(this).data("i18n"),$(this).html());
                $(this).html($.i18n.prop($(this).data("i18n")));
            });
            $('[data-i18n-attr]').each(function () {
                // 标签的属性

                // if($.i18n.prop($(this).data("i18n-key"))!=$(this).attr($(this).data("i18n-attr")))console.log($(this).data("i18n-key"),$(this).attr($(this).data("i18n-attr")));
                $(this).attr($(this).data("i18n-attr"), $.i18n.prop($(this).data("i18n-key")));
            });
            updateAboutAppEntrypoints();
        }
    });
}

let nl = 'zh-TW';

let langcode, lang = (txt, id) => {
    return $.i18n.prop(id);
};

if (localStorage.getItem('lang') != null) {
    if (localStorage.getItem('lang') == 'hans' || localStorage.getItem('lang') == 'zh_cn' || localStorage.getItem('lang') == 'zh-cn') {
        localStorage.setItem('lang', 'zh-CN');
    }
} else {
    if (navigator.language in langc)
        localStorage.setItem('lang', langc[navigator.language]);
    else
        localStorage.setItem('lang', 'en');
}
langcode = localStorage.getItem('lang');


if (document.querySelectorAll('#loginback>.langselect>.' + langcode).length != 0) {
    $('#loginback>.langselect>.' + langcode).addClass('selected')
} else {
    $('#loginback>.langselect>.en').addClass('selected')
}


if (langcode != 'zh-CN')
    loadlang(langcode);

if (langcode == 'zh-CN') {
    lang = (txt, id) => {
        // if(txt!=$.i18n.prop(id))console.log(id,txt);
        return txt;
    };
}
console.log('?')


// 函数 lang(txt,id)
/// langcode==zh_cn 下返回 txt,
/// 否则返回语言 properties 文件中键 id 对应的值。
/// 用例：lang('设置','setting.name')
// 
// 为开发方便，故不将简体中文纳入语言考虑

function isTauriApp() {
    return !!((window.win12Native && window.win12Native.isTauri && window.win12Native.isTauri()) || (window.__TAURI__ && window.__TAURI__.core));
}

function getAboutAppTitle() {
    if (!isTauriApp()) return lang('关于 Win12 网页版', 'about.name');
    if (langcode == 'en') return 'About Win12-desktop';
    if (langcode == 'zh-TW') return '關於 Win12-desktop';
    return '关于 Win12-desktop';
}

function updateAboutAppEntrypoints() {
    $('.about-app-title').text(getAboutAppTitle());
}

updateAboutAppEntrypoints();


