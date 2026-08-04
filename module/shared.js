/* apps.js 内部的共享实现。必须早于 module/apps.js 加载。
 *
 * 抽取依据：把 explorer 与 edge 各自那份历史栈归一化（apps.explorer ↔ apps.edge）后
 * 逐行 diff，51 行里只有 4 行不同 —— 全是 back/front 按钮的选择器。
 */
'use strict';

/** 标签页历史栈。explorer 与 edge 共用；terminal 的 history 语义不同，不在此列。
 *  用 appName 而非直接持有对象，是为了与原实现的 `apps.xxx.yyy` 取值时机完全一致。 */
function createHistoryStack(appName, backSel, frontSel) {
    const self = () => apps[appName];
    return {
        history: [],
        historypt: [],
        initHistory: (tab) => {
            const a = self();
            a.history[tab] = [];
            a.historypt[tab] = -1;
        },
        pushHistory: (tab, u) => {
            const a = self();
            a.history[tab].push(u);
            a.historypt[tab]++;
        },
        topHistory: (tab) => {
            const a = self();
            return a.history[tab][a.historypt[tab]];
        },
        popHistory: (tab) => {
            const a = self();
            a.historypt[tab]--;
            return a.history[tab][a.historypt[tab]];
        },
        incHistory: (tab) => {
            const a = self();
            a.historypt[tab]++;
            return a.history[tab][a.historypt[tab]];
        },
        delHistory: (tab) => {
            const a = self();
            a.history[tab].splice(a.historypt[tab] + 1, a.history[tab].length - 1 - a.historypt[tab]);
        },
        historyIsEmpty: (tab) => self().historypt[tab] <= 0,
        historyIsFull: (tab) => {
            const a = self();
            return a.historypt[tab] >= a.history[tab].length - 1;
        },
        checkHistory: (tab) => {
            const a = self();
            // 原实现是 if(x) addClass; else if(!x) removeClass; 与此等价
            $(backSel)[a.historyIsEmpty(tab) ? 'addClass' : 'removeClass']('disabled');
            $(frontSel)[a.historyIsFull(tab) ? 'addClass' : 'removeClass']('disabled');
        },
        back: (tab) => {
            const a = self();
            a.goto(a.popHistory(tab), false);
            a.checkHistory(tab);
        },
        front: (tab) => {
            const a = self();
            a.goto(a.incHistory(tab), false);
            a.checkHistory(tab);
        },
    };
}
