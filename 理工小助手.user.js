// ==UserScript==
// @name         优学院助手 + 文档工具（日程/刷课/互评/读书 + MD转Word·PDF + 电子签名）
// @namespace    https://github.com/BrocadeHutHost
// @version      5.12.2
// @description  优学院近七天日程（只读活动日历）+ 刷课助手(倍速守卫/自动答题/题库) + 作业互评面板 + 求是读书 + 外观设置 + Markdown 转 Word/PDF(直出下载) + Word 转 PDF + 图片工具 + 手绘电子签名。（已移除课程签到功能，请诚信签到打卡）
// @author       BrocadeHutHost
// @match        *://*/*
// @icon         https://lms.dgut.edu.cn/favicon.ico
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_cookie
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/marked/marked.min.js
// @require      https://code.jquery.com/jquery-1.12.4.min.js
// @connect      lms.dgut.edu.cn
// @connect      application.dgut.edu.cn
// @connect      courseapi.ulearning.cn
// @connect      ua.dgut.edu.cn
// @connect      api.ulearning.cn
// @connect      *.ulearning.cn
// @connect      *.dgut.edu.cn
// @connect      cdn.jsdelivr.net
// @connect      unpkg.com
// @connect      code.jquery.com
// @connect      api.github.com
// @connect      github.com
// @homepageURL  https://github.com/BrocadeHutHost/DGUT-ULearningTakeQuizzesAssistant
// @connect      raw.githubusercontent.com
// @license      AGPL-3.0-only
// ==/UserScript==

/*
 * 更新策略：**默认不自动更新，但提供「一键更新」（半自动）**
 *
 * 这里刻意不写 @updateURL / @downloadURL —— 那会让油猴在后台静默替换脚本，
 * 用户没有选择权。改为在「详情页 → 作者与许可」提供：
 *   · 「自动检查更新」开关（默认关闭）：开启后打开该页才会去 GitHub / jsDelivr
 *     读取远端 @version 并比较，只做检查与提示；
 *   · 「立即更新」按钮：**发现新版本时才出现**，点了打开油猴安装页，
 *     由用户在油猴弹窗里按下确认后覆盖安装 —— 替换动作始终由用户决定。
 *
 * 注意：安装链接必须指向 `.user.js`：油猴只把「.user.js 结尾」的链接识别成可安装脚本
 *   （官方 FAQ Q102），指向 `理工小助手.js` 只会显示源码、不弹安装页。
 *   所以仓库根目录除了 `理工小助手.js` 还发布一份内容**完全相同**的
 *   `理工小助手.user.js`，由 tools/prepare-publish.mjs 生成，并强制校验两者 sha256 一致。
 *
 * 代价：脚本自身不会把修复推给老用户 —— 老用户仍需点一次「立即更新」并确认。
 */

(function () {
    'use strict';

    const API_HOST = 'https://lms.dgut.edu.cn';
    const TAG = '[优学院助手]';
    const UI_POS_KEY = 'dgut_ui_positions';
    const FAB_POS_KEY = 'dgut_fab_pos';
    /* 悬浮面板靠边吸附：标准版默认开启 */
    const FAB_EDGE_SNAP_KEY = 'dgut_fab_edge_snap';
    const FAB_EDGE_SNAP_DEFAULT = true;
    const PANEL_OPEN_KEY = 'dgut_panel_open_state';
    const VIEW_MODE_KEY = 'dgut_view_mode';
    const THEME_MODE_KEY = 'dgut_theme_mode';
    const ACCENT_KEY = 'dgut_theme_accent';
    const MANUAL_TOKEN_KEY = 'dgut_manual_token';
    /* 近七天日程：勾选状态单独存，接口刷新/过期清理都不影响用户已勾选的其他项 */
    const SCHED_DONE_KEY = 'dgut_schedule_done';
    /* 近七天日程的本地缓存：成功拉取后写入，未登录/其他网站打开时可先展示 */
    const SCHED_CACHE_KEY = 'dgut_schedule_cache';
    const COURSE_HELPER_KEY = 'dgut_course_helper_config';
    const BANK_KEY = 'dgut_quiz_bank';
    const PEER_KEY = 'dgut_peer_review_records';
    const READ_CFG_KEY = 'dgut_single_file_helper_config';
    /* 一次性迁移标记：v5.9.1 之前「默认开启」的旧实现会把 readerAutoStart:true 写进配置
       （连只点「保存翻页间隔」都会写），升级后要把这种旧值重置一次为「关闭」。 */
    const READ_AUTOSTART_MIGRATED_KEY = 'dgut_reader_autostart_migrated_v591';
    const READ_RECORDS_KEY = 'dgut_reading_records';
    const DOC_DRAFT_KEY = 'dgut_doc_md_draft';
    const DOC_TITLE_KEY = 'dgut_doc_md_title';
    const DOC_SIGN_KEY  = 'dgut_doc_signatures';
    const IMG_CFG_KEY   = 'dgut_image_tool_config';
    const DETAIL_TAB_KEY = 'dgut_detail_tab';
    /* 自动检查更新：默认关闭（true 才会去 GitHub 比对版本号，只提示不自动替换） */
    const AUTO_UPDATE_KEY = 'dgut_auto_update_check';
    /* 详细调试日志开关（默认关闭）。调试版 dist/理工小助手-调试版.js 会强制打开：
       打开后刷课决策链路里每一个分支、每一个 try/catch 都会进面板日志框，重点行标红。 */
    const DBG_KEY = 'dgut_debug_verbose';
    const DEBUG = true;

    /* ============================================================
     * 错误码系统
     * ============================================================ */
    const ERR = {
        API_NO_TOKEN:       { code: 1131, msg: '无法获取 Token，请先登录优学院' },
        API_TOKEN_EXPIRED:  { code: 1132, msg: 'Token 已过期，请重新登录' },
        API_NET_FAIL:       { code: 1111, msg: '网络请求失败' },
        API_TIMEOUT:        { code: 1112, msg: '请求超时' },
        API_HTTP_ERR:       { code: 1113, msg: 'HTTP 状态码异常' },
        API_AUTH_FAIL:      { code: 1133, msg: '认证失败（401/403），请重新登录' },
        API_PARSE_FAIL:     { code: 1121, msg: '返回数据解析失败' },
        COURSE_NO_JQ:       { code: 2241, msg: 'jQuery 未加载' },
        COURSE_NO_KO:       { code: 2242, msg: 'Knockout 视图模型未就绪' },
        COURSE_ANSWER_FAIL: { code: 2221, msg: '答案获取失败' },
        COURSE_NO_PAGE:     { code: 2261, msg: '当前不在课件页' },
        COURSE_IFRAME:      { code: 2262, msg: '课件在 iframe 内，请在 iframe 页面中打开本面板' },
        COURSE_LOGIC_ERR:   { code: 2201, msg: '刷课逻辑运行异常' },
        PEER_NOT_PAGE:      { code: 3361, msg: '当前不是作业互评详情页' },
        PEER_PARSE_FAIL:    { code: 3321, msg: '互评数据解析失败' },
        PEER_NO_TOKEN:      { code: 3331, msg: '未获取到互评 Token' },
        PEER_NET_FAIL:      { code: 3311, msg: '互评请求失败' },
        READ_NO_VM:         { code: 4441, msg: '未找到课件视图模型 (koLearnCourseViewModel)' },
        READ_NO_PAGE:       { code: 4461, msg: '当前不在读书课件页' },
        DOC_NO_MARKED:      { code: 5541, msg: 'marked 库未加载' },
        DOC_NO_H2C:         { code: 5542, msg: 'html2canvas 未加载' },
        DOC_NO_JSPDF:       { code: 5543, msg: 'jsPDF 未加载' },
        DOC_EMPTY_MD:       { code: 5561, msg: 'Markdown 内容为空' },
        DOC_PARSE_MD:       { code: 5521, msg: 'Markdown 渲染失败' },
        DOC_PDF_FAIL:       { code: 5522, msg: 'PDF 生成失败' },
        DOC_WORD_FAIL:      { code: 5523, msg: 'Word 导出失败' },
        WP_NO_MAMMOTH:      { code: 6641, msg: 'mammoth 库未加载' },
        WP_NO_FILE:         { code: 6651, msg: '未选择文件' },
        WP_PARSE_FAIL:      { code: 6621, msg: '文档解析失败' },
        WP_EMPTY:           { code: 6622, msg: '文档内容为空或无法解析' },
        IMG_NO_FILE:        { code: 7761, msg: '未选择图片' },
        IMG_DECODE_FAIL:    { code: 7721, msg: '图片解码失败' },
        IMG_ENCODE_FAIL:    { code: 7722, msg: '图片编码失败' },
        IMG_READ_FAIL:      { code: 7711, msg: '读取文件失败' },
        CORE_NO_GM_XHR:     { code: 8841, msg: 'GM_xmlhttpRequest 不可用' },
        CORE_NO_GM_COOKIE:  { code: 8842, msg: 'GM_cookie 不可用' },
        CORE_NO_GM_STORE:   { code: 8843, msg: 'GM_setValue/GM_getValue 不可用' },
        CORE_NO_UNSAFE:     { code: 8844, msg: 'unsafeWindow 不可用' },
        CORE_NOT_TOP:       { code: 8801, msg: '当前帧非顶层窗口' },
        CORE_LIB_FAIL:      { code: 8845, msg: '外部依赖库加载失败' }
    };

    function errTag(def) { return `[E${def.code}]`; }
    function errFull(def, detail) { return `${errTag(def)} ${def.msg}${detail ? '（' + detail + '）' : ''}`; }

    // 错误码分组（用于详情页表格渲染，避免重复罗列）
    const ERR_GROUPS = [
        { module: '通用 / 框架', codes: [8841, 8842, 8843, 8844, 8845, 8801] },
        { module: '日程 / 接口', codes: [1131, 1132, 1133, 1111, 1112, 1113, 1121] },
        { module: '刷课助手',   codes: [2201, 2221, 2241, 2242, 2261, 2262] },
        { module: '作业互评',   codes: [3311, 3321, 3331, 3361] },
        { module: '求是读书',   codes: [4441, 4461] },
        { module: '文档工具',   codes: [5521, 5522, 5523, 5541, 5542, 5543, 5561] },
        { module: 'Word 转 PDF', codes: [6621, 6622, 6641, 6651] },
        { module: '图片工具',   codes: [7711, 7721, 7722, 7761] }
    ];
    const ERR_BY_CODE = (() => {
        const m = {};
        for (const k in ERR) { if (ERR[k] && ERR[k].code) m[ERR[k].code] = ERR[k]; }
        return m;
    })();

    /* ============================================================
     * 依赖库按需加载器
     * ------------------------------------------------------------
     * 关键修复：油猴脚本在带 @grant 时会运行在沙箱中，
     * 用 <script> 注入的库把全局变量挂到「页面 window」上，
     * 沙箱里的 window 代理不保证能读到 → 之前一直报
     * 「mammoth 库未加载」。现在统一从 unsafeWindow(PAGE_WIN)
     * 读取，并增加 unpkg 备用源 + GM_xmlhttpRequest 兜底。
     * ============================================================ */
    const LIB_LOADERS = {};

    function injectScript(url) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.onload = () => { resolve(); };
            s.onerror = () => { try { s.remove(); } catch (e) {} reject(new Error('script error: ' + url)); };
            (document.head || document.documentElement).appendChild(s);
        });
    }

    function gmGetText(url) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('GM_xmlhttpRequest 不可用'));
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: 30000,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300 && res.responseText) resolve(res.responseText);
                    else reject(new Error('HTTP ' + res.status));
                },
                onerror: () => reject(new Error('网络错误')),
                ontimeout: () => reject(new Error('超时'))
            });
        });
    }

    function readGlobal(name) {
        try { if (typeof window !== 'undefined' && window[name] !== undefined && window[name] !== null) return window[name]; } catch (e) {}
        try { if (typeof PAGE_WIN !== 'undefined' && PAGE_WIN && PAGE_WIN[name] !== undefined && PAGE_WIN[name] !== null) return PAGE_WIN[name]; } catch (e) {}
        try { if (typeof self !== 'undefined' && self[name] !== undefined && self[name] !== null) return self[name]; } catch (e) {}
        return undefined;
    }

    /**
     * 通用库加载：依次尝试多个 CDN → 失败后用 GM_xmlhttpRequest 取源码 eval 兜底
     */
    function loadLib(key, urls, checkFn) {
        if (LIB_LOADERS[key]) return LIB_LOADERS[key];
        const p = (async () => {
            let lastErr = null;
            // 阶段 1：script 标签注入（两个 CDN 依次尝试）
            for (const url of urls) {
                try {
                    await injectScript(url);
                    const v = checkFn();
                    if (v) { log(`[依赖] ${key} 已通过 <script> 加载：${url}`); return v; }
                } catch (e) { lastErr = e; }
            }
            // 阶段 2：GM_xmlhttpRequest 拉取源码后在沙箱内执行
            for (const url of urls) {
                try {
                    const code = await gmGetText(url);
                    (0, eval)(code);
                    const v = checkFn();
                    if (v) { log(`[依赖] ${key} 已通过 GM 拉取+eval 加载：${url}`); return v; }
                } catch (e) { lastErr = e; }
            }
            throw new Error(errFull(ERR.CORE_LIB_FAIL, `${key}${lastErr ? '：' + lastErr.message : ''}`));
        })();
        LIB_LOADERS[key] = p;
        p.catch(() => { delete LIB_LOADERS[key]; }); // 失败后允许重试
        return p;
    }

    const CDN_MARKED = ['https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js', 'https://unpkg.com/marked@12.0.2/marked.min.js'];
    const CDN_MAMMOTH = ['https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js', 'https://unpkg.com/mammoth@1.6.0/mammoth.browser.min.js'];
    const CDN_H2C = ['https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', 'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js'];
    const CDN_JSPDF = ['https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', 'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js'];

    async function ensureMarked() {
        let m = readGlobal('marked');
        if (m && typeof m.parse === 'function') return m;
        m = await loadLib('marked', CDN_MARKED, () => {
            const v = readGlobal('marked');
            return (v && typeof v.parse === 'function') ? v : null;
        });
        return m;
    }
    async function ensureMammoth() {
        let m = readGlobal('mammoth');
        if (m && typeof m.convertToHtml === 'function') return m;
        m = await loadLib('mammoth', CDN_MAMMOTH, () => {
            const v = readGlobal('mammoth');
            return (v && typeof v.convertToHtml === 'function') ? v : null;
        });
        return m;
    }
    async function ensureHtml2Canvas() {
        let v = readGlobal('html2canvas');
        if (typeof v === 'function') return v;
        v = await loadLib('html2canvas', CDN_H2C, () => {
            const x = readGlobal('html2canvas');
            return typeof x === 'function' ? x : null;
        });
        return v;
    }
    async function ensureJsPDF() {
        const pick = () => {
            const j = readGlobal('jspdf');
            if (j && j.jsPDF) return j.jsPDF;
            const f = readGlobal('jsPDF');
            return typeof f === 'function' ? f : null;
        };
        let v = pick();
        if (v) return v;
        v = await loadLib('jspdf', CDN_JSPDF, pick);
        return v;
    }

    /* ============================================================
     * iframe 环境检测
     * ============================================================ */
    function detectIframe() {
        const isTop = (() => { try { return window.top === window.self; } catch (e) { return false; } })();
        const hasVideo = document.querySelectorAll('video').length > 0;
        let hasVM = false, hasKo = false;
        try { hasVM = !!(PAGE_WIN.koLearnCourseViewModel && typeof PAGE_WIN.koLearnCourseViewModel.currentPage === 'function'); } catch (e) {}
        try { hasKo = typeof PAGE_WIN.ko !== 'undefined'; } catch (e) {}
        return { isTop, hasVideo, hasVM, hasKo };
    }

    /**
     * 主机名是否属于优学院环境（DGUT 或 ulearning 域）。
     *
     * 注意：这个判断的存在意义就是**别在不相关的网站上碰用户数据**：
     * 本脚本的 @match 是全站通配（任何网站都会运行），而油猴的 Cookie 授权是
     * 「按域弹窗、点一次记住」—— 只要脚本在某个域上调一次 GM_cookie，
     * 用户就会看到一个「允许读取本站 Cookie」的确认框。
     * 在 chat.deepseek.com 上问它要 Cookie，既没有收益，又是纯骚扰。
     */
    function isUlearningHost(host) {
        const h = String(host === undefined ? location.hostname : host);
        return /(^|\.)dgut\.edu\.cn$/i.test(h) || /(^|\.)ulearning\.cn$/i.test(h);
    }

    if (window.top !== window.self) {
        (function readerFrameBootstrap() {
            const MSG = 'DGUT_SINGLE_FILE_READER_SYNC';
            const CFG_KEY = 'dgut_single_file_helper_config';
            const DEF = { readerSec: 30, readerAutoStart: false }; // 默认关闭：只有用户显式点过「开始」（配置里写了 true）才自动恢复翻页
            function readCfg() {
                let r = {};
                try {
                    /* 一次性迁移（v5.9.1）：旧实现默认「开」，而且连只点「保存翻页间隔」
                       都会把 readerAutoStart:true 写进配置 —— 升级后必须把这种旧值重置一次，
                       否则老用户升级了仍然会「没开却自己翻页」。迁移只做一次（标记键），
                       之后用户自己的选择（点开始=true / 暂停=false）原样保留。 */
                    if (GM_getValue(READ_AUTOSTART_MIGRATED_KEY, false) !== true) {
                        const c = GM_getValue(CFG_KEY, {}) || {};
                        if (c.readerAutoStart === true) { c.readerAutoStart = false; GM_setValue(CFG_KEY, c); }
                        GM_setValue(READ_AUTOSTART_MIGRATED_KEY, true);
                    }
                    r = GM_getValue(CFG_KEY, DEF) || {};
                } catch (e) { r = {}; }
                const sec = parseInt(r.readerSec, 10);
                return { readerSec: sec > 0 ? sec : DEF.readerSec, readerAutoStart: r.readerAutoStart === true };
            }
            let timer = null, lastLoopBack = 0, lastFlipLogAt = 0;
            function rlog(msg) { try { console.log('[求是阅读]', msg); window.parent.postMessage({ type: 'DGUT_LOG', text: msg }, '*'); } catch (e) {} }
            function clickNext() {
                const b = document.querySelector('#nextBtn');
                if (!b || b.style.display === 'none' || b.disabled) return;
                const pageIdxEl = document.getElementById('pageIndex');
                const pageCntEl = document.getElementById('pageCount');
                if (pageIdxEl && pageCntEl) {
                    const cur = parseInt(pageIdxEl.innerHTML, 10);
                    const total = parseInt(pageCntEl.innerHTML, 10);
                    if (total > 0 && cur >= total) {
                        const now = Date.now();
                        if (now - lastLoopBack < 3000) return;
                        lastLoopBack = now;
                        try {
                            if (typeof window.goPage === 'function') window.goPage(0);
                            else { const s = document.createElement('script'); s.textContent = 'goPage(0);'; document.head.appendChild(s); setTimeout(() => s.remove(), 100); }
                            lastFlipLogAt = 0; rlog('已至末页，回到第一页循环'); return;
                        } catch (e) { rlog('回到第一页失败：' + e.message); }
                    }
                }
                b.click();
                const now = Date.now();
                if (now - lastFlipLogAt >= 60000) { lastFlipLogAt = now; rlog('翻页'); }
            }
            function stop() { if (timer) { clearInterval(timer); timer = null; } }
            function start(s) { if (timer) return; timer = setInterval(clickNext, s * 1000); rlog('翻页定时器已启动：' + s + '秒/页'); }
            function apply(s, auto) { stop(); if (auto === true) start(s); }
            window.addEventListener('message', (e) => {
                const d = e.data;
                if (!d || d.type !== MSG) return;
                const sec = parseInt(d.intervalSec, 10) || DEF.readerSec;
                rlog('收到同步：' + sec + '秒/页，' + (d.autoStart === true ? '自动' : '暂停'));
                apply(sec, d.autoStart);
            });
            function tryStart() { const st = readCfg(); if (st.readerAutoStart === true) apply(st.readerSec, true); }
            if (document.readyState === 'complete') setTimeout(tryStart, 500);
            else window.addEventListener('load', () => setTimeout(tryStart, 1200), { once: true });
        })();
        return;
    }

    const PAGE_WIN = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    const log = (...a) => { if (DEBUG) console.log(TAG, ...a); };

    function escapeHtml(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function dateKey(d = new Date()) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    /* ============================================================
     * Token 检查（含 JWT 过期解析）
     * ============================================================ */
    async function getAuthToken() {
        if (location.hostname === 'lms.dgut.edu.cn') {
            const match = document.cookie.match(/AUTHORIZATION=([^;]+)/);
            if (match) return match[1];
        }
        const gmCookieToken = await new Promise((resolve) => {
            if (typeof GM_cookie === 'undefined' || !GM_cookie.list) return resolve(null);
            GM_cookie.list({ url: API_HOST, name: 'AUTHORIZATION' }, (cookies, error) => {
                resolve(error || !cookies || cookies.length === 0 ? null : cookies[0].value);
            });
        });
        if (gmCookieToken) return gmCookieToken;
        return GM_getValue(MANUAL_TOKEN_KEY, '');
    }

    function parseJwt(token) {
        try {
            const parts = String(token).split('.');
            if (parts.length !== 3) return null;
            const pad = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            return JSON.parse(atob(pad + '='.repeat((4 - pad.length % 4) % 4)));
        } catch (e) { return null; }
    }

    async function checkAuthToken() {
        const result = { present: false, source: null, expired: false, payload: null, token: null };
        try {
            const tok = await getAuthToken();
            if (!tok) return result;
            result.present = true;
            result.token = tok;
            const cookieMatch = document.cookie.match(/AUTHORIZATION=([^;]+)/);
            if (cookieMatch && cookieMatch[1] === tok) result.source = 'document.cookie';
            else if (GM_getValue(MANUAL_TOKEN_KEY, '') === tok) result.source = '手动输入';
            else result.source = 'GM_cookie / 缓存';
            const p = parseJwt(tok);
            if (p) {
                result.payload = p;
                if (p.exp && Date.now() > p.exp * 1000) result.expired = true;
            }
        } catch (e) {}
        return result;
    }

    /* ============================================================
     * 自检
     * ============================================================ */
    function selfCheck() {
        const results = [];
        const push = (name, ok, errDef, detail) => results.push({ name, ok, errDef, detail });

        push('marked (MD 渲染)',   typeof marked !== 'undefined',                                   ERR.DOC_NO_MARKED);
        push('jQuery',             typeof jQuery !== 'undefined' || typeof $ !== 'undefined',       ERR.COURSE_NO_JQ);
        push('GM_xmlhttpRequest',  typeof GM_xmlhttpRequest === 'function',                         ERR.CORE_NO_GM_XHR);
        push('GM_cookie',          typeof GM_cookie !== 'undefined' && typeof GM_cookie.list === 'function', ERR.CORE_NO_GM_COOKIE);
        push('GM_setValue',        typeof GM_setValue === 'function',                               ERR.CORE_NO_GM_STORE);
        push('GM_getValue',        typeof GM_getValue === 'function',                               ERR.CORE_NO_GM_STORE);
        push('GM_registerMenuCommand', typeof GM_registerMenuCommand === 'function',                ERR.CORE_NO_GM_STORE);
        push('unsafeWindow',       typeof unsafeWindow !== 'undefined',                             ERR.CORE_NO_UNSAFE);
        push('Web Worker',         typeof Worker === 'function',                                    { code: 8846, msg: 'Web Worker 不可用（图片处理将退回主线程）' });

        const passed = results.filter(r => r.ok).length;
        console.log(TAG, '========== 自检开始 ==========');
        console.log(TAG, `通过 ${passed}/${results.length}，失败 ${results.length - passed} 项`);
        results.forEach(r => {
            if (r.ok) console.log(TAG, `[自检] OK ${r.name}`);
            else console.warn(TAG, `[自检] FAIL ${errTag(r.errDef)} ${r.name} 未就绪`);
        });

        const host = location.hostname;
        const isLms = isUlearningHost(host);
        console.log(TAG, `[自检] 当前域 ${host} ${isLms ? 'OK 属于优学院环境' : 'WARN 不在优学院环境中（部分功能不可用）'}`);

        const ifr = detectIframe();
        console.log(TAG, `[自检] ${ifr.isTop ? 'OK 顶层窗口' : 'WARN iframe 环境（刷课/读书建议在顶层打开）'}`);
        if (ifr.hasVideo) console.log(TAG, `[自检] OK 本帧存在 video 元素`);
        if (ifr.hasVM) console.log(TAG, `[自检] OK 本帧存在 koLearnCourseViewModel`);
        if (ifr.hasKo) console.log(TAG, `[自检] OK 本帧存在 ko`);
        console.log(TAG, '========== 自检结束 ==========');

        window.__dgutSelfCheckResults = results;        return results;
    }
    setTimeout(selfCheck, 800);

    setTimeout(async function asyncSelfCheck() {
        console.log(TAG, '========== 异步自检开始 ==========');
        /* 非优学院页面**什么都不查**。
           以前这里无条件跑 checkAuthToken() + 用户身份解析，而它们都会调
           GM_cookie —— 油猴按域弹一次授权框，于是用户每访问一个新网站（例如
           chat.deepseek.com）都会看到一个「允许脚本读取本站 Cookie」的确认框。
           在优学院以外的站点上，Token 本来就解析不出有意义的结果，
           所以这里直接跳过：不弹框、不发请求、不碰任何 Cookie。 */
        if (!isUlearningHost(location.hostname)) {
            console.log(TAG, `[自检] 当前域 ${location.hostname} 不在优学院环境，跳过 Token 自检（也不会申请任何 Cookie 权限）`);
            console.log(TAG, '========== 异步自检结束 ==========');
            return;
        }
        try {
            const auth = await checkAuthToken();
            if (!auth.present) {
                console.warn(TAG, `[自检] WARN ${errTag(ERR.API_NO_TOKEN)} 未获取到 Token（可能未登录，日程/互评接口会失败）`);
            } else {
                const expStr = (auth.payload && auth.payload.exp) ? new Date(auth.payload.exp * 1000).toLocaleString() : '无 exp';
                if (auth.expired) console.warn(TAG, `[自检] WARN ${errTag(ERR.API_TOKEN_EXPIRED)} Token 已过期（过期于 ${expStr}）`);
                else console.log(TAG, `[自检] OK Token 存在（来源：${auth.source}，长度 ${auth.token.length}，过期于 ${expStr}）`);
            }
        } catch (e) {}

        console.log(TAG, '========== 异步自检结束 ==========');
    }, 1800);

    /* ============================================================
     * 主题系统
     * ============================================================ */
    const ACCENTS = {
        purple: { name: '紫罗兰', primary: '#6750A4', container: '#E8DEF8', onContainer: '#21005D', dPrimary: '#D0BCFF', dContainer: '#4F378B', dOnContainer: '#EADDFF', hover: '#57418C', dHover: '#DCC9FF' },
        blue:   { name: '蔚蓝',   primary: '#0061A4', container: '#D1E4FF', onContainer: '#001D36', dPrimary: '#9ECAFF', dContainer: '#00497D', dOnContainer: '#D1E4FF', hover: '#00528C', dHover: '#B7D8FF' },
        teal:   { name: '松石',   primary: '#006874', container: '#97F0FF', onContainer: '#001F24', dPrimary: '#4FD8EB', dContainer: '#004F59', dOnContainer: '#97F0FF', hover: '#005862', dHover: '#83E4F4' },
        green:  { name: '青绿',   primary: '#00696D', container: '#CCE8E7', onContainer: '#002020', dPrimary: '#80D5D4', dContainer: '#004F51', dOnContainer: '#CCE8E7', hover: '#005A5D', dHover: '#A2E0E0' },
        orange: { name: '琥珀',   primary: '#8B5000', container: '#FFDDB8', onContainer: '#2D1600', dPrimary: '#FFB870', dContainer: '#6A3C00', dOnContainer: '#FFDDB8', hover: '#7A4700', dHover: '#FFCB92' },
        red:    { name: '玫红',   primary: '#A03253', container: '#FFD9E1', onContainer: '#3E001D', dPrimary: '#FFB1C6', dContainer: '#7D2948', dOnContainer: '#FFD9E1', hover: '#8B2C48', dHover: '#FFC6D6' }
    };

    function resolvedThemeMode() {
        const m = GM_getValue(THEME_MODE_KEY, 'auto');
        if (!m || m === 'auto') return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
        return m === 'dark' ? 'dark' : 'light';
    }
    function accentOf(id) {
        if (ACCENTS[id]) return ACCENTS[id];
        const hex = /^#([0-9a-f]{6})$/i.test(String(id)) ? id : '#6750A4';
        return {
            name: '自定义', primary: hex,
            container: `color-mix(in srgb, ${hex} 18%, #ffffff)`,
            onContainer: `color-mix(in srgb, ${hex} 70%, #000000)`,
            dPrimary: `color-mix(in srgb, ${hex} 62%, #ffffff)`,
            dContainer: `color-mix(in srgb, ${hex} 42%, #141218)`,
            dOnContainer: `color-mix(in srgb, ${hex} 30%, #ffffff)`,
            hover: `color-mix(in srgb, ${hex} 85%, #000000)`,
            dHover: `color-mix(in srgb, ${hex} 78%, #ffffff)`
        };
    }
    function themeTokens() {
        const dark = resolvedThemeMode() === 'dark';
        const a = accentOf(GM_getValue(ACCENT_KEY, 'purple'));
        const light = {
            surface: '#FEF7FF', surface2: '#F7F2FA', surface3: '#FFFFFF',
            onSurface: '#1D1B20', onSurfaceVariant: '#49454E',
            outline: '#79747E', outlineVariant: '#E7E0EC',
            secondaryContainer: '#F3EDF7', onSecondaryContainer: '#1D192B',
            error: '#B3261E', errorContainer: '#FFEBEE', onErrorContainer: '#721C24',
            success: '#2E7D32', successContainer: '#E8F5E9', onSuccessContainer: '#1B5E20',
            warn: '#8B5000', warnContainer: '#FFF3E0', onWarnContainer: '#7A4400',
            inputBg: '#F3EDF7', hoverOverlay: 'rgba(0,0,0,.04)', onPrimary: '#FFFFFF'
        };
        const darkBase = {
            surface: '#141218', surface2: '#1F1D24', surface3: '#2B2930',
            onSurface: '#E6E0E9', onSurfaceVariant: '#CAC4D0',
            outline: '#938F99', outlineVariant: '#49454E',
            secondaryContainer: '#4A4458', onSecondaryContainer: '#E8DEF8',
            error: '#F2B8B5', errorContainer: '#8C1D18', onErrorContainer: '#F9DEDC',
            success: '#A5D6A7', successContainer: '#1B4D22', onSuccessContainer: '#B8E5BA',
            warn: '#FFB870', warnContainer: '#5C3600', onWarnContainer: '#FFDDB8',
            inputBg: '#1F1D24', hoverOverlay: 'rgba(255,255,255,.06)', onPrimary: '#21005D'
        };
        const base = dark ? darkBase : light;
        const infoContainer = dark
            ? `color-mix(in srgb, ${a.dContainer} 60%, ${base.surface})`
            : `color-mix(in srgb, ${a.container} 62%, ${base.surface3})`;
        const onInfoContainer = dark ? a.dOnContainer : a.onContainer;
        return Object.assign(base, {
            primary: dark ? a.dPrimary : a.primary,
            primaryHover: dark ? a.dHover : a.hover,
            container: dark ? a.dContainer : a.container,
            onContainer: dark ? a.dOnContainer : a.onContainer,
            infoContainer, onInfoContainer
        });
    }

    function applyTheme() {
        const dark = resolvedThemeMode() === 'dark';
        const t = themeTokens();
        document.documentElement.classList.toggle('dgut-theme-dark', dark);
        let style = document.getElementById('dgut-theme-style');
        if (!style) { style = document.createElement('style'); style.id = 'dgut-theme-style'; document.head.appendChild(style); }
        style.textContent = `
            :root, html.dgut-theme-dark {
                --dgut-primary: ${t.primary};
                --dgut-primary-hover: ${t.primaryHover};
                --dgut-on-primary: ${t.onPrimary};
                --dgut-primary-container: ${t.container};
                --dgut-on-primary-container: ${t.onContainer};
                --dgut-secondary-container: ${t.secondaryContainer};
                --dgut-on-secondary-container: ${t.onSecondaryContainer};
                --dgut-surface: ${t.surface};
                --dgut-surface-2: ${t.surface2};
                --dgut-surface-3: ${t.surface3};
                --dgut-on-surface: ${t.onSurface};
                --dgut-on-surface-variant: ${t.onSurfaceVariant};
                --dgut-outline: ${t.outline};
                --dgut-outline-variant: ${t.outlineVariant};
                --dgut-error: ${t.error};
                --dgut-error-container: ${t.errorContainer};
                --dgut-on-error-container: ${t.onErrorContainer};
                --dgut-success: ${t.success};
                --dgut-success-container: ${t.successContainer};
                --dgut-on-success-container: ${t.onSuccessContainer};
                --dgut-warn: ${t.warn};
                --dgut-warn-container: ${t.warnContainer};
                --dgut-on-warn-container: ${t.onWarnContainer};
                --dgut-info-container: ${t.infoContainer};
                --dgut-on-info-container: ${t.onInfoContainer};
                --dgut-input-bg: ${t.inputBg};
                --dgut-hover-overlay: ${t.hoverOverlay};
                --dgut-font: "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
                --dgut-color-scheme: ${dark ? 'dark' : 'light'};
            }
            #dgut-main-panel, #dgut-mini-panel, #dgut-toast-card { color-scheme: var(--dgut-color-scheme); }
            #dgut-main-panel select option { background: var(--dgut-surface-3); color: var(--dgut-on-surface); }
            #dgut-main-panel input[type="color"] {
                background: var(--dgut-input-bg);
                border: 1px solid var(--dgut-outline);
                border-radius: 8px;
                padding: 2px;
            }
            #dgut-main-panel ::-webkit-scrollbar { width: 10px; height: 10px; }
            #dgut-main-panel ::-webkit-scrollbar-track { background: transparent; }
            #dgut-main-panel ::-webkit-scrollbar-thumb {
                background: var(--dgut-outline-variant);
                border-radius: 6px;
                border: 2px solid var(--dgut-surface);
            }
            #dgut-main-panel ::-webkit-scrollbar-thumb:hover { background: var(--dgut-outline); }
        `;
    }

    function initThemeWatcher() {
        applyTheme();
        try {
            const mq = window.matchMedia('(prefers-color-scheme: dark)');
            const onChange = () => { if (GM_getValue(THEME_MODE_KEY, 'auto') === 'auto') applyTheme(); };
            if (mq.addEventListener) mq.addEventListener('change', onChange);
            else if (mq.addListener) mq.addListener(onChange);
        } catch (e) {}
    }

    const KAO = { ok: '(????-)?', zen: '(－?－)', sweat: '(；′д｀)' };

    function showStatus(msg, isError = false) {
        const el = document.getElementById('dgut-status-bar');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('dgut-status-error', !!isError);
        el.style.display = 'block';
        clearTimeout(el._timer);
        el._timer = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
    let gStatusTicker = null;
    function startStatusTicker(baseText) {
        stopStatusTicker();
        const t0 = Date.now();
        const el = document.getElementById('dgut-status-bar');
        const tick = () => {
            const secs = Math.round((Date.now() - t0) / 1000);
            const msg = secs < 1 ? `${baseText}…` : `${baseText}…（已等待 ${secs} 秒）`;
            if (el) { el.textContent = msg; el.classList.remove('dgut-status-error'); el.style.display = 'block'; }
        };
        tick();
        gStatusTicker = setInterval(tick, 1000);
    }
    function stopStatusTicker() { if (gStatusTicker) { clearInterval(gStatusTicker); gStatusTicker = null; } }

    const icons = {
        list: `<svg viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 8h14v-2H7v-2zM7 7v2h14V7H7z"/></svg>`,
        refresh: `<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
        export: `<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
        upload: `<svg viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>`,
        settings: `<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
        close: `<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
        add: `<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>`,
        calendar: `<svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>`,
        course: `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`,
        peer: `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>`,
        read: `<svg viewBox="0 0 24 24"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 18H6V4h2v8l2.5-1.5L13 12V4h5v16z"/></svg>`,
        theme: `<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>`,
        doc: `<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`,
        info: `<svg viewBox="0 0 24 24"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>`
    };

    GM_addStyle(`
        @keyframes dgutPulse {0%,100%{filter:brightness(1)}50%{filter:brightness(1.15)}}
        @keyframes dgutDown {from{transform:translate(-50%,-120%);opacity:0}to{transform:translate(-50%,0);opacity:1}}
        @keyframes dgutShrinkX {from{transform:scaleX(1)}to{transform:scaleX(0)}}
        .dgut-card { background: var(--dgut-surface-3); border: 1px solid var(--dgut-outline-variant); border-radius: 14px; padding: 16px; margin-bottom: 12px; color: var(--dgut-on-surface); transition: background .15s, border-color .15s; }
        .dgut-card--tight { padding: 12px; }
        .dgut-card:last-child { margin-bottom: 0; }
        .dgut-hint { border: 1px solid var(--dgut-outline-variant); border-radius: 12px; padding: 10px 14px; font-size: 12px; line-height: 1.7; background: var(--dgut-info-container); color: var(--dgut-on-info-container); margin-bottom: 12px; }
        .dgut-hint--success { background: var(--dgut-success-container); color: var(--dgut-on-success-container); }
        .dgut-hint--warn { background: var(--dgut-warn-container); color: var(--dgut-on-warn-container); }
        .dgut-hint code { font-family: Consolas, "Courier New", monospace; background: var(--dgut-hover-overlay); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
        .dgut-section-title { font-size: 13px; font-weight: 700; margin-bottom: 10px; color: var(--dgut-on-surface); }
        .dgut-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
        .dgut-row--end { justify-content: flex-end; }
        .dgut-row--mb { margin-bottom: 10px; }
        .dgut-label { font-size: 13px; color: var(--dgut-on-surface-variant); display: inline-flex; align-items: center; gap: 6px; }
        .dgut-label input[type="checkbox"] { accent-color: var(--dgut-primary); }
        .dgut-input, .dgut-textarea, .dgut-select { padding: 8px 12px; border: 1px solid var(--dgut-outline); border-radius: 10px; background: var(--dgut-input-bg); color: var(--dgut-on-surface); font-size: 13px; outline: none; box-sizing: border-box; font-family: inherit; transition: border-color .15s, background .15s; }
        .dgut-input:focus, .dgut-textarea:focus, .dgut-select:focus { border-color: var(--dgut-primary); }
        .dgut-input:disabled { opacity: .55; cursor: not-allowed; }
        .dgut-input::placeholder, .dgut-textarea::placeholder { color: var(--dgut-outline); }
        .dgut-log { max-height: 240px; overflow-y: auto; font-size: 12px; background: var(--dgut-surface-2); border: 1px solid var(--dgut-outline-variant); border-radius: 10px; padding: 8px 10px; color: var(--dgut-on-surface); line-height: 1.7; }
        .dgut-log-line { line-height: 1.7; word-break: break-all; }
        .dgut-log-line.log-success { color: var(--dgut-success); }
        .dgut-log-line.log-warn { color: var(--dgut-error); }
        .dgut-log-line.log-muted { color: var(--dgut-on-surface-variant); }
        /* 调试日志的重点行：标红；error 加粗，hot 再加底色，便于在几百行里一眼扫到 */
        .dgut-log-line.log-error { color: #ff3b30; font-weight: 700; }
        .dgut-log-line.log-hot { color: #ff3b30; font-weight: 700; background: rgba(255,59,48,.14); border-radius: 3px; }
        .dgut-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 7px 13px; border: none; border-radius: 999px; background: var(--dgut-secondary-container); color: var(--dgut-on-secondary-container); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background .15s, color .15s, box-shadow .15s; font-family: inherit; }
        .dgut-btn:hover { background: var(--dgut-primary-container); color: var(--dgut-on-primary-container); }
        .dgut-btn:disabled { opacity: .6; cursor: progress; }
        .dgut-btn-primary { background: var(--dgut-primary); color: var(--dgut-on-primary); }
        .dgut-btn-primary:hover { background: var(--dgut-primary-hover); color: var(--dgut-on-primary); }
        .dgut-btn svg, .dgut-ico svg { width: 15px; height: 15px; fill: currentColor; flex: none; }
        .dgut-nav { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; padding: 9px 10px; border: none; border-radius: 10px; background: transparent; font-size: 12px; font-weight: 500; color: var(--dgut-on-surface-variant); cursor: pointer; user-select: none; text-align: left; white-space: nowrap; transition: background .15s, color .15s; font-family: inherit; }
        .dgut-nav svg { width: 16px; height: 16px; fill: currentColor; flex: none; }
        .dgut-nav:hover { background: var(--dgut-primary-container); color: var(--dgut-on-primary-container); }
        .dgut-nav.dgut-tab-active { background: var(--dgut-primary-container); color: var(--dgut-primary); font-weight: 700; }
        .dgut-nav-label { font-size: 10px; font-weight: 700; color: var(--dgut-outline); letter-spacing: .6px; padding: 12px 10px 4px; user-select: none; }
        #dgut-status-bar { padding: 6px 12px; font-size: 11px; border-top: 1px solid var(--dgut-outline-variant); background: var(--dgut-surface-2); color: var(--dgut-on-surface-variant); }
        #dgut-status-bar.dgut-status-error { color: var(--dgut-error); background: var(--dgut-error-container); }
        .dgut-peer-card { border-radius: 12px; padding: 10px 14px; margin-bottom: 10px; background: var(--dgut-surface-2); color: var(--dgut-on-surface); border: 1px solid var(--dgut-outline-variant); }
        .dgut-peer-card.peer-low { background: color-mix(in srgb, var(--dgut-error) 14%, var(--dgut-surface-3)); }
        .dgut-peer-card.peer-mid { background: color-mix(in srgb, var(--dgut-warn) 16%, var(--dgut-surface-3)); }
        .dgut-peer-card.peer-high { background: color-mix(in srgb, var(--dgut-success) 12%, var(--dgut-surface-3)); }
        .dgut-peer-card .peer-name { font-size: 15px; font-weight: 600; }
        .dgut-peer-card .peer-score { font-size: 15px; font-weight: 600; }
        .dgut-peer-card .peer-hw { font-size: 12px; opacity: .85; margin: 4px 0 6px; }
        .dgut-peer-card .peer-content { font-size: 13px; line-height: 1.4; margin-bottom: 6px; }
        .dgut-peer-card .peer-foot { font-size: 11px; opacity: .7; border-top: 1px solid var(--dgut-hover-overlay); padding-top: 5px; display: flex; justify-content: space-between; }
        #dgut-toast-card { position: fixed; top: 24px; left: 50%; transform: translateX(-50%); z-index: 2147483645; min-width: 340px; max-width: 92vw; background: var(--dgut-surface-3); color: var(--dgut-on-surface); padding: 16px 20px 20px; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,.45); font-family: var(--dgut-font); cursor: pointer; border-left: 6px solid var(--dgut-primary); animation: dgutDown .35s cubic-bezier(.2,.8,.2,1); overflow: hidden; }
        .dgut-toast-title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
        .dgut-toast-body { font-size: 14px; color: var(--dgut-on-surface-variant); line-height: 1.5; }
        .dgut-toast-sub { font-size: 12px; color: var(--dgut-outline); margin-top: 6px; }
        .dgut-toast-progress { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--dgut-primary); width: 100%; transform-origin: left; animation: dgutShrinkX linear forwards; }
        .dgut-sig-card { border: 1px solid var(--dgut-outline-variant); border-radius: 10px; padding: 6px; background: var(--dgut-surface-2); display: flex; flex-direction: column; gap: 4px; width: 150px; box-sizing: border-box; }
        .dgut-sig-card img { width: 100%; height: 56px; object-fit: contain; background: #fff; border-radius: 6px; }
        .dgut-sig-card .dgut-sig-meta { font-size: 11px; color: var(--dgut-on-surface-variant); display: flex; align-items: center; gap: 6px; }
        .dgut-sig-del { cursor: pointer; color: var(--dgut-error); font-weight: 700; font-size: 14px; line-height: 1; }
        #dgut-doc-preview-box { margin-top: 10px; padding: 12px 14px; background: var(--dgut-surface-2); border: 1px solid var(--dgut-outline-variant); border-radius: 10px; font-size: 13px; line-height: 1.7; max-height: 340px; overflow: auto; color: var(--dgut-on-surface); }
        #dgut-doc-preview-box h1, #dgut-doc-preview-box h2, #dgut-doc-preview-box h3 { margin: 12px 0 8px; color: var(--dgut-on-surface); line-height: 1.3; font-weight: 700; }
        #dgut-doc-preview-box h1 { font-size: 20px; border-bottom: 1px solid var(--dgut-outline-variant); padding-bottom: 6px; }
        #dgut-doc-preview-box h2 { font-size: 17px; } #dgut-doc-preview-box h3 { font-size: 15px; }
        #dgut-doc-preview-box blockquote { border-left: 4px solid var(--dgut-primary); background: var(--dgut-surface-3); color: var(--dgut-on-surface-variant); padding: 6px 14px; margin: 10px 0; border-radius: 0 6px 6px 0; }
        #dgut-doc-preview-box pre, #dgut-doc-preview-box code { background: var(--dgut-hover-overlay); padding: 2px 6px; border-radius: 4px; font-family: Consolas, "Courier New", monospace; font-size: 12px; }
        #dgut-doc-preview-box pre { padding: 10px 12px; overflow-x: auto; border-radius: 6px; }
        #dgut-doc-preview-box table { border-collapse: collapse; margin: 8px 0; border: 1px solid var(--dgut-outline-variant); }
        #dgut-doc-preview-box th, #dgut-doc-preview-box td { border: 1px solid var(--dgut-outline-variant); padding: 5px 10px; }
        #dgut-doc-preview-box th { background: var(--dgut-secondary-container); }
        #dgut-doc-preview-box img { max-width: 100%; height: auto; border-radius: 6px; }
        #dgut-sig-canvas { width: 100%; height: 180px; background: var(--dgut-surface-3); border: 2px dashed var(--dgut-outline); border-radius: 10px; touch-action: none; display: block; cursor: crosshair; box-sizing: border-box; }
        #dgut-mini-panel { position: fixed; z-index: 2147483001; width: 80px; height: 80px; border-radius: 18px; background: var(--dgut-surface-3); display: flex; align-items: center; justify-content: center; cursor: pointer; user-select: none; border: 2px solid var(--dgut-primary-container); box-shadow: 0 2px 10px rgba(0,0,0,.15); transition: box-shadow .2s, transform .2s, border-color .2s, background .2s; }
        #dgut-mini-panel svg { display: block; }
        #dgut-mini-panel .mini-ring { stroke: var(--dgut-primary); }
        #dgut-mini-panel .mini-check { stroke: var(--dgut-primary); }
        #dgut-mini-panel:hover { box-shadow: 0 4px 16px color-mix(in srgb, var(--dgut-primary) 40%, transparent); transform: scale(1.06); }
        #dgut-main-panel { position: fixed; z-index: 2147483000; width: 780px; height: 620px; max-width: 98vw; max-height: 96vh; background: var(--dgut-surface); color: var(--dgut-on-surface); border-radius: 16px; box-shadow: 0 8px 30px rgba(0,0,0,.35); font-family: var(--dgut-font); overflow: hidden; border: 1px solid var(--dgut-outline-variant); display: flex; flex-direction: column; transform-origin: 0 0; }
        .dgut-resizer { position: absolute; z-index: 6; }
        #dgut-panel-resizer-e { right: 0; top: 10px; bottom: 20px; width: 7px; cursor: ew-resize; }
        #dgut-panel-resizer-w { left: 0; top: 10px; bottom: 20px; width: 7px; cursor: ew-resize; }
        #dgut-panel-resizer-s { left: 20px; right: 20px; bottom: 0; height: 7px; cursor: ns-resize; }
        #dgut-panel-resizer-n { left: 20px; right: 20px; top: 0; height: 7px; cursor: ns-resize; }
        #dgut-panel-resizer-se { right: 0; bottom: 0; width: 20px; height: 20px; cursor: nwse-resize; }
        #dgut-panel-resizer-se::after { content: ''; position: absolute; right: 4px; bottom: 4px; width: 8px; height: 8px; border-right: 2px solid var(--dgut-outline); border-bottom: 2px solid var(--dgut-outline); border-radius: 0 0 3px 0; opacity: .75; }
        #dgut-panel-resizer-e:hover, #dgut-panel-resizer-w:hover, #dgut-panel-resizer-s:hover, #dgut-panel-resizer-n:hover { background: color-mix(in srgb, var(--dgut-primary) 22%, transparent); }
        #dgut-panel-zoom-badge { position: absolute; right: 26px; bottom: 8px; z-index: 7; font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: var(--dgut-secondary-container); color: var(--dgut-on-secondary-container); box-shadow: 0 1px 4px rgba(0,0,0,.25); opacity: 0; transition: opacity .15s; pointer-events: none; }
        #dgut-panel-header { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--dgut-primary); color: var(--dgut-on-primary); cursor: move; user-select: none; }
        #dgut-panel-header .panel-title { font-size: 14px; font-weight: 700; line-height: 1.25; }
        #dgut-panel-close { border: none; background: color-mix(in srgb, var(--dgut-on-primary) 20%, transparent); color: var(--dgut-on-primary); width: 30px; height: 30px; border-radius: 50%; font-size: 17px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none; transition: background .15s; font-family: inherit; }
        #dgut-panel-close:hover { background: color-mix(in srgb, var(--dgut-on-primary) 32%, transparent); }
        #dgut-sidebar { width: 158px; flex: none; min-height: 0; background: var(--dgut-surface-2); border-right: 1px solid var(--dgut-outline-variant); padding: 10px 8px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; overflow-x: hidden; }
        #dgut-panel-body { flex: 1 1 auto; min-width: 0; min-height: 0; overflow-y: auto; padding: 10px 12px; background: var(--dgut-surface); }
        #dgut-panel-footer-version { font-size: 10px; color: var(--dgut-on-surface-variant); text-align: center; padding: 6px 0; opacity: .7; }
        .dgut-tab-bar { display: flex; gap: 4px; border-bottom: 1px solid var(--dgut-outline-variant); margin-bottom: 12px; }
        .dgut-tab-btn { padding: 8px 14px; border: none; background: transparent; color: var(--dgut-on-surface-variant); font-size: 13px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; font-family: inherit; transition: color .15s, border-color .15s; }
        .dgut-tab-btn:hover { color: var(--dgut-on-surface); }
        .dgut-tab-btn.active { color: var(--dgut-primary); border-bottom-color: var(--dgut-primary); }
        .dgut-err-code { font-family: Consolas, "Courier New", monospace; font-weight: 700; color: var(--dgut-error); }
        .dgut-err-row { display: flex; gap: 12px; padding: 6px 10px; border-bottom: 1px solid var(--dgut-outline-variant); font-size: 12px; line-height: 1.6; }
        .dgut-err-row:last-child { border-bottom: none; }
        .dgut-err-row .dgut-err-code { flex: none; min-width: 60px; }
        .dgut-link { color: var(--dgut-primary); text-decoration: none; }
        .dgut-link:hover { text-decoration: underline; }
    `);

    let gAudioCtx = null;
    function ensureAudioCtx() {
        try {
            if (!gAudioCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; gAudioCtx = new AC(); }
            if (gAudioCtx.state === 'suspended') gAudioCtx.resume().catch(() => {});
            return gAudioCtx;
        } catch (e) { return null; }
    }
    (function unlockMediaOnGesture() {
        const handler = () => {
            const ctx = ensureAudioCtx();
            if (ctx) { try { const b = ctx.createBuffer(1, 1, 22050); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) {} }
            try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
        };
        document.addEventListener('click', handler, { once: true, capture: true });
        document.addEventListener('keydown', handler, { once: true, capture: true });
    })();
    function playAlarmBeep(opts = {}) {
        const { count = 2, freq = 880, gap = 180, duration = 0.28, volume = 0.35, type = 'square' } = opts;
        const ctx = ensureAudioCtx(); if (!ctx) return;
        try {
            for (let i = 0; i < count; i++) {
                const t0 = ctx.currentTime + i * (duration + gap / 1000);
                const osc = ctx.createOscillator(), gain = ctx.createGain();
                osc.type = type;
                osc.frequency.setValueAtTime(freq, t0);
                osc.frequency.setValueAtTime(freq * 1.335, t0 + duration * 0.55);
                gain.gain.setValueAtTime(0.0001, t0);
                gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(t0); osc.stop(t0 + duration + 0.05);
            }
        } catch (e) {}
    }
    function showToastCard(title, body, subtext = '', durationMs = 10000) {
        document.getElementById('dgut-toast-card')?.remove();
        const card = document.createElement('div');
        card.id = 'dgut-toast-card';
        card.innerHTML = `
            <div class="dgut-toast-title">${escapeHtml(title)}</div>
            <div class="dgut-toast-body">${escapeHtml(body)}</div>
            ${subtext ? `<div class="dgut-toast-sub">${escapeHtml(subtext)}</div>` : ''}
            <div class="dgut-toast-progress" style="animation-duration:${durationMs}ms;"></div>`;
        document.body.appendChild(card);
        card.onclick = () => card.remove();
        setTimeout(() => card.remove(), durationMs + 500);
    }

    /* ============================================================
     * 优学院接口响应归一化
     *
     * 该平台的接口有历史包袱，同一套 API 里成功标识并不统一：
     *   · 老接口：{ code: 1, result: {...} }
     *   · 新接口：{ code: 200, data: {...} } / { status: 200 }
     *   · 少数只回 { success: true } 或直接回 result
     *
     * 旧实现只认 res.status === 200/201，于是当接口回 { code: 1 } 时，
     * 业务其实成功了却被判成失败，并把整段 JSON 当成报错文案糊在日志里
     * ——这就是用户看到的「接口响应失败」。
     *
     * 现在的原则：
     *   1) 只要能识别出「成功」就算成功，别再把成功误判为失败；
     *   2) 识别不出来时**既不报成功也不报失败**，而是把服务端原文打出来，
     *      让人能直接看到服务器到底说了什么（不再猜）。
     * ============================================================ */
    const API_OK_CODES = new Set([1, 200, 201, '1', '200', '201', 'ok', 'OK', 'success', 'SUCCESS', 'true', 'True']);

    /** 从响应里取「业务状态码」，兼容 code/status/statusCode/errCode/resultCode/state */
    function apiCode(res) {
        if (!res || typeof res !== 'object') return undefined;
        for (const k of ['code', 'status', 'statusCode', 'errCode', 'resultCode', 'state']) {
            const v = res[k];
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return undefined;
    }
    /** 取服务端自己的可读文案（优先 msg/message，其次 result 里的 msg/message） */
    function apiMessage(res) {
        if (!res || typeof res !== 'object') return '';
        const deep = (res.result && typeof res.result === 'object') ? res.result : (res.data && typeof res.data === 'object' ? res.data : null);
        const cands = [res.msg, res.message, res.errMsg, res.errorMsg, res.error, res.info,
                       deep && deep.msg, deep && deep.message];
        for (const c of cands) {
            if (typeof c === 'string' && c.trim()) return c.trim();
        }
        return '';
    }
    /** 成功判定：显式布尔 → 显式状态码 → 「无状态码但带 result/data」的宽容兜底 */
    function apiOk(res) {
        if (!res || typeof res !== 'object') return false;
        if (res.success === true || res.ok === true || res.error === false) return true;
        const c = apiCode(res);
        if (c !== undefined) return API_OK_CODES.has(typeof c === 'string' ? c.trim() : c);
        return ('result' in res) || ('data' in res);
    }
    /** 把服务端原文压成一行，用于日志（识别不出结构时靠它定位问题） */
    function apiRaw(res, max = 200) {
        try { return JSON.stringify(res).slice(0, max); } catch (e) { return String(res).slice(0, max); }
    }

    /* ------------------------------------------------------------
     * 关于认证（已用真实接口核实，2026-10）：
     *   · 所有业务接口只认请求头 Authorization: <token>（原始值，**不加 Bearer**）
     *   · application.dgut.edu.cn 的课堂接口**不认 cookie**：
     *     只带 cookie → HTTP 401 + { code:2001, message:"缺少访问token" }
     *     Bearer 前缀  → HTTP 401 + { code:2101, message:"无效的token" }
     *   · Origin/Referer 与 Host 不一致不会被拒（按目标域给只是更规范）
     *   所以这里保持匿名请求（不带 cookie），认证只依赖 Authorization 头。
     * ------------------------------------------------------------ */

    async function gmFetchEx(url, opts = {}) {
        const token = await getAuthToken();
        if (!token) throw new Error(errFull(ERR.API_NO_TOKEN));
        const method = String(opts.method || 'GET').toUpperCase();
        const headers = { 'Accept': 'application/json, text/plain, */*' };

        /* 修复：旧实现无条件把 Origin/Referer 写成 lms.dgut.edu.cn，
           但部分接口在 application.dgut.edu.cn。跨站 POST 带着不匹配的
           Origin/Referer 很容易被 WAF 拦掉，表现为「响应失败」。
           现在按目标地址推导，且只写我们信任的域。 */
        let target = null;
        try { target = new URL(url, location.href); } catch (e) { target = null; }
        if (target && /(^|\.)(dgut\.edu\.cn|ulearning\.cn)$/i.test(target.hostname)) {
            headers['Referer'] = target.origin + '/';
            headers['Origin'] = target.origin;
        }
        if (opts.headers) Object.assign(headers, opts.headers);
        headers['Authorization'] = token;

        let data;
        if (opts.data !== undefined && opts.data !== null) {
            headers['Content-Type'] = 'application/json;charset=UTF-8';
            data = typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data);
        }
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method, url, anonymous: true, headers, data, timeout: 15000,
                onload: (res) => {
                    const text = String(res.responseText == null ? '' : res.responseText).replace(/^\uFEFF/, '').trim();
                    let parsed = null;
                    if (text) {
                        try { parsed = JSON.parse(text); }
                        catch (e) {
                            /* 兼容 JSONP 包装：callback({...}) */
                            const m = /^[A-Za-z_$][\w$]*\s*\(([\s\S]*)\)\s*;?$/.exec(text);
                            if (m) { try { parsed = JSON.parse(m[1]); } catch (e2) {} }
                        }
                    }
                    /* 401/403：旧实现只报「认证失败 HTTP 401」，看不到服务端原因。
                       现在把服务端自己的 message 带出来（如「缺少访问token」「无效的token」）。 */
                    if (res.status === 401 || res.status === 403) {
                        const why = parsed ? apiMessage(parsed) : text.slice(0, 60);
                        return reject(new Error(errFull(ERR.API_AUTH_FAIL, 'HTTP ' + res.status + (why ? '：' + why : ''))));
                    }
                    if (res.status >= 400) return reject(new Error(errFull(ERR.API_HTTP_ERR, 'HTTP ' + res.status)));
                    if (!text) return resolve({});                 // 空响应体按空对象处理，不再当解析失败
                    if (parsed === null) return reject(new Error(errFull(ERR.API_PARSE_FAIL, text.slice(0, 80))));
                    return resolve(parsed);
                },
                onerror: () => reject(new Error(errFull(ERR.API_NET_FAIL))),
                ontimeout: () => reject(new Error(errFull(ERR.API_TIMEOUT)))
            });
        });
    }

    /* ============================================================
     * 近七天日程（只读）
     * ------------------------------------------------------------
     * 数据来源（与完整版同一个接口，2026-10 实测）：
     *   GET {API_HOST}/courseapi/activitycalendar?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&lang=zh
     *   请求头：Authorization: <token>（原始 token，不加 Bearer）；anonymous 请求
     *   返回：{ total, courseCount, homeworkCount, discussionCount, liveCount, examCount,
     *           activityList: [{ activityId, activityType, title, ocId, courseName,
     *                            beginTime, endTime }], courseList: [...] }
     *   beginTime / endTime 是**毫秒时间戳**。
     *
     * 本功能刻意保持极简：
     *   · 只显示「近 7 天」的活动，按时间升序平铺，不分类、不筛选、不带提醒；
     *   · 每项一个勾选框，勾上后置灰（勾选状态只存本地）；
     *   · 过了截止时间自动从列表清理（不通知、不打扰）；
     *   · 只发只读 GET，不写任何服务端状态。
     * ============================================================ */
    const SCHED_WINDOW_DAYS = 7;
    const SCHED_REFRESH_MS = 5 * 60 * 1000;
    const SCHED_CACHE_MAX = 200;
    let gSchedItems = null, gSchedFetchedAt = 0, gSchedLoading = false, gSchedError = '', gSchedTimer = null;
    let gSchedFromCache = false, gSchedCacheAt = 0;

    GM_addStyle(`
        .dgut-sched-list { display: flex; flex-direction: column; gap: 6px; max-height: 430px; overflow-y: auto; }
        .dgut-sched-item { border: 1px solid var(--dgut-outline-variant); border-radius: 10px; background: var(--dgut-surface-2); padding: 8px 10px; transition: opacity .15s, background .15s; }
        .dgut-sched-item:hover { background: var(--dgut-surface-3); }
        .dgut-sched-item.is-done { opacity: .45; }
        .dgut-sched-item.is-done .dgut-sched-title { text-decoration: line-through; }
        .dgut-sched-item label { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
        .dgut-sched-item input[type="checkbox"] { margin-top: 2px; flex: none; accent-color: var(--dgut-primary); }
        .dgut-sched-main { flex: 1; min-width: 0; }
        .dgut-sched-line { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; font-size: 13px; line-height: 1.55; color: var(--dgut-on-surface); }
        .dgut-sched-time { flex: none; font-family: Consolas, "Courier New", monospace; font-size: 12px; font-weight: 700; color: var(--dgut-primary); white-space: nowrap; }
        .dgut-sched-title { flex: 1; min-width: 0; word-break: break-all; }
        .dgut-sched-sub { display: block; margin-top: 2px; font-size: 11px; color: var(--dgut-on-surface-variant); word-break: break-all; }
    `);

    function schedPad(n) { return String(n).padStart(2, '0'); }
    function schedDateStr(d) { return `${d.getFullYear()}-${schedPad(d.getMonth() + 1)}-${schedPad(d.getDate())}`; }
    function schedFmtTime(ts) {
        const d = new Date(Number(ts));
        if (isNaN(d.getTime())) return '';
        return `${schedPad(d.getMonth() + 1)}-${schedPad(d.getDate())} ${schedPad(d.getHours())}:${schedPad(d.getMinutes())}`;
    }
    function schedDoneMap() { try { return GM_getValue(SCHED_DONE_KEY, {}) || {}; } catch (e) { return {}; } }
    function schedSetDone(id, done) {
        const m = schedDoneMap();
        if (done) m[String(id)] = 1; else delete m[String(id)];
        try { GM_setValue(SCHED_DONE_KEY, m); } catch (e) {}
    }
    /* 勾选状态跟着列表一起清理：已过期的条目不留在本地存储里 */
    function schedPruneDone(items) {
        const m = schedDoneMap();
        const alive = new Set((items || []).map(it => String(it.id)));
        let changed = false;
        for (const k in m) { if (!alive.has(k)) { delete m[k]; changed = true; } }
        if (changed) { try { GM_setValue(SCHED_DONE_KEY, m); } catch (e) {} }
    }
    /* 本地缓存：把上次成功拉取的日程存进脚本存储，换页面 / 重开浏览器都能先看到，
       不用每次都先登录优学院。缓存只存展示所需字段，最多保留 200 条。 */
    function schedCacheRead() {
        try {
            const c = GM_getValue(SCHED_CACHE_KEY, null);
            if (!c || !Array.isArray(c.items)) return null;
            return { at: Number(c.at) || 0, items: c.items };
        } catch (e) { return null; }
    }
    function schedCacheWrite(items) {
        try {
            const slim = (items || []).slice(0, SCHED_CACHE_MAX).map(it => ({
                id: String(it.id), title: it.title, courseName: it.courseName || '',
                begin: Number(it.begin) || 0, end: Number(it.end) || 0,
                t: Number(it.t) || 0, sortT: Number(it.sortT) || 0,
            }));
            GM_setValue(SCHED_CACHE_KEY, { at: Date.now(), items: slim });
        } catch (e) {}
    }
    /** 把接口返回的原始活动列表归一化成「近七天日程项」（纯函数，便于回归测试） */
    function schedNormalize(list, now) {
        now = Number(now) || Date.now();
        const winEnd = now + SCHED_WINDOW_DAYS * 86400000;
        const out = [], seen = new Set();
        if (!Array.isArray(list)) return out;
        for (const it of list) {
            if (!it || typeof it !== 'object') continue;
            const title = String(it.title || it.name || '').trim();
            if (!title) continue;
            const begin = Number(it.beginTime != null ? it.beginTime : (it.startTime != null ? it.startTime : it.startTs)) || 0;
            const finish = Number(it.endTime != null ? it.endTime : (it.dueTime != null ? it.dueTime : (it.deadline != null ? it.deadline : it.endTs))) || 0;
            const t = finish || begin;                 // 过期判定用「截止时间」，只有开始时间时用开始时间
            if (!t) continue;
            if (t < now) continue;                     // 已过期 → 自动清理
            if (t > winEnd) continue;                  // 超出近七天
            const rawId = it.activityId != null ? it.activityId : it.id;
            const id = rawId != null ? String(rawId) : `${title}|${t}`;
            if (seen.has(id)) continue;
            seen.add(id);
            out.push({ id, title, courseName: String(it.courseName || '').trim(), begin, end: finish, t, sortT: (begin && begin > now) ? begin : t });
        }
        out.sort((a, b) => a.sortT - b.sortT);
        return out;
    }
    /** 过期自动清理：只留下截止/开始时间还没到的项 */
    function schedPrune(items, now) {
        now = Number(now) || Date.now();
        return (Array.isArray(items) ? items : []).filter(it => it && it.t > now);
    }
    function schedRenderStatus(text, isError) {
        const st = document.getElementById('dgut-sched-status');
        if (!st) return;
        if (isError) st.innerHTML = `<span style="color:var(--dgut-error);">${escapeHtml(text)}</span>`;
        else st.textContent = text;
    }
    async function schedFetch(force) {
        if (gSchedLoading) return;
        if (!force && gSchedItems && Date.now() - gSchedFetchedAt < SCHED_REFRESH_MS) { renderScheduleList(); return; }
        /* 任意窗口都能刷新：缓存存在时用已授权的 Cookie 取 Token 直接联网；
           从未缓存过时才要求先在优学院页面打开一次 */
        if (!force && !gSchedCacheAt && !(gSchedItems || []).length) {
            gSchedError = '暂无本地缓存：请先在优学院页面打开一次「近七天日程」，之后即可直接查看。';
            renderScheduleList();
            return;
        }
        gSchedLoading = true; gSchedError = '';
        schedRenderStatus((gSchedItems || []).length ? '正在刷新…' : '正在读取日程…');
        try {
            const now = new Date();
            const start = schedDateStr(now);
            const stop = schedDateStr(new Date(now.getTime() + SCHED_WINDOW_DAYS * 86400000));
            const res = await gmFetchEx(`${API_HOST}/courseapi/activitycalendar?startDate=${start}&endDate=${stop}&lang=zh`);
            const raw = (res && (res.activityList || res.result || res.list || (res.data && (res.data.list || res.data.items)))) || [];
            if (!Array.isArray(raw)) throw new Error('接口返回结构异常：' + apiRaw(res));
            gSchedItems = schedNormalize(raw, Date.now());
            gSchedFetchedAt = Date.now();
            gSchedFromCache = false;
            gSchedCacheAt = gSchedFetchedAt;
            schedCacheWrite(gSchedItems);
            schedPruneDone(gSchedItems);
        } catch (e) {
            const msg = (e && e.message) || e;
            if ((gSchedItems || []).length && /Token|登录|E1131|E1132/.test(msg)) {
                /* 未登录 / 授权未通过：安静地继续显示缓存，不弹刺眼错误 */
                gSchedError = '';
                gSchedFromCache = true;
            } else {
                gSchedError = (gSchedItems || []).length ? '刷新失败（显示本地缓存）：' + msg : '读取日程失败：' + msg;
            }
        } finally {
            gSchedLoading = false;
            renderScheduleList();
        }
    }
    function renderScheduleList() {
        const box = document.getElementById('dgut-sched-list');
        const now = Date.now();
        gSchedItems = schedPrune(gSchedItems || [], now);       // 过期自动清理（内存）
        const done = schedDoneMap();
        if (gSchedLoading) schedRenderStatus('正在刷新…');
        else if (gSchedError) schedRenderStatus(gSchedError, true);
        else if (gSchedFromCache) schedRenderStatus(`本地缓存 · 更新于 ${schedFmtTime(gSchedCacheAt)}`);
        else schedRenderStatus(`共 ${gSchedItems.length} 项 · 更新于 ${new Date(gSchedFetchedAt || now).toLocaleTimeString('zh-CN')}`);
        if (!box) return;
        if (!gSchedItems.length) {
            box.innerHTML = `<div style="text-align:center;color:var(--dgut-on-surface-variant);padding:18px 8px;font-size:13px;">${gSchedError ? '读取失败，可点上方「刷新」重试。' : '近七天暂无日程（或已全部过期）。'}</div>`;
            return;
        }
        box.innerHTML = gSchedItems.map(it => {
            const isDone = !!done[String(it.id)];
            let when;
            if (it.begin && it.begin > now + 60000) when = '开始 ' + schedFmtTime(it.begin);
            else if (it.end) when = '截止 ' + schedFmtTime(it.end);
            else when = schedFmtTime(it.t);
            return `<div class="dgut-sched-item${isDone ? ' is-done' : ''}" data-id="${escapeHtml(it.id)}">
                <label>
                    <input type="checkbox" data-sid="${escapeHtml(it.id)}" ${isDone ? 'checked' : ''}>
                    <span class="dgut-sched-main">
                        <span class="dgut-sched-line"><span class="dgut-sched-time">${escapeHtml(when)}</span><span class="dgut-sched-title">${escapeHtml(it.title)}</span></span>
                        ${it.courseName ? `<span class="dgut-sched-sub">${escapeHtml(it.courseName)}</span>` : ''}
                    </span>
                </label>
            </div>`;
        }).join('');
        box.querySelectorAll('input[data-sid]').forEach(cb => {
            cb.onchange = () => {
                const id = cb.dataset.sid;
                schedSetDone(id, cb.checked);
                const row = cb.closest('.dgut-sched-item');
                if (row) row.classList.toggle('is-done', cb.checked);
            };
        });
        schedPruneDone(gSchedItems);
    }
    function schedStopTicker() { if (gSchedTimer) { clearInterval(gSchedTimer); gSchedTimer = null; } }
    function schedStartTicker() {
        schedStopTicker();
        gSchedTimer = setInterval(() => {
            /* 离开日程页/关闭面板后自动停止，不做后台轮询 */
            if (typeof gActionName !== 'undefined' && gActionName !== 'schedule') { schedStopTicker(); return; }
            if (!document.getElementById('dgut-sched-list')) { schedStopTicker(); return; }
            const before = (gSchedItems || []).length;
            gSchedItems = schedPrune(gSchedItems || [], Date.now());
            if (gSchedItems.length !== before) renderScheduleList();   // 有项过期：立即从列表移除
            schedPruneDone(gSchedItems);
        }, 60000);
    }
    function renderScheduleView(ac) {
        ac.innerHTML = actionHeader(ACTION_TITLES.schedule) + `
            <div class="dgut-card dgut-card--tight">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
                    <div id="dgut-sched-status" style="font-size:12px;color:var(--dgut-on-surface-variant);min-width:0;"></div>
                    <button id="dgut-sched-refresh" class="dgut-btn" style="flex:none;">${icons.refresh} 刷新</button>
                </div>
                <div id="dgut-sched-list" class="dgut-sched-list"></div>
            </div>`;
        ac.querySelector('#dgut-sched-refresh').onclick = () => { gSchedFetchedAt = 0; gSchedFromCache = false; schedFetch(true); };
        /* 首次打开先读本地缓存，立即可见；随后在优学院页面上再尝试刷新 */
        if (!gSchedItems) {
            const c = schedCacheRead();
            if (c) {
                gSchedItems = schedPrune(c.items, Date.now());
                gSchedCacheAt = c.at;
                gSchedFetchedAt = c.at;
                gSchedFromCache = true;
            }
        }
        renderScheduleList();
        schedStartTicker();
        schedFetch(false);
    }
    /* ============================================================
     * 刷课助手（唯一实现：pg* 内核）
     *   1) 答案接口是「真异步」：await GM_xmlhttpRequest，绝不再同步取异步结果
     *   2) 自动答题 / 自动翻页 两个开关真实生效
     *   3) 取不到答案 → 不提交、不空交，按轮次重试
     *   4) 视频卡死/加载失败检测 + 分级恢复（重播 → 重建 → 重进页面 → 刷新）
     *   5) 任务代次（epoch）作废过期计划，杜绝重复提交与提前翻页
     *   6) 专题末页从目录寻找下一个未完成页面
     * ============================================================ */
    const DEFAULT_COURSE_HELPER = { enabled: false, rate: 6, autoAnswer: true, autoNext: true, collectBank: true };
    let gCourseHelper = null;
    const pgSleep = (ms) => new Promise(r => setTimeout(r, ms));

    const PG_TICK_MS = 1500;                 // 主循环间隔
    const PG_PAGE_DWELL_MS = 2000;           // 换页后最短停留，避免误判
    const PG_ADVANCE_COOLDOWN_MS = 2500;     // 两次翻页最短间隔
    const PG_SAME_PAGE_GUARD_MS = 10000;     // 同一页重复翻页保护
    const PG_STALL_MS = 12000;               // 播放停滞判定阈值
    const PG_HEALTHY_MS = 20000;             // 连续正常播放多久才重置恢复计数
    const PG_MAX_RECOVER_STEPS = 4;          // 恢复阶梯步数（4=刷新页面）
    const PG_MAX_NO_ANSWER_ROUNDS = 40;      // 取不到答案的重试轮次上限
    const PG_NO_ANSWER_BUDGET_MS = 90000;    // 同一页最多重试时长（给慢接口/慢渲染留足时间）
    const PG_SKIP_TTL_MS = 30 * 60 * 1000;   // 跳过页面的记忆时长
    const PG_ANSWER_TTL_MS = 5 * 60 * 1000;  // 答案缓存时长
    /* ---- 「跳过中间视频」修复相关（2026-10）----
     * 课件换页后，新页的 <video> 是异步渲染出来的；在这之前 DOM 里可能还留着
     * 上一页已经播完的 <video>。旧逻辑只看「当前 DOM 的 video 是不是都播完了」，
     * 于是换页 2~3 秒后就误判「本页已完成」再点一次下一页 —— 中间的视频整段被跳过。
     * 现在：只把「属于当前页」的 video 当成本页内容，并给媒体出现留足等待时间。 */
    const PG_MEDIA_APPEAR_MS = 20000;        // 换页后等待「本页自己的视频」出现的最长时间
    const PG_MEDIA_GRACE_MS = 8000;          // 换页后至少多久内不判定「本页无视频」
    /* ---- 参考实现（优学院自动静音播放…v1.6.9，公认不跳页）的两个关键做法 ---- */
    const PG_AFTER_ADVANCE_SETTLE_MS = 4000; // 翻页后静默期：它用 1s + 3s 的等待链，期间不评估新页
    const PG_LABEL_STUCK_MS = 45000;         // 站点长时间不把视频标记为 finished 时的兜底放行时间
    /* ---- 换页瞬间 play() 被拒（AbortError）的有界重试 ---- */
    const PG_PLAY_RETRY_MAX = 8;             // 最多重试次数
    const PG_PLAY_RETRY_MS = 400;            // 每次重试间隔

    function isCoursePage() { return /learnCourse/i.test(location.pathname) || /learnCourse/i.test(location.href); }
    function getCourseHelperConfig() { return Object.assign({}, DEFAULT_COURSE_HELPER, GM_getValue(COURSE_HELPER_KEY, {}) || {}); }
    function saveCourseHelperConfig(patch) { GM_setValue(COURSE_HELPER_KEY, Object.assign(getCourseHelperConfig(), patch)); }
    function pgVisible(el) { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
    function pgReText(text) { return String(text || '').replace(/<\/?.+?\/?>/g, '').replace(/[\t\n\r]/g, '').replace(/&.*?;/g, '').trim(); }
    /* 模拟一次点击。
       关键修复（跳过中间视频的真正原因）：
         旧实现先 dispatchEvent('click')、再 el.click()，等于把 click 处理函数调用两次
         （已用假元素实测：只派发=1 次、只 .click()=1 次、两者都做=2 次）。
         「下一页」按钮 .next-page-btn 是静态常驻元素，绑定 click: goNextPage，
         于是每次翻页 goNextPage 被调用两遍 → 连翻两页，中间那页的视频整段被跳过。
         这与完成判定无关，所以之前改判定逻辑完全没用。
         参考实现 v1.6.9 只调用一次 n.click()。
         现在保证 click 只触发一次（mousedown/mouseup 仍照发，部分站点依赖它们）。 */
    function pgTriggerMouseSequence(el) {
        if (!el) { dbg('click', '目标为空，忽略本次点击'); return; }
        if (dbgOn()) dbgHot('click', '模拟点击 → ' + pgElDesc(el));
        ['mousedown', 'mouseup'].forEach(n => { try { el.dispatchEvent(new Event(n, { bubbles: true, cancelable: true })); } catch (e) { dbgErr('click', n + ' 派发失败: ' + ((e && e.message) || e)); } });
        try {
            if (typeof el.click === 'function') { el.click(); dbg('click', 'click() 已调用一次（单次触发，不会连翻）'); }
            else { el.dispatchEvent(new Event('click', { bubbles: true, cancelable: true })); dbg('click', '该元素无 click()，改为派发 click 事件'); }
        } catch (e) { dbgErr('click', 'click() 失败: ' + ((e && e.message) || e)); }
    }
    function pgLog(tag, message, detail) { try { if (typeof debugLog === 'function') debugLog(tag, message, detail); } catch (e) {} }

    /* ============================================================
     * 详细调试日志（dbg）
     * ------------------------------------------------------------
     * 用途：排查「反馈者那里跳页、我这儿正常」这类复现不了的问题。
     * 打开「刷课 → 详细调试日志」后，决策链路里**每一个分支**、
     * **每一个 try/catch** 都会往面板日志框打一行：
     *   dbg()    普通行（灰）
     *   dbgHot() 重点行（**标红加粗带底色**）：每个决策与每次翻页
     *   dbgErr() 异常行（**标红加粗**）
     * 默认关闭；dist/理工小助手-调试版.js 会强制打开。
     * ============================================================ */
    let gDbgCache = null, gDbgCacheAt = 0;
    function dbgOn() {
        const now = Date.now();
        if (gDbgCache === null || now - gDbgCacheAt > 1000) {
            try { gDbgCache = GM_getValue(DBG_KEY, false) === true; } catch (e) { gDbgCache = false; }
            gDbgCacheAt = now;
        }
        return gDbgCache;
    }
    function dbgSet(on) {
        gDbgCache = !!on; gDbgCacheAt = Date.now();
        try { GM_setValue(DBG_KEY, !!on); } catch (e) {}
    }
    function dbgFmt(v) {
        try {
            if (v === undefined) return 'undefined';
            if (v === null) return 'null';
            if (typeof v === 'number' || typeof v === 'boolean') return String(v);
            if (typeof v === 'string') return JSON.stringify(v.length > 60 ? v.slice(0, 60) + '…' : v);
            if (Array.isArray(v)) return '[' + v.length + ' 项' + (v.length && v.length <= 8 ? ': ' + v.join(',') : '') + ']';
            if (typeof v === 'object') return '{' + Object.keys(v).slice(0, 6).join(',') + '}';
            return String(v);
        } catch (e) { return '?'; }
    }
    function dbg(section, msg) { if (dbgOn()) chLog('〔' + section + '〕' + msg, 'muted'); }
    function dbgHot(section, msg) { if (dbgOn()) chLog('〔' + section + '〕▼ ' + msg, 'hot'); }
    function dbgErr(section, msg) { if (dbgOn()) chLog('〔' + section + '〕FAIL ' + msg, 'error'); }
    /** 给可能抛错的代码加调试：返回值与异常都记账；关闭调试时行为与原来完全一致 */
    function dbgTry(section, label, fn) {
        if (!dbgOn()) { try { return fn(); } catch (e) { return undefined; } }
        try { const r = fn(); dbg(section, label + ' → 正常返回 ' + dbgFmt(r)); return r; }
        catch (e) { dbgErr(section, label + ' → 抛错: ' + ((e && e.message) || e)); return undefined; }
    }
    /** 元素的可读描述，用于日志 */
    function pgElDesc(el) {
        try {
            if (!el || !el.tagName) return String(el);
            const id = el.id ? '#' + el.id : '';
            let cls = '';
            if (typeof el.className === 'string' && el.className) {
                cls = '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
            }
            const txt = typeof pgReText === 'function' ? pgReText(el.textContent || '').slice(0, 18) : '';
            return el.tagName.toLowerCase() + id + cls + (txt ? ' 「' + txt + '」' : '');
        } catch (e) { return '?'; }
    }
    /* 运行日志：内存 + GM 双备份，关闭/重开面板、切换视图、刷新页面后都不会丢 */
    const CH_LOG_MAX = 400;
    const CH_LOG_KEY = 'dgut_course_log';
    let gChLogLines = null;
    let gChLogSaveTimer = null;
    function chLogBuffer() {
        if (!gChLogLines) {
            try {
                const saved = GM_getValue(CH_LOG_KEY, null);
                gChLogLines = Array.isArray(saved) ? saved.slice(-CH_LOG_MAX) : [];
            } catch (e) { gChLogLines = []; }
        }
        return gChLogLines;
    }
    function chLogLineEl(rec) {
        const div = document.createElement('div');
        div.className = `dgut-log-line log-${(rec && rec.level) || 'info'}`;
        div.textContent = `[${(rec && rec.t) || ''}] ${(rec && rec.text) || ''}`;
        return div;
    }
    function chLogSave() {
        if (gChLogSaveTimer) return;
        gChLogSaveTimer = setTimeout(() => {
            gChLogSaveTimer = null;
            try { GM_setValue(CH_LOG_KEY, chLogBuffer().slice(-CH_LOG_MAX)); } catch (e) {}
        }, 500);
    }
    /* 视图（重新）渲染后把历史日志补回 DOM —— 修复「关掉面板再打开日志消失」 */
    function chLogRestore() {
        const el = document.getElementById('dgut-ch-log');
        if (!el) return;
        while (el.firstChild) el.removeChild(el.firstChild);
        chLogBuffer().forEach(rec => el.appendChild(chLogLineEl(rec)));
        el.scrollTop = el.scrollHeight;
    }
    function chLogClear() {
        gChLogLines = [];
        try { GM_setValue(CH_LOG_KEY, []); } catch (e) {}
        const el = document.getElementById('dgut-ch-log');
        if (el) while (el.firstChild) el.removeChild(el.firstChild);
    }
    function chLog(text, level = 'info') {
        const rec = { t: new Date().toLocaleTimeString('zh-CN'), text: String(text), level: level || 'info' };
        const buf = chLogBuffer();
        buf.push(rec);
        while (buf.length > CH_LOG_MAX) buf.shift();
        const el = document.getElementById('dgut-ch-log');
        if (el) {
            el.appendChild(chLogLineEl(rec));
            while (el.childElementCount > CH_LOG_MAX) el.removeChild(el.firstChild);
            el.scrollTop = el.scrollHeight;
        }
        chLogSave();
        log('[刷课]', text);
    }
    function pgRequestJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: 15000,
                onload: (res) => {
                    /* 修复：旧实现只拦 401/403，其它 4xx/5xx 只要响应体是 JSON 就会被当成
                       答案返回，错误信息会被当成「答案列表」参与后续解析。现在统一拦下。 */
                    let parsed = null;
                    try { parsed = JSON.parse(res.responseText); } catch (e) {}
                    if (res.status === 401 || res.status === 403) {
                        const why = parsed ? apiMessage(parsed) : '';
                        return reject(new Error(errFull(ERR.API_AUTH_FAIL, 'HTTP ' + res.status + (why ? '：' + why : ''))));
                    }
                    if (res.status >= 400) {
                        const why = parsed ? apiMessage(parsed) : '';
                        return reject(new Error(errFull(ERR.API_HTTP_ERR, 'HTTP ' + res.status + (why ? '：' + why : ''))));
                    }
                    if (parsed === null) return reject(new Error(errFull(ERR.API_PARSE_FAIL)));
                    return resolve(parsed);
                },
                onerror: () => reject(new Error(errFull(ERR.API_NET_FAIL))),
                ontimeout: () => reject(new Error(errFull(ERR.API_TIMEOUT)))
            });
        });
    }

    /* ---------------- 答案缓存（接口答案复用，减少网络抖动影响） ---------------- */
    const pgAnswerCache = new Map();
    function pgAnswerCacheGet(qid) {
        const key = String(qid || ''); if (!key) return null;
        const rec = pgAnswerCache.get(key);
        if (!rec) return null;
        if (Date.now() - rec.t > PG_ANSWER_TTL_MS) { pgAnswerCache.delete(key); return null; }
        return rec.v.slice();
    }
    function pgAnswerCacheSet(qid, list) {
        const key = String(qid || '');
        if (!key || !Array.isArray(list) || !list.length) return;
        pgAnswerCache.set(key, { v: list.map(String), t: Date.now() });
        if (pgAnswerCache.size > 500) { const first = pgAnswerCache.keys().next().value; pgAnswerCache.delete(first); }
    }

    /* ============================================================
     * 倍速守卫（realm-safe 版 · 2026-10 修复「倍速设置不生效」）
     * ------------------------------------------------------------
     * 旧实现（错误）：
     *     1) 用 Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'playbackRate')
     *        取原生 descriptor；
     *     2) 再用 Object.defineProperty(v,'playbackRate',{get/set}) 在视频元素上装自己的
     *        own accessor；
     *     3) 所有读写都走 nativeDescriptor.get.call(v) / nativeDescriptor.set.call(v)。
     *   这套「跨 realm 的 descriptor 调用」在真实 Tampermonkey 沙箱里可能被代理成
     *   读回 NaN/undefined 的 getter。此时 `Math.abs(NaN - target) > 0.01` 恒为 false，
     *   于是 enforce 与 pgLogic 都会**静默跳过 set** —— 不抛错、日志也正常，
     *   表现正是用户现场看到的「面板 15×、debug 日志 video 一直在播放，
     *   但 currentTime 33s→83s 用了 52 秒墙钟（≈1×）」。
     *
     * 现在：彻底去掉 descriptor / defineProperty，改成**纯属性读写**
     *   （与参考实现 v1.6.9 的 `ele.playbackRate = N` 一致，任何 realm 下都成立）。
     *   读取失败时按 0 处理，保证 Math.abs(0 - target) > 0.01 一定成立 → 一定会 set，
     *   绝不会再出现「静默跳过」。
     *   站点把倍速改回去时，靠 ratechange + loadedmetadata + canplay + playing
     *   四个事件监听 + 周期 enforce 一起兜住（站点 mediaelement 的 speed 插件
     *   会在每次 loadedmetadata 时把 playbackRate 重置回它菜单里的 1.00x）。
     *   WeakSet 只用来避免重复 addEventListener，不再参与 descriptor。
     * ============================================================ */
    /* 页面世界（unsafeWindow）里的 <video>：某些油猴沙箱里「对沙箱侧元素赋值 playbackRate」
       只会改到包装器、改不到真实媒体（页面控制台一直读回 1x 正是这种）。
       这里提供一条「页面世界句柄」回退路径，并把设置后的读回值写进日志，便于现场定位。 */
    function pgPageVideoList() {
        try {
            if (typeof PAGE_WIN !== 'undefined' && PAGE_WIN && PAGE_WIN.document) {
                const l = PAGE_WIN.document.querySelectorAll('video');
                if (l && l.length) return Array.prototype.slice.call(l);
            }
        } catch (e) {}
        try { return Array.from(document.querySelectorAll('video')); } catch (e) { return []; }
    }
    function pgVideoDocIndex(v) {
        try { return Array.prototype.indexOf.call(document.querySelectorAll('video'), v); } catch (e) { return -1; }
    }
    function pgRateClamp(v) { const n = Number(v); return Math.max(1, Math.min(16, isFinite(n) && n > 0 ? n : 6)); }
    const pgRateGuard = {
        target: 6, active: false, hooked: new WeakSet(),
        resetHistory: [], learnedInterval: 600, timer: null, lastDiagKey: '', lastDiagAt: 0,
        init() { this.target = pgRateClamp(getCourseHelperConfig().rate); },
        refresh() { this.target = pgRateClamp(getCourseHelperConfig().rate); },
        start() { this.init(); this.active = true; this.resetHistory = []; this.hookAll(); if (this.timer) clearTimeout(this.timer); this.scheduleNext(); },
        stop() { this.active = false; if (this.timer) { clearTimeout(this.timer); this.timer = null; } },
        /* 纯属性读写：不做 descriptor，任何 realm / 沙箱下都成立。
           读不到/不是有限数 → 返回 0，这样「与 target 的差」必然 > 0.01，一定会触发 set。 */
        get(v) { try { const r = Number(v && v.playbackRate); return isFinite(r) ? r : 0; } catch (e) { return 0; } },
        /* 设置倍速：先走沙箱侧赋值；读回不一致时用页面世界句柄再设一次。
           返回 { ok, pageSet }：ok=沙箱侧赋值是否真的落到媒体上，pageSet=是否用了页面世界回退。 */
        set(v, r) {
            let ok = false;
            try { if (v) v.playbackRate = r; ok = Math.abs(this.get(v) - r) <= 0.01; } catch (e) { ok = false; }
            let pageSet = false;
            if (!ok) {
                try {
                    const i = pgVideoDocIndex(v);
                    const l = pgPageVideoList();
                    const pv = i >= 0 ? l[i] : null;
                    if (pv && pv !== v) { pv.playbackRate = r; pageSet = true; }
                } catch (e) {}
            }
            return { ok: ok, pageSet: pageSet };
        },
        hookAll() { document.querySelectorAll('video').forEach(v => this.hook(v)); },
        hook(v) {
            if (!v || this.hooked.has(v)) return;
            this.hooked.add(v);
            const self = this;
            /* 站点重置倍速的时机：ratechange（直接改）、loadedmetadata（speed 插件
               每次加载都会重置回 1.00x）、canplay/playing（播放器就绪后站点再改一次）。
               任何一个触发都立刻把倍速改回 target，补上原来 5ms~600ms 的空窗。 */
            ['ratechange', 'loadedmetadata', 'canplay', 'playing'].forEach(n => {
                try { v.addEventListener(n, () => { if (self.active) self.applyTo(v, n); }); } catch (e) {}
            });
        },
        applyTo(v, why) {
            if (!v) return;
            this.refresh();
            const t = this.target;
            if (Math.abs(this.get(v) - t) > 0.01) {
                this.recordReset();
                const r = this.set(v, t);
                const real = this.get(v);
                let pageReal = null;
                try {
                    const i = pgVideoDocIndex(v);
                    const l = pgPageVideoList();
                    const pv = i >= 0 ? l[i] : null;
                    const n = Number(pv && pv.playbackRate);
                    if (isFinite(n)) pageReal = n;
                } catch (e) {}
                const want = why || '定时检查';
                const fixed = pageReal !== null && Math.abs(pageReal - t) <= 0.01;
                if (!r.ok || (pageReal !== null && !fixed)) {
                    /* 沙箱侧赋值没落到真实媒体上：只在状态变化或每 30s 提示一次，避免刷屏 */
                    const key = t + '|' + want + '|' + (r.ok ? '1' : '0') + '|' + (pageReal === null ? 'null' : Math.round(pageReal * 100));
                    const now = Date.now();
                    if (key !== this.lastDiagKey || now - this.lastDiagAt > 30000) {
                        this.lastDiagKey = key; this.lastDiagAt = now;
                        try {
                            if (typeof chLog === 'function') {
                                chLog('倍速守卫：设置 ' + t + 'x 后沙箱读回 ' + real + 'x' + (pageReal !== null ? '，页面世界读回 ' + pageReal + 'x' : '') + (fixed ? '（已用页面世界句柄修正）' : '（仍未生效，可能被站点限速/覆盖）'), 'warn');
                            }
                        } catch (e) {}
                    }
                } else {
                    try { if (typeof chLog === 'function') chLog('倍速守卫：把播放速率重设为 ' + t + 'x（触发：' + want + '）', 'muted'); } catch (e) {}
                    try { if (typeof dbgHot === 'function') dbgHot('倍速', '重设 playbackRate=' + t + '（触发：' + want + '）'); } catch (e) {}
                }
            }
            this.syncSpeedBtn(v, t);
        },
        /* 倍速菜单文字同步（按该 video 在全文档中的序号取，避免残留旧播放器时错位） */
        syncSpeedBtn(v, t) {
            if (v === undefined) t = this.target;
            try {
                const list = document.querySelectorAll('video');
                const idx = v ? Array.prototype.indexOf.call(list, v) : 0;
                const speedBtn = document.querySelectorAll('.mejs__button.mejs__speed-button button')[idx];
                if (speedBtn && speedBtn.textContent !== t + 'x') speedBtn.textContent = t + 'x';
            } catch (e) {}
        },
        recordReset() {
            this.resetHistory.push(Date.now()); if (this.resetHistory.length > 20) this.resetHistory.shift();
            if (this.resetHistory.length >= 3) {
                const intervals = []; for (let i = 1; i < this.resetHistory.length; i++) intervals.push(this.resetHistory[i] - this.resetHistory[i - 1]);
                intervals.sort((a, b) => a - b); const median = intervals[Math.floor(intervals.length / 2)];
                if (median > 100 && median < 30000) this.learnedInterval = Math.min(800, Math.max(200, median - 50));
            }
        },
        scheduleNext() {
            if (!this.active) return;
            this.timer = setTimeout(() => { this.enforce(); this.scheduleNext(); }, this.learnedInterval);
        },
        enforce() {
            if (!this.active) return;
            try {
                this.refresh(); this.hookAll();
                document.querySelectorAll('video').forEach(v => this.applyTo(v, '定时检查'));
            } catch (e) {
                try { if (typeof dbgErr === 'function') dbgErr('倍速', 'enforce 异常: ' + ((e && e.message) || e)); } catch (e2) {}
            }
        }
    };

    function pgGetQuestionComponentVM(node) {
        try {
            const ko = PAGE_WIN.ko;
            let n = node.querySelector('.question-wrapper') || node;
            while (n) {
                const ctx = ko && ko.contextFor ? ko.contextFor(n) : null;
                if (ctx && ctx.$component && typeof ctx.$component.submitQuestion === 'function') return ctx.$component;
                n = n.parentElement;
            }
        } catch (e) {}
        return null;
    }
    function pgGetQuestionModel(node) {
        try {
            const ko = PAGE_WIN.ko;
            if (!ko) return null;
            let n = node.querySelector('.question-wrapper') || node;
            while (n) {
                const ctx = ko.contextFor ? ko.contextFor(n) : null;
                if (ctx) {
                    let q = (ctx.$component && ctx.$component.question) || (ctx.$data && ctx.$data.question);
                    if (!q && Array.isArray(ctx.$parents)) { for (const p of ctx.$parents) { if (p && p.question) { q = p.question; break; } } }
                    if (q && typeof q.type === 'function') return q;
                }
                n = n.parentElement;
            }
        } catch (e) {}
        return null;
    }
    function pgVmAnswer(node) {
        const q = pgGetQuestionModel(node);
        if (!q || typeof q.correctAnswer !== 'function') return null;
        try {
            const ans = q.correctAnswer();
            if (Array.isArray(ans) && ans.length) return ans.map(String);
            if (typeof ans === 'string' && ans.trim()) return ans.trim().split(/[,\s|，、]+/).filter(Boolean);
            if (typeof ans === 'boolean') return [ans ? 'true' : 'false'];
        } catch (e) {}
        return null;
    }
    function pgBank() { return GM_getValue(BANK_KEY, []) || []; }
    function pgQuestionId(node) {
        const idAttr = (node.querySelector('.question-wrapper') || node).getAttribute('id') || '';
        return idAttr.startsWith('question') ? idAttr.substring(8) : idAttr;
    }
    function pgBankAnswer(node) {
        const qid = pgQuestionId(node);
        if (!qid) return null;
        const rec = pgBank().find(r => String(r.qid) === String(qid));
        return rec && rec.answer ? String(rec.answer).split(/[,\s|，、]+/).filter(Boolean) : null;
    }
    /* 真异步：内部 await，调用方拿到的就是最终结果，不再出现「同步取异步」 */
    async function pgRemoteAnswer(node) {
        const qid = pgQuestionId(node);
        if (!qid) return null;
        const cached = pgAnswerCacheGet(qid);
        if (cached) return cached;
        const parentIdAttr = document.querySelector('.page-name.active')?.parentElement?.getAttribute('id') || '';
        const parentId = parentIdAttr.length > 4 ? parentIdAttr.substring(4) : '';
        const host = location.hostname.includes('dgut.edu.cn') ? 'https://ua.dgut.edu.cn' : 'https://api.ulearning.cn';
        try {
            const data = await pgRequestJson(`${host}/uaapi/questionAnswer/${qid}?parentId=${parentId}`);
            const list = (data && Array.isArray(data.correctAnswerList) ? data.correctAnswerList : []).map(String).filter(Boolean);
            if (list.length) { pgAnswerCacheSet(qid, list); return list; }
        } catch (e) { pgLog('AnswerAPI', '取答案失败：' + (e && e.message ? e.message : e)); }
        return null;
    }
    function pgResolveType(node, tag, answerLen) {
        const t = String(tag || '');
        if (node.querySelector('.blank-input')) return '填空题';
        if (node.querySelector('.cloze-input')) return '选词填空';
        if (node.querySelector('.answer-blank')) return '排序题';
        if (node.querySelector('.choice-btn.right-btn') || node.querySelector('.choice-btn.wrong-btn')) return '判断题';
        if (node.querySelector('.choice-list .choice-item')) {
            if (Number(answerLen) > 1 || /多选|多项|不定项/.test(t)) return '多选题';
            return '单选题';
        }
        if (node.querySelector('.form-control, textarea, [contenteditable="true"]')) {
            if (/简答|问答|论述|分析/.test(t)) return '简答题';
            return '填空题';
        }
        /* 题型标签兜底：样式类名对不上时按文字判断，避免整题被漏掉 */
        if (/判断/.test(t)) return '判断题';
        if (/多选|多项|不定项/.test(t)) return '多选题';
        if (/单选/.test(t)) return '单选题';
        if (/填空|完形/.test(t)) return '填空题';
        if (/简答|问答|论述|分析/.test(t)) return '简答题';
        if (/排序|连线|匹配/.test(t)) return '排序题';
        return t || '未知';
    }
    /* 答案归一化：判断题→true/false；多选题把 "AB" / "A、B" 这类合并写法拆成单个选项 */
    function pgNormalizeAnswers(type, list) {
        const raw = Array.isArray(list) ? list : [list];
        const multi = type === '多选题' || /多选|多项|不定项/.test(String(type || ''));
        const out = [];
        raw.forEach(item => {
            if (item === null || item === undefined) return;
            const s = String(item).trim();
            if (!s) return;
            if (type === '判断题' || /判断/.test(String(type || ''))) {
                const low = s.toLowerCase();
                const yes = low === 'true' || low === 't' || low === 'yes' || low === 'y' || low === 'a' || low === '1'
                    || s === '正确' || s === '对' || s === '是' || s === '√' || s === '✓';
                out.push(yes ? 'true' : 'false');
                return;
            }
            if (multi) {
                if (/^[A-Za-z]{2,}$/.test(s)) { s.split('').forEach(c => out.push(c.toUpperCase())); return; }
                s.split(/[,\s|，、;；/]+/).filter(Boolean).forEach(p => out.push(p.toUpperCase()));
                return;
            }
            if (type === '单选题') { const m = s.toUpperCase().match(/[A-Z]/); out.push(m ? m[0] : s); return; }
            out.push(s);   // 填空/选词/简答/排序：保持原文，不能按空格拆（英文答案本身含空格）
        });
        return out.length ? out : out;
    }
    function pgApplyAnswer(node, type, answers) {
        if (!answers || !answers.length) return false;
        const w = node.querySelector('.question-wrapper') || node;
        if (type === '判断题') {
            const s = String(answers[0]).trim();
            const low = s.toLowerCase();
            const isTrue = low === 'true' || low === 't' || low === 'yes' || low === 'y' || low === 'a' || low === '1'
                || s === '正确' || s === '对' || s === '是' || s === '√' || s === '✓';
            const btn = w.querySelector(isTrue ? '.choice-btn.right-btn' : '.choice-btn.wrong-btn');
            if (btn) { pgTriggerMouseSequence(btn); return true; }
            return false;
        }
        if (type === '单选题' || type === '多选题') {
            const items = Array.from(w.querySelectorAll('.choice-list .choice-item'));
            if (!items.length) return false;
            const idxs = [];
            answers.forEach(a => {
                const m = String(a).toUpperCase().match(/[A-Z]/);
                if (m) { const i = m[0].charCodeAt(0) - 65; if (i >= 0 && i < items.length && idxs.indexOf(i) === -1) idxs.push(i); }
            });
            const target = type === '多选题' ? idxs : (idxs.length ? [idxs[0]] : []);
            if (!target.length) return false;
            target.forEach(i => {
                try { const cb = items[i].querySelector('.checkbox, .radio'); if (cb) cb.classList.add('selected'); } catch (e) {}
                try { items[i].classList.add('selected'); } catch (e) {}
                pgTriggerMouseSequence(items[i]);
            });
            return true;
        }
        if (type === '填空题' || type === '选词填空') {
            const inputs = Array.from(w.querySelectorAll('.blank-input, .cloze-input, .answer-width input, .answer-width, input[type="text"], textarea, [contenteditable="true"]'));
            if (!inputs.length) return false;
            answers.forEach((a, i) => {
                const el = inputs[i]; if (!el) return;
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    el.value = a;
                    try { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
                } else { el.textContent = a; try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
            });
            return true;
        }
        if (type === '简答题') {
            const inputs = Array.from(w.querySelectorAll('.form-control, textarea, [contenteditable="true"]'));
            if (!inputs.length) return false;
            answers.forEach((a, i) => {
                const el = inputs[i]; if (!el) return;
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    el.value = a;
                    try { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
                } else { el.textContent = a; try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
            });
            return true;
        }
        if (type === '排序题') {
            const blanks = Array.from(w.querySelectorAll('.answer-blank'));
            if (!blanks.length) return false;
            answers.forEach((a, i) => { if (blanks[i]) { blanks[i].innerHTML = a; try { blanks[i].dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} } });
            return true;
        }
        return false;
    }
    /* 题型识别不准时的兜底：按序尝试所有填充方式，尽最大可能不把题目漏掉 */
    function pgTryFill(node, type, answers) {
        const tried = {};
        const attempt = (t) => {
            if (!t || tried[t]) return false;
            tried[t] = 1;
            try { return !!pgApplyAnswer(node, t, answers); } catch (e) { return false; }
        };
        if (attempt(type)) return type;
        const order = ['多选题', '单选题', '判断题', '填空题', '选词填空', '简答题', '排序题'];
        for (const t of order) { if (attempt(t)) return t; }
        return '';
    }
    function pgSubmitQuestion(node) {
        const comp = pgGetQuestionComponentVM(node);
        if (comp && typeof comp.submitQuestion === 'function') { try { comp.submitQuestion(); return; } catch (e) {} }
        const btn = node.querySelector('.question-operation-wrapper .btn-submit');
        if (btn) pgTriggerMouseSequence(btn);
    }
    function pgCollectBank() {
        const records = pgBank();
        const map = {};
        records.forEach(r => { if (r && r.qid) map[String(r.qid)] = r; });
        document.querySelectorAll('.question-element-node .question-wrapper').forEach((w, i) => {
            const idAttr = w.getAttribute('id') || '';
            const qid = idAttr.startsWith('question') ? idAttr.substring(8) : idAttr;
            if (!qid) return;
            const rec = {
                qid, sort: pgReText((w.querySelector('.question-sort') || {}).textContent || '') || String(i + 1),
                qType: pgReText((w.querySelector('.question-type-tag') || {}).textContent || ''),
                title: pgReText((w.querySelector('.question-title-html') || {}).textContent || ''),
                options: Array.from(w.querySelectorAll('.choice-list .choice-item')).map(c => pgReText(((c.querySelector('.option') || {}).textContent || '') + ' ' + ((c.querySelector('.text') || {}).textContent || ''))),
                answer: map[qid] ? map[qid].answer : '', updatedAt: new Date().toISOString()
            };
            map[qid] = Object.assign({}, map[qid], rec);
        });
        GM_setValue(BANK_KEY, Object.values(map));
        return Object.values(map).length;
    }
    /* 作答成功后把答案写回题库，下次可直接命中 */
    function pgRememberAnswer(node, answers) {
        try {
            const qid = pgQuestionId(node);
            if (!qid || !answers || !answers.length) return;
            const w = node.querySelector('.question-wrapper') || node;
            const records = pgBank();
            const idx = records.findIndex(r => String(r.qid) === String(qid));
            const patch = {
                qid,
                sort: pgReText((w.querySelector('.question-sort') || {}).textContent || ''),
                qType: pgReText((w.querySelector('.question-type-tag') || {}).textContent || ''),
                title: pgReText((w.querySelector('.question-title-html') || {}).textContent || ''),
                answer: answers.join(','), updatedAt: new Date().toISOString()
            };
            if (idx === -1) records.push(patch); else records[idx] = Object.assign({}, records[idx], patch);
            GM_setValue(BANK_KEY, records);
        } catch (e) {}
    }
    function pgBankHtml(records) {
        const rows = records.map((r, idx) => `<div class="q"><h3>${escapeHtml((r.sort || (idx + 1)) + '. [' + (r.qType || '未知') + '] ' + r.title)}</h3>${r.options && r.options.length ? '<ol type="A">' + r.options.map(o => '<li>' + escapeHtml(String(o).replace(/^[A-Z]\.\s*/, '')) + '</li>').join('') + '</ol>' : ''}<p><b>答案：</b>${escapeHtml(r.answer || '（空）')}</p></div>`).join('');
        return `<!doctype html><html><head><meta charset="utf-8"><title>题库导出</title><style>body{font-family:'Microsoft YaHei',sans-serif;line-height:1.6}.q{border:1px solid #ddd;padding:10px;margin:8px 0;border-radius:6px}</style></head><body><h1>Ulearning 题库导出</h1><div>导出时间：${new Date().toLocaleString()} · 共 ${records.length} 题</div>${rows || '<p>暂无题目</p>'}</body></html>`;
    }
    function pgExportBank() {
        const records = pgBank();
        if (!records.length) { showStatus('题库为空', true); return; }
        const blob = new Blob(['\uFEFF', pgBankHtml(records)], { type: 'application/msword;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `题库_${dateKey()}.doc`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
        showStatus(`题库已导出（${records.length} 题）`);
    }
    function pgClearBank() { GM_setValue(BANK_KEY, []); showStatus('题库已清空'); }

    /* ---------------- 运行状态（任务代次 epoch 用于作废过期计划） ---------------- */
    let gPgAnswering = false, gPgQuestionUntil = 0;
    let gPgLastAdvanceAt = 0;
    let gPgAdvancePageId = '';
    let gPgMediaWaitSince = 0;
    let gPgMediaWaitWarned = false;      // 本页是否已提示过「等本页视频出现」
    let gPgSettleUntil = 0;              // 翻页后的静默截止时间（参考实现用 1s+3s 等待链）
    let gPgLabelStuckSince = 0;          // 站点迟迟不把视频标记 finished 的起始时间
    let gPgSiteMarkLoggedFor = '';       // 已就哪一页打过「站点标记是否可用」的诊断日志
    let gPgPageChangeAt = Date.now();
    let gPgLastPageId = '';
    let gPgEpoch = 0;
    let gPgEndWarned = false;
    let gPgNextWarned = false;
    let gPgAnswerOffWarned = false;
    const gPgSkippedPages = new Map();     // 页面 key -> 跳过时间
    const gPgNoAnswerRounds = new Map();   // 页面 key -> 连续取不到答案的轮次
    const gPgRetrySince = new Map();       // 页面 key -> 本轮重试开始时间

    /* ------------------------------------------------------------------
     * 视频归属标记（修复「跳过中间视频」的核心）
     *
     * 课件正文区是**同一个** .page-element 容器（实测：整页只有 1 个），
     * Knockout 换页时只是重新求值绑定；而 <video> 是由
     *   <div class="video-media-element" data-bind="html: pageElement.content()">
     * 这段绑定注入的。换页瞬间，新页内容还没就绪，DOM 里躺着的是
     * **上一页已经播完的 <video>**（脚本还额外 patch 了 Element.prototype.remove
     * 来阻止站点删掉 video，于是它更不容易消失）。
     *
     * 旧逻辑：`videos = 当前 DOM 里所有 video`，只要它们都 "已播完" 就翻页。
     * 于是换页后 2~3 秒（PG_PAGE_DWELL_MS + PG_ADVANCE_COOLDOWN_MS）就会
     * 因为「上一页那个播完的 video」再点一次下一页，
     * 把新页还没渲染出来的视频整段跳过去 —— 连着跳好几个。
     *
     * 解决办法：记住每个 video 元素属于哪一页，只把属于当前页的当成本页内容。
     * 播放器被复用换源（currentSrc 变了）时重新归属到当前页。
     * ------------------------------------------------------------------ */
    const gPgVideoMark = new WeakMap();     // video -> { page, src }
    function pgVideoOwner(v, pid) {
        if (!v || !pid) return '';
        const src = String(v.currentSrc || v.src || '');
        const rec = gPgVideoMark.get(v);
        if (!rec) { gPgVideoMark.set(v, { page: pid, src }); return pid; }
        if (rec.page !== pid && rec.src !== src) { rec.page = pid; rec.src = src; return pid; }
        return rec.page;
    }

    function pgPageId() {
        const a = document.querySelector('.page-name.active');
        if (!a) return '';
        const sec = a.closest('.section-item');
        const secName = sec ? ((sec.querySelector('.section-name .text') || {}).textContent || '') : '';
        return (secName + '|' + a.textContent).replace(/\s+/g, ' ').trim();
    }
    function pgHasMediaContainer() {
        return document.querySelectorAll('.file-media, .video-element, .video-wrapper, .courseware-video, .video-box, .prism-player, .vjs-tech, .mejs__container').length > 0;
    }
    function pgVideoFinished(v) {
        if (!v) return false;
        const dur = Number(v.duration);
        const rs = (typeof v.readyState === 'number') ? v.readyState : 2;
        if (Number.isFinite(dur) && dur > 0 && rs >= 2 && !v.seeking) { if (v.ended || v.currentTime >= dur - 0.3) return true; }
        try {
            let node = v.parentElement, depth = 0;
            while (node && depth < 8) {
                /* 一旦祖先容器里出现目录项（.page-name），说明已经走出播放器范围了；
                   目录项上的完成标记属于「页面」，不能拿来判断「这个视频播完了」。 */
                if (node.querySelectorAll('.page-name').length) break;
                if (node.querySelectorAll('video').length <= 1) {
                    const spans = node.querySelectorAll("span[data-bind*='i18nMessageText']");
                    for (let k = 0; k < spans.length; k++) {
                        const s = spans[k];
                        const vis = !!(s.offsetWidth || s.offsetHeight || s.getClientRects().length);
                        if (!vis) continue;
                        const bind = s.getAttribute('data-bind') || '';
                        if (bind.indexOf('.finished') !== -1) return true;
                        if (bind.indexOf('.viewed') !== -1 || bind.indexOf('.unviewed') !== -1) return false;
                    }
                }
                node = node.parentElement; depth++;
            }
        } catch (e) {}
        return false;
    }
    /* ------------------------------------------------------------------
     * 站点自己的「每个视频是否看完」标记（关键修复）
     *
     * 来源：参考实现「优学院自动静音播放…v1.6.9」（公认不跳页）用的是
     *   videos        = $('mediaelementwrapper video:first-child')
     *   videos_status = $('.video-bottom span:first-child')
     *   span[data-bind] === 'text: $root.i18nMessageText().finished' → 已看完
     *                     …viewed / …unviewed                       → 没看完
     * 两组数量必须相等，站点标记才可信。
     *
     * 为什么必须用它：换页或播放器复用时，<video> 的 duration / currentTime
     * 会短暂保留上一页的值，单凭 currentTime 判定「已播完」会误判 —— 这正是
     * 之前「跳过中间视频」的直接原因。站点自己的 finished 标记不受此影响。
     * ------------------------------------------------------------------ */
    function pgVideoSiteStatuses() {
        return Array.from(document.querySelectorAll('.video-bottom span:first-child')).map(s => {
            const bind = s.getAttribute('data-bind') || '';
            if (bind.indexOf('.finished') !== -1) return 'finished';
            if (bind.indexOf('.viewed') !== -1 || bind.indexOf('.unviewed') !== -1) return 'unviewed';
            return 'unknown';
        });
    }

    function pgTouchPageDwell() {
        const pid = pgPageId();
        if (!pid) return gPgLastPageId;      // 暂时取不到页名（DOM 抖动）不算换页，避免打断答题
        if (pid !== gPgLastPageId) {
            gPgLastPageId = pid; gPgPageChangeAt = Date.now();
            gPgEpoch++;                 // 页面已切换：作废上一页遗留的异步计划
            gPgQuestionUntil = 0;
            gPgEndWarned = false;
            gPgNextWarned = false;
            /* 换页后必须重新等待本页媒体：不清空这些会沿用上一页的等待状态 */
            gPgMediaWaitSince = 0;
            gPgMediaWaitWarned = false;
            gPgSettleUntil = 0;
            gPgLabelStuckSince = 0;
            gPgNoAnswerRounds.delete(pid);
            gPgRetrySince.delete(pid);
        }
        return pid;
    }
    /* ---------------- 目录（跨专题）翻页 ---------------- */
    function pgCatalogPages() {
        let list = Array.from(document.querySelectorAll('.section-item .page-name'));
        if (!list.length) list = Array.from(document.querySelectorAll('.page-name'));
        return list;
    }
    function pgPageKeyOf(el) {
        if (!el) return '';
        const sec = el.closest ? el.closest('.section-item') : null;
        const secName = sec ? pgReText((sec.querySelector('.section-name .text') || {}).textContent || '') : '';
        return (secName + '|' + (el.textContent || '')).replace(/\s+/g, ' ').trim();
    }
    function pgNextCatalogPage() {
        const pages = pgCatalogPages();
        if (pages.length < 2) return null;
        const cur = pgPageId();
        let idx = pages.findIndex(el => el.classList.contains('active'));
        if (idx === -1 && cur) idx = pages.findIndex(el => pgPageKeyOf(el) === cur);
        if (idx === -1) return null;
        const now = Date.now();
        for (let i = idx + 1; i < pages.length; i++) {
            const key = pgPageKeyOf(pages[i]);
            const at = gPgSkippedPages.get(key);
            if (at && now - at < PG_SKIP_TTL_MS) continue;   // 本会话内已判定跳过
            return pages[i];
        }
        return null;
    }
    function pgClickNext(reason) {
        const now = Date.now();
        const cfg = getCourseHelperConfig();
        pgTouchPageDwell();
        /* 调试（标红）：每一次「翻页」都记下来，并写清是谁发起的、当时的时间戳。
           反馈者日志里如果这里的行数 > 实际页数，就说明确实多翻了。 */
        dbgHot('翻页', '请求翻页。原因="' + (reason || '') + '" | 当前页="' + (pgPageId() || '?') + '" | 距上次翻页=' + (gPgLastAdvanceAt ? (now - gPgLastAdvanceAt) + 'ms' : '从未'));
        if (!cfg.autoNext) {
            if (!gPgNextWarned) { gPgNextWarned = true; chLog('「自动翻页」已关闭：停留当前页，仅播放与答题。', 'muted'); }
            dbg('翻页', '被拦下：自动翻页开关关闭');
            return false;
        }
        gPgNextWarned = false;
        if (now - gPgPageChangeAt < PG_PAGE_DWELL_MS) { dbg('翻页', '被拦下：本页停留时间不足 PG_PAGE_DWELL_MS=' + PG_PAGE_DWELL_MS + 'ms（已经过 ' + (now - gPgPageChangeAt) + 'ms）'); return false; }
        if (now - gPgLastAdvanceAt < PG_ADVANCE_COOLDOWN_MS) { dbg('翻页', '被拦下：距上次翻页不足冷却 PG_ADVANCE_COOLDOWN_MS=' + PG_ADVANCE_COOLDOWN_MS + 'ms（已经过 ' + (now - gPgLastAdvanceAt) + 'ms）'); return false; }
        const pid = pgPageId();
        if (pid && pid === gPgAdvancePageId && now - gPgLastAdvanceAt < PG_SAME_PAGE_GUARD_MS) { dbg('翻页', '被拦下：同一页 ' + pid + ' 的重复翻页保护中（距上次 ' + (now - gPgLastAdvanceAt) + 'ms）'); return false; }
        let btn = document.querySelector('.next-page-btn.cursor');
        dbg('翻页', '查找 .next-page-btn.cursor → ' + (btn ? '命中' : '未命中，回退到所有 .next-page-btn'));
        if (!btn) {
            const all = Array.from(document.querySelectorAll('.next-page-btn'));
            dbg('翻页', '页面里 .next-page-btn 共 ' + all.length + ' 个；可用性: ' + all.map(b => (b.disabled || b.classList.contains('disabled')) ? '禁用' : '可用').join('/'));
            btn = all.find(b => !b.disabled && !b.classList.contains('disabled')) || null;
        }
        if (btn) {
            dbgHot('翻页', 'OK 点击「下一页」按钮 → ' + pgElDesc(btn));
            pgTriggerMouseSequence(btn);
            gPgLastAdvanceAt = now; gPgAdvancePageId = pid;
            gPgSettleUntil = now + PG_AFTER_ADVANCE_SETTLE_MS;   // 翻页后静默期，期间不评估新页
            dbgHot('翻页', '已翻页：静默期 ' + PG_AFTER_ADVANCE_SETTLE_MS + 'ms（到 ' + new Date(gPgSettleUntil).toLocaleTimeString('zh-CN') + '），期间不评估新页');
            return true;
        }
        const nextPage = pgNextCatalogPage();
        dbg('翻页', '页内无「下一页」按钮 → 查目录里的下一节：' + (nextPage ? '找到「' + pgReText(nextPage.textContent) + '」' : '没找到'));
        if (nextPage) {
            chLog('本专题已无「下一页」，从目录跳转到：' + (pgReText(nextPage.textContent) || '下一节'), 'info');
            dbgHot('翻页', 'OK 点击目录项跳转 → ' + pgElDesc(nextPage));
            pgTriggerMouseSequence(nextPage);
            gPgLastAdvanceAt = now; gPgAdvancePageId = pid;
            gPgSettleUntil = now + PG_AFTER_ADVANCE_SETTLE_MS;   // 翻页后静默期
            return true;
        }
        dbg('翻页', '放弃翻页：已是最后一页或没有下一个未完成页面');
        if (!gPgEndWarned) { gPgEndWarned = true; chLog('已是最后一页，未找到下一个未完成页面（' + (reason || '') + '）。', 'warn'); }
        return false;
    }
    function pgDismissModal() {
        const modal = document.querySelector('.modal.fade.in');
        if (!modal || !pgVisible(modal)) {
            if (modal) dbg('弹窗', '发现 .modal.fade.in 但不可见（id=' + (modal.id || '?') + '），忽略');
            return false;
        }
        const id = modal.id;
        dbgHot('弹窗', '检测到可见弹窗 id="' + id + '" → 点击关闭/继续按钮（这会推进页面！）');
        if (id === 'statModal') { const b = modal.querySelectorAll('.btn-hollow'); dbg('弹窗', 'statModal 内 .btn-hollow 共 ' + b.length + ' 个，点击最后一个'); if (b.length) b[b.length - 1].click(); return true; }
        if (id === 'alertModal') { const h = modal.querySelectorAll('.btn-hollow'); dbg('弹窗', 'alertModal 内 .btn-hollow 共 ' + h.length + ' 个，优先最后一个，否则 .btn-submit'); (h.length ? h[h.length - 1] : modal.querySelector('.btn-submit'))?.click(); return true; }
        dbg('弹窗', '未知弹窗 id="' + id + '"，不做处理');
        return false;
    }

    /* ---------------- 视频卡死 / 加载失败检测与分级恢复 ---------------- */
    const pgVideoStates = new WeakMap();
    function pgVideoState(v) {
        let s = pgVideoStates.get(v);
        if (!s) { s = { ct: -1, progressAt: Date.now(), attempts: 0, lastActAt: 0, reloads: 0, healthySince: 0, gaveUp: false }; pgVideoStates.set(v, s); }
        return s;
    }
    function pgVideoBroken(v) {
        try { if (v.error) return true; } catch (e) {}
        try { if (v.networkState === 3) return true; } catch (e) {}   // NETWORK_NO_SOURCE
        return false;
    }
    function pgVideoWatchdog(v) {
        const now = Date.now();
        const s = pgVideoState(v);
        let ct = 0; try { ct = Number(v.currentTime) || 0; } catch (e) {}
        let dur = 0; try { dur = Number(v.duration) || 0; } catch (e) {}
        const atEnd = dur > 0 && ct >= dur - 0.3;
        if (!atEnd && Math.abs(ct - s.ct) > 0.25) {
            /* 有进展：只有「持续正常播放」足够久才清零恢复计数，
               否则轻微缓冲/恢复动作本身造成的时间轴跳动会让计数永远停在 1 */
            s.ct = ct; s.progressAt = now;
            if (!s.healthySince) s.healthySince = now;
            if (now - s.healthySince >= PG_HEALTHY_MS) { s.attempts = 0; s.lastActAt = 0; s.healthySince = 0; }
            return;
        }
        s.healthySince = 0;
        if (atEnd) { s.progressAt = now; s.attempts = 0; return; }             // 已播完
        if (v.seeking) { s.progressAt = now; return; }
        const stallFor = now - s.progressAt;
        const broken = pgVideoBroken(v) || ((typeof v.readyState === 'number' && v.readyState === 0) && stallFor > 8000);
        if (!broken && stallFor < PG_STALL_MS) return;
        if (now - s.lastActAt < 5000) return;                       // 恢复动作节流，避免抖动
        s.lastActAt = now; s.attempts++;
        const why = broken ? '媒体加载失败 / 无可用源' : ('播放停滞 ' + Math.round(stallFor / 1000) + 's');
        chLog('视频异常（' + why + '），执行第 ' + s.attempts + '/' + PG_MAX_RECOVER_STEPS + ' 次恢复…', 'warn');
        try {
            const rate = pgRateGuard.target;
            if (s.attempts === 1) {
                v.muted = true;
                try { if (Math.abs(pgRateGuard.get(v) - rate) > 0.01) pgRateGuard.set(v, rate); } catch (e) {}
                const p = v.play(); if (p && p.catch) p.catch(() => {});
                try { v.currentTime = ct + 0.5; s.ct = ct + 0.5; } catch (e) {}   // 记录自身微调，避免被误判为「有进展」
            } else if (s.attempts === 2) {
                const idx = Array.from(document.querySelectorAll('video')).indexOf(v);
                const playBtn = document.querySelectorAll('.mejs__button.mejs__playpause-button button')[idx];
                if (playBtn) pgTriggerMouseSequence(playBtn);
                else { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
            } else if (s.attempts === 3) {
                try { v.load(); } catch (e) {}
                try { s.ct = Number(v.currentTime) || 0; } catch (e) {}
                const p = v.play(); if (p && p.catch) p.catch(() => {});
            } else {
                const key = 'dgut_pg_reload_' + (pgPageId() || 'page');
                let n = 0; try { n = Number(sessionStorage.getItem(key) || 0) || 0; } catch (e) {}
                if (n < 2) {
                    s.reloads++;
                    try { sessionStorage.setItem(key, String(n + 1)); } catch (e) {}
                    chLog('多次恢复失败，刷新页面重建播放器（第 ' + (n + 1) + '/2 次）。', 'warn');
                    setTimeout(() => { try { location.reload(); } catch (e) {} }, 800);
                    s.lastActAt = now + 30000;
                } else if (!s.gaveUp) {
                    s.gaveUp = true;
                    chLog('视频多次恢复失败，已停止自动恢复（请手动检查网络或播放器）。', 'warn');
                    s.lastActAt = now + 120000;
                }
            }
        } catch (e) {}
    }

    /* ---------------- 自动答题（异步、幂等、取不到答案不提交、尽可能不漏题） ---------------- */
    /* 题目节点：优先 .question-element-node；某些页面没有该层时退回到 .question-wrapper */
    function pgQuestionNodes() {
        let nodes = Array.from(document.querySelectorAll('.question-element-node'));
        if (!nodes.length) nodes = Array.from(document.querySelectorAll('.question-wrapper'));
        return nodes.filter(n => n && n.nodeType === 1);
    }
    async function pgAnswerAll() {
        if (gPgAnswering) return;
        const cfg = getCourseHelperConfig();
        if (!cfg.autoAnswer) {
            if (!gPgAnswerOffWarned) { gPgAnswerOffWarned = true; chLog('「自动答题」已关闭：只播放/翻页，不答题不提交。', 'muted'); }
            gPgQuestionUntil = Date.now() + 3000;
            return;
        }
        gPgAnswerOffWarned = false;
        gPgAnswering = true;
        const epoch = gPgEpoch;
        gPgQuestionUntil = Date.now() + 10000;    // 答题期间不再重复进入
        let total = 0, answered = 0, pending = 0, waiting = 0;
        const pendingIds = [];
        try {
            if (cfg.collectBank) pgCollectBank();
            const nodes = pgQuestionNodes();
            for (const node of nodes) {
                const w = node.querySelector('.question-wrapper') || node;
                if (!w) continue;
                if (w.classList.contains('finished') || node.classList.contains('finished')) continue;
                const qid = pgQuestionId(node);
                const lastSubmit = Number((w.dataset && w.dataset.dgutSubmittedAt) || 0);
                const retried = !!(w.dataset && w.dataset.dgutRetried === '1');
                if (lastSubmit && !retried && (Date.now() - lastSubmit < 20000)) {
                    /* 已提交、等站点标记完成：不重复提交，也不阻塞翻页（否则站点不标记时会永远卡住） */
                    waiting++;
                    continue;
                }
                if (lastSubmit && !retried) {
                    try { w.dataset.dgutRetried = '1'; } catch (e) {}
                    chLog('第 ' + (qid || '?') + ' 题提交后仍未标记完成，重试提交一次。', 'warn');
                }
                if (epoch !== gPgEpoch) return;                    // 页面真的换了才中断本轮
                total++;
                let answers = pgVmAnswer(node) || pgBankAnswer(node);
                if (!answers) answers = await pgRemoteAnswer(node);   // 真异步等待，不再"同步取异步"
                if (epoch !== gPgEpoch) return;
                if (!answers || !answers.length) {
                    pending++; if (qid) pendingIds.push(qid);
                    pgLog('Answer', '未取到答案，跳过提交：' + (qid || '(无ID)'));
                    continue;
                }
                const tag = pgReText((w.querySelector('.question-type-tag') || {}).textContent || '');
                const type = pgResolveType(w, tag, answers.length);
                const norm = pgNormalizeAnswers(type, answers);
                if (!norm.length) { pending++; if (qid) pendingIds.push(qid); continue; }
                const filled = pgTryFill(node, type, norm);
                if (!filled) {                                      // 有答案但没能写进作答区
                    pending++; if (qid) pendingIds.push(qid);
                    chLog('第 ' + (qid || '?') + ' 题有答案但未能填入（题型：' + type + '，答案：' + norm.join(',') + '）', 'warn');
                    continue;
                }
                await pgSleep(180);
                if (epoch !== gPgEpoch) return;
                pgSubmitQuestion(node);                             // 只有确认已填答案才提交
                try { w.dataset.dgutSubmittedAt = String(Date.now()); } catch (e) {}
                if (cfg.collectBank) pgRememberAnswer(node, norm);
                answered++;
                await pgSleep(120);
            }
            if (epoch !== gPgEpoch) return;
            if (total > 0 && answered > 0 && pending === 0) {
                const gb = document.querySelector('.question-operation-area button');
                if (gb && pgReText(gb.textContent) !== '重做') { pgTriggerMouseSequence(gb); await pgSleep(300); }
            }
            if (pending > 0) {
                const key = pgPageId() || 'page';
                if (!gPgRetrySince.has(key)) gPgRetrySince.set(key, Date.now());
                const waited = Date.now() - gPgRetrySince.get(key);
                const rounds = (gPgNoAnswerRounds.get(key) || 0) + 1;
                gPgNoAnswerRounds.set(key, rounds);
                chLog(`本轮 ${pending} 题未完成（未取到答案/未能填入/等待确认），已跳过提交；已重试 ${rounds} 轮 / ${Math.round(waited / 1000)}s，最多重试 ${Math.round(PG_NO_ANSWER_BUDGET_MS / 1000)}s。`, 'warn');
                if (waited >= PG_NO_ANSWER_BUDGET_MS || rounds >= PG_MAX_NO_ANSWER_ROUNDS) {
                    gPgSkippedPages.set(key, Date.now());
                    chLog('重试已达上限，为不空交本页不提交已失败题目，记录后继续后续页面。未完成题目：' + (pendingIds.join('、') || '(未知)'), 'warn');
                    gPgNoAnswerRounds.set(key, 0);
                    gPgRetrySince.delete(key);
                    gPgQuestionUntil = Date.now() + 2500;
                    await pgSleep(500);
                    if (epoch !== gPgEpoch) return;
                    pgClickNext('跳过无法作答的页面');
                    return;
                }
                gPgQuestionUntil = Date.now() + 3000;
                return;                                                // 未取到答案：不翻页，继续重试
            }
            gPgNoAnswerRounds.delete(pgPageId());
            gPgRetrySince.delete(pgPageId());
            if (waiting > 0) pgLog('Answer', waiting + ' 题已提交，等待站点标记完成');
            gPgQuestionUntil = Date.now() + 1500;
            await pgSleep(600);
            if (epoch !== gPgEpoch) return;
            pgClickNext('答题完成');
        } finally { gPgAnswering = false; }
    }

    /* ---------------- 换页瞬间 play() 被拒（AbortError）的有界重试 ----------------
     * 现象（真实页面实测）：站点换页时会替换/重建 <video>，此刻对旧元素调用 play()
     * 会被拒绝：
     *   AbortError: The play() request was interrupted because the media was removed from the document.
     * 旧实现只回退点一次播放按钮，失败后就等 watchdog 判「播放停滞 12s」才恢复
     * （用户现场日志里出现过「播放停滞 29s」）。现在改为：
     *   · 等 canplay / 重新查询「当前这一刻」的 video（元素可能已被替换）；
     *   · 最多重试 PG_PLAY_RETRY_MAX 次、每次间隔 PG_PLAY_RETRY_MS；
     *   · 仍失败才回退点击播放按钮。
     * ------------------------------------------------------------------ */
    const pgPlayRetryState = new WeakMap();       // video -> { n, timer }
    function pgVideoByIndex(idx) {
        const list = document.querySelectorAll('video');
        return list[idx] || list[0] || null;
    }
    function pgPlayFallback(idx) {
        const btns = document.querySelectorAll('.mejs__button.mejs__playpause-button button');
        const playBtn = btns[idx] || btns[0] || null;
        if (playBtn) { try { playBtn.click(); } catch (e) {} }
    }
    function pgSchedulePlayRetry(v, idx, st, why) {
        if (st.n >= PG_PLAY_RETRY_MAX) { pgPlayFallback(idx); return; }
        if (st.timer) return;
        st.n++;
        dbg('播放', 'play() 被拒（' + why + '）→ ' + PG_PLAY_RETRY_MS + 'ms 后第 ' + st.n + '/' + PG_PLAY_RETRY_MAX + ' 次重试');
        st.timer = setTimeout(() => {
            st.timer = null;
            if (!gCourseHelper || !gCourseHelper.running) return;
            const cur = pgVideoByIndex(idx) || v;
            if (!cur || cur.isConnected === false) { pgSchedulePlayRetry(v, idx, st, 'element-replaced'); return; }
            if (!cur.paused) return;
            if (cur.readyState >= 2) {
                try { cur.muted = true; } catch (e) {}
                let p = null;
                try { p = cur.play(); } catch (e) { p = null; }
                if (p && typeof p.catch === 'function') {
                    p.catch((e2) => pgSchedulePlayRetry(cur, idx, st, (e2 && e2.name) || 'retry-failed'));
                }
                return;
            }
            try { cur.addEventListener('canplay', () => { if (cur.paused) pgTryPlay(cur, idx); }, { once: true }); } catch (e) {}
            pgSchedulePlayRetry(cur, idx, st, 'wait-canplay');
        }, PG_PLAY_RETRY_MS);
    }
    function pgTryPlay(v, idx) {
        if (!v || !v.paused) return;
        const st = pgPlayRetryState.get(v) || { n: 0, timer: null };
        pgPlayRetryState.set(v, st);
        try { v.muted = true; } catch (e) {}
        let pr = null;
        try { pr = v.play(); } catch (e) { pr = null; }
        if (!pr || typeof pr.catch !== 'function') { pgSchedulePlayRetry(v, idx, st, 'sync-throw'); return; }
        pr.catch((err) => {
            const name = (err && err.name) || '';
            if (name === 'AbortError' || name === 'NotSupportedError') pgSchedulePlayRetry(v, idx, st, name);
            else pgPlayFallback(idx);
        });
    }

    function pgLogic() {
        if (!gCourseHelper || !gCourseHelper.running) { dbg('tick', '未运行，跳过本轮'); return; }
        dbg('tick', '──── 本轮开始 ────');
        if (pgDismissModal()) { dbgHot('tick', '本轮结束：先处理了弹窗（弹窗按钮可能推进页面，直接 return）'); return; }
        pgTouchPageDwell();
        const qPanel = document.querySelector('.question-setting-panel') || document.querySelector('.question-element-node');
        dbg('tick', '题目区=' + (qPanel ? '有' : '无') + ' · video 数=' + document.querySelectorAll('video').length + ' · 当前页="' + (document.querySelector('.page-name.active') ? pgReText(document.querySelector('.page-name.active').textContent) : '(无 .page-name.active)') + '"');
        if (qPanel) {
            if (Date.now() < gPgQuestionUntil) { dbg('分支·题目', '处于题目处理保护期（还剩 ' + (gPgQuestionUntil - Date.now()) + 'ms）→ 只刷状态'); chUpdateStatus(); return; }
            if (!getCourseHelperConfig().autoAnswer) {
                /* 自动答题关闭：仅在题目都已作答完成（或本页无题）时翻页，不干扰手动作答 */
                const left = pgQuestionNodes().filter(n => {
                    const w = n.querySelector('.question-wrapper') || n;
                    return !w.classList.contains('finished') && !n.classList.contains('finished');
                }).length;
                dbgHot('分支·题目', '自动答题=关：未完成题 ' + left + ' 道 → ' + (left === 0 ? '判定「题目已全部完成」→ 翻页' : '未完成 → 等 3s 再来'));
                if (left === 0) pgClickNext('题目已全部完成（自动答题关闭）');
                else { gPgQuestionUntil = Date.now() + 3000; chUpdateStatus(); }
                return;
            }
            dbgHot('分支·题目', '自动答题=开 → 交给 pgAnswerAll()');
            pgAnswerAll();
            return;
        }
        const videos = Array.from(document.querySelectorAll('video'));
        if (videos.length) {
            const pid = pgPageId();
            if (!pid) {
                /* 页名读不到（切页瞬间的 DOM 抖动）：本轮不下任何结论，尤其不翻页 */
                dbg('分支·视频', '页名读不到（切页 DOM 抖动）→ 本轮不下结论、**不翻页**');
                chUpdateStatus();
                return;
            }
            /* 翻页后的静默期：参考实现翻页后固定等 1s+3s 才评估新页；
               这段时间 DOM 还停留在旧页，评估必然出错。 */
            if (Date.now() < gPgSettleUntil) { dbg('分支·视频', '翻页静默期内（还剩 ' + (gPgSettleUntil - Date.now()) + 'ms）→ 不评估新页'); chUpdateStatus(); return; }
            /* 只把「属于本页」的 video 当成本页内容。上一页遗留的播放器一律忽略，
               否则会拿上一页那个「已播完」的 video 去证明本页也播完了。 */
            const mine = [];
            videos.forEach((v, idx) => { if (pgVideoOwner(v, pid) === pid) mine.push({ v, idx }); });
            if (mine.length) gPgMediaWaitSince = 0;      // 本页媒体已就位，清掉等待计时
            dbg('分支·视频', '页面 ' + pid + '：video 共 ' + videos.length + ' 个，归属本页 ' + mine.length + ' 个' + (videos.length !== mine.length ? '（有 ' + (videos.length - mine.length) + ' 个是上一页遗留）' : ''));

            if (!mine.length) {
                /* DOM 里的 video 全是上一页遗留的 → 本页播放器还没渲染出来。
                   这是「跳过中间视频」的根源，绝不能在这里翻页。
                   注意：这里刻意**不**用站点的 .complete 标记走捷径 ——
                   宁可多等一会儿，也不能冒任何「跳过本页」的风险。 */
                if (!gPgMediaWaitSince) gPgMediaWaitSince = Date.now();
                const waited = Date.now() - gPgMediaWaitSince;
                dbgHot('分支·视频', '本页播放器尚未出现，已等 ' + Math.round(waited / 1000) + 's / 上限 ' + Math.round(PG_MEDIA_APPEAR_MS / 1000) + 's → ' + (waited < PG_MEDIA_APPEAR_MS ? '继续等，**不翻页**' : '超时，按「本页无视频」翻页'));
                if (waited < PG_MEDIA_APPEAR_MS) {
                    if (!gPgMediaWaitWarned) {
                        gPgMediaWaitWarned = true;
                        chLog(`已切到新页，但本页播放器还没出现（DOM 里只剩上一页的 <video>）。最多等 ${Math.round(PG_MEDIA_APPEAR_MS / 1000)}s，期间不翻页。`, 'muted');
                    }
                    chUpdateStatus();
                    return;
                }
                chLog(`等待 ${Math.round(waited / 1000)}s 仍未出现本页视频，按「本页无视频」处理。`, 'warn');
                gPgMediaWaitSince = 0;
                pgClickNext('本页未出现视频');
                return;
            }

            /* 完成判定：优先用站点自己的 .video-bottom 标记（参考实现的做法），
               只有在拿不到可信标记时才回退到播放器状态（currentTime/ended）。 */
            const statuses = pgVideoSiteStatuses();
            const useSite = statuses.length === videos.length;
            /* 诊断日志：明确说出「站点标记到底能不能用」。
               如果这里报「未找到站点标记」，说明 .video-bottom 选择器在本页不成立，
               下面的判定会回退到播放器状态 —— 看到这行就能立刻定位问题。 */
            if (gPgSiteMarkLoggedFor !== pid) {
                gPgSiteMarkLoggedFor = pid;
                if (useSite) {
                    chLog(`本页完成标记：站点标记可用（命中 ${statuses.length} 个 / video ${videos.length} 个），按站点标记判定是否翻页。`, 'muted');
                } else {
                    chLog(`本页完成标记：WARN 未命中站点标记（.video-bottom span:first-child 命中 ${statuses.length} 个，video ${videos.length} 个），只能回退播放器状态判定。`, 'warn');
                }
            }
            if (dbgOn()) {
                dbg('判定·标记', '站点标记=' + dbgFmt(statuses) + ' · 采用站点标记=' + useSite + ' · 本页 video 播放器状态=' + mine.map(m => (m.v.paused ? '暂停' : '播放') + '/' + (Math.round(Number(m.v.currentTime) || 0)) + 's/' + (Math.round(Number(m.v.duration) || 0)) + 's/' + (m.v.ended ? 'ended' : '-')).join(' , '));
            }
            const isDone = (m) => {
                if (useSite) {
                    const s = statuses[m.idx];
                    if (s === 'finished') return true;
                    if (s === 'unviewed') return false;      // 站点说没看完 → 绝不翻页
                }
                return pgVideoFinished(m.v);
            };

            for (let i = 0; i < mine.length; i++) {
                const m = mine[i];
                const v = m.v;
                const done = isDone(m);
                dbg('判定', '本页第 ' + (i + 1) + '/' + mine.length + ' 个 video（全局序号 ' + m.idx + '）：站点标记=' + (useSite ? statuses[m.idx] : '(不可用)') + ' · isDone=' + done + ' · rate=' + dbgFmt(pgRateGuard.get(v)) + 'x(目标 ' + pgRateGuard.target + 'x)');
                if (done) continue;

                /* 站点还没标记 finished，但播放器已经到结尾了：
                   按参考实现的做法后退 3 秒重播，促使站点补上完成标记；
                   长时间仍不标记则兜底放行，避免永久卡死。 */
                if (useSite && statuses[m.idx] === 'unviewed' && pgVideoFinished(v)) {
                    if (!gPgLabelStuckSince) gPgLabelStuckSince = Date.now();
                    const stuck = Date.now() - gPgLabelStuckSince;
                    dbgHot('判定', '站点标记仍是 unviewed 但播放器已到结尾：已卡 ' + Math.round(stuck / 1000) + 's / 兜底 ' + Math.round(PG_LABEL_STUCK_MS / 1000) + 's → ' + (stuck >= PG_LABEL_STUCK_MS ? '兜底放行翻页' : '后退 3s 重播促使站点补标记'));
                    if (stuck >= PG_LABEL_STUCK_MS) {
                        gPgLabelStuckSince = 0;
                        chLog('站点长时间未把本页视频标记为已完成，兜底放行翻页。', 'warn');
                        pgClickNext('站点未标记完成，兜底放行');
                        return;
                    }
                    try { v.currentTime = Math.max(0, (Number(v.duration) || 0) - 3); } catch (e) { dbgErr('判定', '后退 3s 失败: ' + ((e && e.message) || e)); }
                    const pr = v.play(); if (pr && pr.catch) pr.catch(() => {});
                    try { pgRateGuard.hook(v); pgRateGuard.refresh(); pgRateGuard.applyTo(v, '结尾重播'); } catch (e) { dbgErr('倍速', '结尾重播应用倍速失败: ' + ((e && e.message) || e)); }
                    chUpdateStatus();
                    return;
                }
                gPgLabelStuckSince = 0;

                /* 倍速：纯属性读写（不依赖 descriptor），任何 realm 下都成立；
                   即使这里抛错也只影响本轮，不会让 guard 静默失效。 */
                try {
                    pgRateGuard.hook(v);
                    pgRateGuard.refresh();
                    pgRateGuard.applyTo(v, '本页视频');
                } catch (e) { dbgErr('倍速', '应用倍速失败: ' + ((e && e.message) || e)); }
                /* 倍速/播放按钮按「该 video 在全文档中的序号」取，不能用本页子集的下标，
                   否则页面里残留旧播放器时按钮会错位。 */
                pgRateGuard.syncSpeedBtn(v, pgRateGuard.target);
                pgVideoWatchdog(v);                       // 卡死检测
                if (v.paused) {
                    dbg('判定', 'video 处于暂停(' + Math.round(Number(v.currentTime) || 0) + 's) → 静音并尝试播放；当前倍速=' + pgRateGuard.get(v) + 'x');
                    pgTryPlay(v, m.idx);
                }
                chUpdateStatus();
                return;
            }
            /* 本页所有 video 都已完成 */
            dbgHot('判定', '本页 ' + mine.length + ' 个 video 全部 isDone → 翻页');
            pgClickNext('本页视频已全部完成');
            return;
        }
        if (pgHasMediaContainer()) {
            /* 播放器容器在、但还没有 video：同样要等本页视频渲染出来，不能急着翻页 */
            if (!gPgMediaWaitSince) gPgMediaWaitSince = Date.now();
            chUpdateStatus();
            const held = Date.now() - gPgMediaWaitSince;
            dbgHot('分支·容器', '有播放器容器但还没有 <video>：已等 ' + Math.round(held / 1000) + 's / 上限 ' + Math.round(PG_MEDIA_APPEAR_MS / 1000) + 's → ' + (held < PG_MEDIA_APPEAR_MS ? '继续等，**不翻页**' : '超时，继续往下走'));
            if (held < PG_MEDIA_APPEAR_MS) return;
        }
        /* 换页后的保护期：video 和播放器容器可能整体都还没渲染出来。
           旧实现只等 PG_PAGE_DWELL_MS(2s) 就判定「本页无视频」并翻页，
           这正是跳过中间视频的第二条路径。 */
        if (Date.now() - gPgPageChangeAt < PG_MEDIA_GRACE_MS) {
            dbgHot('分支·无视频', '无 video 无容器，但距上次换页仅 ' + (Date.now() - gPgPageChangeAt) + 'ms（保护期 ' + PG_MEDIA_GRACE_MS + 'ms）→ 继续等，**不翻页**');
            chUpdateStatus(); return;
        }
        gPgMediaWaitSince = 0;
        dbgHot('分支·无视频', '确认本页无视频（已等过保护期）→ 翻页');
        pgClickNext('当前页无视频');
    }

    function chUpdateStatus() {
        const el = document.getElementById('dgut-ch-status');
        if (!el) return;
        const cfg = getCourseHelperConfig();
        const page = pgReText((document.querySelector('.page-name.active') || {}).textContent || '');
        const qLeft = document.querySelectorAll('.question-wrapper:not(.finished)').length;
        if (gCourseHelper && gCourseHelper.running) {
            el.innerHTML = `<span style="color:var(--dgut-success);font-weight:600;">● 运行中</span> · 页面「${escapeHtml(page || '未知')}」 · 视频 ${document.querySelectorAll('video').length} · 未完成题 ${qLeft} · 倍速 ${cfg.rate}× · 自动答题${cfg.autoAnswer ? '开' : '关'} · 自动翻页${cfg.autoNext ? '开' : '关'}`;
        } else {
            el.innerHTML = `<span style="color:var(--dgut-on-surface-variant);">○ 未运行</span>`;
        }
    }

    function startCourseHelper() {
        if (gCourseHelper && gCourseHelper.running) { showStatus('刷课助手已在运行'); return; }
        const cfg = getCourseHelperConfig();
        if (!isCoursePage()) { showStatus(errFull(ERR.COURSE_NO_PAGE), true); return; }
        const ifr = detectIframe();
        if (!ifr.hasVideo && !ifr.hasVM && document.querySelectorAll('.question-element-node').length === 0) {
            showToastCard('未检测到课件元素', ifr.isTop ? '本帧未找到 video / 课件视图模型，刷课助手启动后会空转。' : '当前在 iframe 中，请到顶层页面打开面板。', '', 10000);
        }
        gPgEpoch++;
        gPgSkippedPages.clear();
        gPgNoAnswerRounds.clear();
        gPgRetrySince.clear();
        gPgLastPageId = '';
        gPgAdvancePageId = '';
        gPgLastAdvanceAt = 0;
        gCourseHelper = { running: true, timer: null, uiTimer: null };
        pgRateGuard.start();
        chLog(`刷课助手启动：倍速 ${cfg.rate}× · 自动答题${cfg.autoAnswer ? '开' : '关'} · 自动翻页${cfg.autoNext ? '开' : '关'}`, 'success');
        pgLogic();
        gCourseHelper.timer = setInterval(pgLogic, PG_TICK_MS);
        gCourseHelper.uiTimer = setInterval(() => { if (!gCourseHelper || !gCourseHelper.running) { clearInterval(gCourseHelper.uiTimer); return; } chUpdateStatus(); }, 2000);
        chUpdateStatus();
        showToastCard('刷课助手已启动', `倍速 ${cfg.rate}× · 自动答题${cfg.autoAnswer ? '开' : '关'} · 自动翻页${cfg.autoNext ? '开' : '关'}`, '答案源：视图模型 → 本地题库 → 接口', 8000);
        playAlarmBeep({ count: 1, volume: 0.3 });
    }
    function stopCourseHelper() {
        if (!gCourseHelper) return;
        gCourseHelper.running = false;
        if (gCourseHelper.timer) clearInterval(gCourseHelper.timer);
        if (gCourseHelper.uiTimer) clearInterval(gCourseHelper.uiTimer);
        gCourseHelper = null;
        gPgEpoch++;                       // 作废所有待执行的异步计划，避免旧任务落到新页面
        gPgQuestionUntil = 0;
        try { pgRateGuard.stop(); } catch (e) {}
        try { document.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) {} }); } catch (e) {}
        chLog('刷课助手已停止。', 'warn');
        chUpdateStatus();
        showStatus('已停止刷课助手');
    }
    function renderCourseView(ac) {
        const cfg = getCourseHelperConfig();
        const onPage = isCoursePage();
        const ifr = detectIframe();
        ac.innerHTML = actionHeader(ACTION_TITLES.course, '课件视频倍速、自动答题、自动翻页与题库') + `
            <div class="dgut-hint ${onPage ? 'dgut-hint--success' : 'dgut-hint--warn'}">
                ${onPage ? '当前已在课件页，可直接启动。' : '当前不在课件页。请先在优学院打开具体课件（地址含 <b>ua.dgut.edu.cn/learnCourse</b>），再回到此处启动。'}
                ${(!ifr.isTop) ? '<br><span style="color:var(--dgut-error);">当前运行在 iframe 中，刷课逻辑只在顶层查找 video/视图模型，可能空转。</span>' : ''}
            </div>
            <div class="dgut-card">
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label">视频倍速 <input type="number" id="dgut-ch-rate" class="dgut-input" value="${cfg.rate}" min="1" max="16" step="0.5" style="width:60px;padding:4px 6px;"></label>
                </div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label"><input type="checkbox" id="dgut-ch-answer" ${cfg.autoAnswer ? 'checked' : ''}> 自动答题（答案源：视图模型/题库/接口）</label>
                    <label class="dgut-label"><input type="checkbox" id="dgut-ch-next" ${cfg.autoNext ? 'checked' : ''}> 自动翻页</label>
                    <label class="dgut-label"><input type="checkbox" id="dgut-ch-bank" ${cfg.collectBank ? 'checked' : ''}> 收集题库</label>
                    <label class="dgut-label" title="排查「为什么跳页」这类问题时打开：决策链路里每个分支、每个 try/catch 都会写进下面的日志框，重点行标红。日志量较大，平时建议关闭。"><input type="checkbox" id="dgut-ch-debug" ${dbgOn() ? 'checked' : ''}> 详细调试日志</label>
                </div>
                <div class="dgut-hint" style="margin-bottom:10px;">遇到跳页时：打开上面的<b>详细调试日志</b> → 复现一次 → 点<b>复制日志</b>把内容发给开发者。日志里会写明每次翻页是<b>谁发起的、当时的站点标记是什么</b>。</div>
                <div class="dgut-hint" style="margin-bottom:10px;">取不到答案时<b>不会提交</b>，会重试 <b>${PG_MAX_NO_ANSWER_ROUNDS}</b> 轮；视频停滞超过 <b>${Math.round(PG_STALL_MS / 1000)}s</b> 会自动尝试恢复。</div>
                <div id="dgut-ch-status" style="font-size:12px;margin-bottom:10px;color:var(--dgut-on-surface-variant);"></div>
                <div class="dgut-row dgut-row--end">
                    <button id="dgut-ch-save" class="dgut-btn">${icons.settings} 保存设置</button>
                    <button id="dgut-ch-start" class="dgut-btn dgut-btn-primary">${icons.course} 启动</button>
                    <button id="dgut-ch-stop" class="dgut-btn">停止</button>
                    <button id="dgut-ch-export" class="dgut-btn">${icons.export} 导出题库</button>
                    <button id="dgut-ch-clear" class="dgut-btn">清空题库</button>
                    <button id="dgut-ch-logclear" class="dgut-btn">清空日志</button>
                    <button id="dgut-ch-logcopy" class="dgut-btn">复制日志</button>
                </div>
            </div>
            <div class="dgut-card dgut-card--tight">
                <div class="dgut-section-title">运行日志</div>
                <div id="dgut-ch-log" class="dgut-log" style="max-height:220px;"></div>
            </div>`;
        const readCfg = () => ({
            rate: Math.min(16, Math.max(1, Number(ac.querySelector('#dgut-ch-rate').value) || 6)),
            autoAnswer: ac.querySelector('#dgut-ch-answer').checked,
            autoNext: ac.querySelector('#dgut-ch-next').checked,
            collectBank: ac.querySelector('#dgut-ch-bank').checked
        });
        ac.querySelector('#dgut-ch-save').onclick = () => { saveCourseHelperConfig(readCfg()); showStatus('刷课设置已保存'); chUpdateStatus(); };
        ac.querySelector('#dgut-ch-start').onclick = () => { saveCourseHelperConfig(readCfg()); startCourseHelper(); };
        ac.querySelector('#dgut-ch-stop').onclick = stopCourseHelper;
        ac.querySelector('#dgut-ch-export').onclick = () => { if (getCourseHelperConfig().collectBank) pgCollectBank(); pgExportBank(); };
        ac.querySelector('#dgut-ch-clear').onclick = pgClearBank;
        ac.querySelector('#dgut-ch-logclear').onclick = () => { chLogClear(); chLog('运行日志已清空。', 'muted'); };
        ac.querySelector('#dgut-ch-logcopy').onclick = async () => {
            const txt = chLogBuffer().map((r) => `[${r.t}] ${r.text}`).join('\n');
            try { await navigator.clipboard.writeText(txt); showStatus('运行日志已复制到剪贴板（' + chLogBuffer().length + ' 行）'); }
            catch (e) { showStatus('复制失败，请手动选中日志框内容'); }
        };
        const dbgCb = ac.querySelector('#dgut-ch-debug');
        if (dbgCb) dbgCb.addEventListener('change', () => {
            dbgSet(dbgCb.checked);
            chLog(dbgCb.checked ? '已开启「详细调试日志」：决策链路每个分支与 try/catch 都会记录，重点行标红。复现一次后点「复制日志」发给开发者。' : '已关闭「详细调试日志」。', dbgCb.checked ? 'success' : 'muted');
        });
        ac.querySelectorAll('#dgut-ch-answer, #dgut-ch-next, #dgut-ch-bank').forEach(cb => {
            cb.addEventListener('change', () => {
                saveCourseHelperConfig(readCfg());
                gPgNextWarned = false;
                gPgAnswerOffWarned = false;
                chLog(`开关更新：自动答题${readCfg().autoAnswer ? '开' : '关'} · 自动翻页${readCfg().autoNext ? '开' : '关'}`, 'success');
                chUpdateStatus();
            });
        });
        const rateEl = ac.querySelector('#dgut-ch-rate');
        if (rateEl) {
            let rateTimer = null;
            const commitRate = () => {
                const v = Math.min(16, Math.max(1, Number(rateEl.value) || 6));
                saveCourseHelperConfig({ rate: v });
                const running = !!(gCourseHelper && gCourseHelper.running);
                if (running) { try { pgRateGuard.refresh(); pgRateGuard.enforce(); } catch (e) {} }
                chLog('倍速已更新为 ' + v + 'x' + (running ? '(运行中即时生效)' : ''), 'success');
                showStatus('倍速已更新为 ' + v + 'x');
                chUpdateStatus();
            };
            rateEl.addEventListener('input', () => { if (rateTimer) clearTimeout(rateTimer); rateTimer = setTimeout(commitRate, 400); });
            rateEl.addEventListener('change', commitRate);
        }
        chLogRestore();          // 面板重开/视图重渲染后恢复历史日志
        chUpdateStatus();
    }

    const $ = (typeof unsafeWindow !== 'undefined' && unsafeWindow.jQuery) ? unsafeWindow.jQuery : (typeof jQuery !== 'undefined' ? jQuery : null);
    const jquery = $;

    (function installUlearnVideoRemoveGuard() {
        try {
            const isLearn = /learnCourse/i.test(location.href) || /(^|\.)ulearning\.cn$/i.test(location.hostname) || /(^|\.)dgut\.edu\.cn$/i.test(location.hostname);
            if (!isLearn) return;
            const origRemove = Element.prototype.remove;
            const patched = function () {
                try { if (this && this.tagName && this.tagName.toLowerCase() === 'video') return true; } catch (e) {}
                return origRemove.call(this);
            };
            const apply = () => { try { Object.defineProperty(Element.prototype, 'remove', { value: patched, writable: true, configurable: true }); } catch (e) {} };
            apply();
            setInterval(() => { try { if (Element.prototype.remove !== patched) apply(); } catch (e) {} }, 1000);
        } catch (e) {}
    })();

    function debugLog(tag, message, detail) {
        try {
            if (DEBUG) console.log(TAG, '[刷课:' + tag + ']', message, detail === undefined ? '' : detail);
            if (typeof chLog === 'function') chLog('[' + tag + '] ' + message, 'muted');
        } catch (e) {}
    }

    /* ============================================================
     * 作业互评
     * ============================================================ */
    function peerRecords() { return GM_getValue(PEER_KEY, []) || []; }
    function peerSaveRecords(newRecords) {
        const all = peerRecords();
        const map = new Map(all.map(r => [r.id, r]));
        newRecords.forEach(r => map.set(r.id, Object.assign({}, map.get(r.id), r)));
        GM_setValue(PEER_KEY, Array.from(map.values()));
    }
    function peerToMs(v) {
        if (v === undefined || v === null || v === '') return Date.now();
        if (typeof v === 'string') { const n = Number(v); if (!isNaN(n) && /^\d+$/.test(v.trim())) v = n; else { const t = Date.parse(v); return isNaN(t) ? Date.now() : t; } }
        if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
        return Date.now();
    }
    function peerFindKey(obj, keys) {
        if (!obj || typeof obj !== 'object') return undefined;
        for (const k in obj) { if (keys.some(key => k.toLowerCase().includes(key.toLowerCase()))) return obj[k]; }
        return undefined;
    }
    function peerParseParams() {
        const m = location.hash.match(/stuDetail\/(\d+)\/(\d+)/) || location.pathname.match(/stuDetail\/(\d+)\/(\d+)/);
        if (!m) return null;
        const classid = new URLSearchParams(location.hash.split('?')[1] || location.search).get('ocId') || '';
        let token = (document.cookie.match(/(?:^|;\s*)token=([^;]+)/) || [])[1] || '';
        if (!token) { try { token = localStorage.getItem('token') || ''; } catch (e) {} }
        return { sid: m[1], hwid: m[2], classid, token, origin: location.origin };
    }
    function peerGetJson(url, token) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url, headers: token ? { AUTHORIZATION: token } : {}, timeout: 15000,
                onload: (res) => {
                    /* 修复：旧实现只拦 401/403，其它 4xx/5xx 只要响应体是 JSON 就被当成
                       成功返回，接口报错会被静默显示成「0 条记录」。现在显式拦下所有
                       HTTP 错误，并带出服务端文案。 */
                    let parsed = null;
                    try { parsed = JSON.parse(res.responseText); } catch (e) {}
                    if (res.status === 401 || res.status === 403) {
                        const why = parsed ? apiMessage(parsed) : '';
                        return reject(new Error(errFull(ERR.API_AUTH_FAIL, 'HTTP ' + res.status + (why ? '：' + why : ''))));
                    }
                    if (res.status >= 400) {
                        const why = parsed ? apiMessage(parsed) : String(res.responseText || '').slice(0, 60);
                        return reject(new Error(errFull(ERR.API_HTTP_ERR, 'HTTP ' + res.status + (why ? '：' + why : ''))));
                    }
                    if (parsed === null) return reject(new Error(errFull(ERR.PEER_PARSE_FAIL)));
                    return resolve(parsed);
                },
                onerror: () => reject(new Error(errFull(ERR.PEER_NET_FAIL))),
                ontimeout: () => reject(new Error(errFull(ERR.API_TIMEOUT)))
            });
        });
    }
    function peerCardClass(score) {
        const s = parseFloat(score);
        if (isNaN(s)) return '';
        if (s < 90) return 'peer-low';
        if (s <= 95) return 'peer-mid';
        return 'peer-high';
    }
    function peerRenderList() {
        const el = document.getElementById('dgut-peer-list');
        if (!el) return;
        const fText = (document.getElementById('dgut-peer-ftext')?.value || '').toLowerCase();
        const fScore = (document.getElementById('dgut-peer-fscore')?.value || '').trim();
        const all = peerRecords();
        let list = all.filter(r => {
            if (fText && !`${r.reviewerName || ''} ${r.reviewerSid || ''}`.toLowerCase().includes(fText)) return false;
            if (fScore) {
                const rm = fScore.match(/^(\d+)\s*-\s*(\d+)$/), gm = fScore.match(/^>(\d+)$/), lm = fScore.match(/^<(\d+)$/);
                const s = parseFloat(r.score);
                if (rm) { if (s < +rm[1] || s > +rm[2]) return false; }
                else if (gm) { if (s <= +gm[1]) return false; }
                else if (lm) { if (s >= +lm[1]) return false; }
                else return false;
            }
            return true;
        });
        list.sort((a, b) => peerToMs(b.time) - peerToMs(a.time));
        if (!list.length) {
            el.innerHTML = `<div style="text-align:center;color:var(--dgut-on-surface-variant);padding:20px;font-size:13px;">暂无互评记录。请打开作业互评详情页后点击"扫描当前作业"。</div>`;
            return;
        }
        el.innerHTML = list.map(r => {
            const cls = peerCardClass(r.score);
            const t = new Date(peerToMs(r.time)).toLocaleString('zh-CN', { hour12: false });
            return `<div class="dgut-peer-card ${cls}">
                <div style="display:flex;justify-content:space-between;">
                    <span class="peer-name">${escapeHtml(r.reviewerName || '?')}</span>
                    <span class="peer-score">${r.score}分</span>
                </div>
                <div class="peer-hw">作业：${escapeHtml(r.hwName || '?')}</div>
                <div class="peer-content">${escapeHtml(r.content || '无评语')}</div>
                <div class="peer-foot"><span>班级：${escapeHtml(r.reviewerClassName || '未知')}</span><span>${t}</span></div>
            </div>`;
        }).join('');
    }
    let gPeerInfoMap = {}, gPeerHwInfo = null, gPeerObserver = null;
    function peerInjectLabels() {
        const inject = (sel, target, prefix) => {
            const list = target === 'reviewer' ? (gPeerHwInfo && gPeerHwInfo.hwList) || [] : (gPeerHwInfo && gPeerHwInfo.peerList) || [];
            document.querySelectorAll(`${sel}:not([data-peerdone])`).forEach((el, i) => {
                const uid = el.dataset.peeruid || (list[i] && list[i].userID);
                const u = uid ? gPeerInfoMap[uid] : null;
                if (u) {
                    const tag = document.createElement('div');
                    tag.style.cssText = 'font-size:13px;margin:6px 0;padding:4px 8px;border-left:2px solid var(--dgut-primary);background:var(--dgut-info-container);color:var(--dgut-on-info-container);white-space:pre-line;border-radius:0 6px 6px 0;';
                    tag.textContent = `${prefix}：${u.name} ｜ 班级：${u.className || '未知'}`;
                    if (el.parentNode) el.parentNode.insertBefore(tag, el.nextSibling);
                }
                el.dataset.peerdone = '1';
            });
        };
        inject('.peermain', 'reviewer', '评价人');
        inject('.peer_host', 'target', '待评价人');
    }
    async function peerRunScan() {
        const p = peerParseParams();
        if (!p) { showStatus(errFull(ERR.PEER_NOT_PAGE), true); return; }
        showStatus('正在读取互评数据…');
        const hwInfo = { hwName: '未知作业', startTime: Date.now(), endTime: Date.now() };
        try {
            const [dr, pr] = await Promise.allSettled([
                peerGetJson(`${p.origin}/homeworkapi/stuHomework/homeworkDetail/${p.hwid}/${p.sid}/${p.classid}`, p.token),
                peerGetJson(`${p.origin}/homeworkapi/stuHomework/peerReviewHomeworkDatil/${p.hwid}/${p.sid}`, p.token)
            ]);
            const hwDetail = (dr.status === 'fulfilled' && dr.value && dr.value.result) || {};
            const act = hwDetail.activityHomework || {};
            hwInfo.hwName = peerFindKey(act, ['title', 'name', 'homeworkName']) || peerFindKey(hwDetail, ['title', 'name']) || '未知作业';
            hwInfo.startTime = peerToMs(peerFindKey(act, ['startTime', 'startDate', 'beginTime']));
            hwInfo.endTime = peerToMs(peerFindKey(act, ['endTime', 'dueDate', 'deadline', 'finishTime']) || Date.now());
            const hwList = hwDetail.peerReviewHomeworkList || [];
            const peerList = (pr.status === 'fulfilled' && pr.value && pr.value.result) || [];
            const newRecords = [];
            hwList.forEach(item => {
                const score = peerFindKey(item, ['score', 'rating', 'point']);
                const content = peerFindKey(item, ['comment', 'content', 'review', 'desc']) || '无评价内容';
                const reviewerId = item.userID;
                if (score !== undefined && reviewerId) newRecords.push({ id: `${p.hwid}_${p.sid}_${reviewerId}`, hwid: p.hwid, sid: p.sid, reviewerId, score, content: String(content), time: peerToMs(peerFindKey(item, ['reviewTime', 'createTime', 'submitTime', 'time'])), hwName: hwInfo.hwName });
            });
            if (newRecords.length) peerSaveRecords(newRecords);
            const uidSet = new Set();
            [...hwList, ...peerList].forEach(it => { if (it.userID) uidSet.add(it.userID); });
            const uidList = Array.from(uidSet);
            const results = await Promise.allSettled(uidList.map(uid => peerFetchUser(uid, p)));
            gPeerInfoMap = {};
            uidList.forEach((uid, i) => { gPeerInfoMap[uid] = results[i].status === 'fulfilled' ? results[i].value : { name: '?', studentid: '?', className: '' }; });
            gPeerHwInfo = { hwList, peerList };
            const all = peerRecords().map(r => { const u = gPeerInfoMap[r.reviewerId]; return u ? Object.assign({}, r, { reviewerName: u.name, reviewerSid: u.studentid, reviewerClassName: u.className }) : r; });
            GM_setValue(PEER_KEY, all);
            peerRenderList();
            await pgSleep(400);
            peerInjectLabels();
            if (gPeerObserver) gPeerObserver.disconnect();
            let pending = false;
            gPeerObserver = new MutationObserver(() => {
                if (pending) return;
                pending = true;
                setTimeout(() => {
                    pending = false;
                    if (document.querySelector('.peermain:not([data-peerdone]), .peer_host:not([data-peerdone])')) peerInjectLabels();
                }, 200);
            });
            gPeerObserver.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { if (gPeerObserver) { gPeerObserver.disconnect(); gPeerObserver = null; } }, 30000);
            showStatus(`已读取：评价人 ${hwList.length}，待评价 ${peerList.length}`);
        } catch (e) { showStatus('读取失败：' + e.message, true); }
    }
    async function peerFetchUser(uid, p) {
        const user = { name: '?', studentid: '?', className: '' };
        const [ur, cr] = await Promise.allSettled([
            peerGetJson(`${p.origin}/homeworkapi/homework/historyStudentHomework/${uid}/${uid}/${p.hwid}`, p.token),
            peerGetJson(`${p.origin}/courseapi/classes?ocId=${p.classid}&pn=1&ps=9999&userId=${uid}&keyword=&lang=zh`, p.token)
        ]);
        if (ur.status === 'fulfilled' && ur.value && ur.value.result && ur.value.result.user) { user.name = ur.value.result.user.name || '?'; user.studentid = ur.value.result.user.studentid || '?'; }
        if (cr.status === 'fulfilled' && cr.value && cr.value.list && cr.value.list.length) user.className = cr.value.list[0].className || '';
        return user;
    }
    function renderPeerView(ac) {
        const onPage = !!peerParseParams();
        ac.innerHTML = actionHeader(ACTION_TITLES.peer, '读取互评接口，汇总与筛选记录') + `
            <div class="dgut-hint ${onPage ? 'dgut-hint--success' : 'dgut-hint--warn'}">
                ${onPage ? '? 当前在作业互评详情页，可点击"扫描当前作业"。' : '请在作业互评详情页（URL 含 <b>stuDetail/学号/作业ID</b>）打开本面板，再扫描。'}
            </div>
            <div class="dgut-row dgut-row--mb">
                <input id="dgut-peer-ftext" class="dgut-input" placeholder="按评价人姓名/学号筛选" style="flex:1;min-width:120px;">
                <input id="dgut-peer-fscore" class="dgut-input" placeholder="分数 80-95 / >90" style="width:130px;">
            </div>
            <div class="dgut-row dgut-row--end dgut-row--mb">
                <button id="dgut-peer-scan" class="dgut-btn dgut-btn-primary">${icons.refresh} 扫描当前作业</button>
                <button id="dgut-peer-clear" class="dgut-btn">清空记录</button>
            </div>
            <div id="dgut-peer-list"></div>`;
        peerRenderList();
        ac.querySelector('#dgut-peer-ftext').addEventListener('input', peerRenderList);
        ac.querySelector('#dgut-peer-fscore').addEventListener('input', peerRenderList);
        ac.querySelector('#dgut-peer-scan').onclick = peerRunScan;
        ac.querySelector('#dgut-peer-clear').onclick = () => { if (confirm('确定清空所有互评记录？不可撤销。')) { GM_setValue(PEER_KEY, []); peerRenderList(); } };
    }

    /* ============================================================
     * 求是读书
     * ============================================================ */
    const READ_MIN_SEC = 4 * 3600 + 10;
    const READ_NAV_SEC = 3;
    const READ_SAVE_INTERVAL = 30;
    const READ_SERVER_POLL_SEC = 5;          // 阅读中每 5 秒刷新一次服务端时长
    const READ_VIEW_REFRESH_MS = 30 * 1000;  // 面板停留时每 30 秒刷新显示
    let gRead = null;
    let gRdViewTimer = null;
    function rdCfg() {
        try {
            /* 一次性迁移（v5.9.1）：旧实现默认「开」、连保存间隔都会写 readerAutoStart:true，
               升级后把这种旧值重置一次为「关」；之后用户自己点「开始 / 暂停」的选择照常保留。 */
            if (GM_getValue(READ_AUTOSTART_MIGRATED_KEY, false) !== true) {
                const old = GM_getValue(READ_CFG_KEY, {}) || {};
                if (old.readerAutoStart === true) { old.readerAutoStart = false; GM_setValue(READ_CFG_KEY, old); }
                GM_setValue(READ_AUTOSTART_MIGRATED_KEY, true);
            }
        } catch (e) {}
        const c = GM_getValue(READ_CFG_KEY, {}) || {}; const s = parseInt(c.readerSec, 10); return { readerSec: s > 0 ? s : 30, autoStart: c.readerAutoStart === true };
    }
    /* 默认关闭：缺省配置 / 没有 readerAutoStart 键都视为关闭；只有显式 true（用户点过「开始」）才自动恢复。
       注意默认值必须与 rdCfg、iframe DEF/readCfg 三处保持一致；保存间隔时 patch 只带 readerSec，不得改动开关。 */
    function rdSaveCfg(patch) { GM_setValue(READ_CFG_KEY, Object.assign({ readerSec: 30, readerAutoStart: false }, GM_getValue(READ_CFG_KEY, {}), patch)); }
    function rdRecords() { return GM_getValue(READ_RECORDS_KEY, {}) || {}; }
    function rdBookTime(k) { return Math.max(0, parseInt(rdRecords()[k], 10) || 0); }
    function rdSetBookTime(k, s) { const r = rdRecords(); r[k] = Math.max(0, Math.floor(s)); GM_setValue(READ_RECORDS_KEY, r); }
    function rdFmt(t) { t = Math.max(0, Math.floor(t) || 0); return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t % 3600 / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; }
    function rdUnwrap(v) { return typeof v === 'function' ? v() : v; }
    function rdTrim(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
    function rdVm() { try { return PAGE_WIN.koLearnCourseViewModel || null; } catch (e) { return null; } }
    function rdCourseId() { try { return new URL(location.href).searchParams.get('courseId') || ''; } catch (e) { return ''; } }
    function rdActiveSectionName() { const a = document.querySelector('.page-name.active'); const s = a && a.closest('.section-item'); const n = s && s.querySelector('.section-name .text'); return n ? rdTrim(n.textContent) : ''; }
    function rdBookKey() { const name = rdActiveSectionName(); const cid = rdCourseId(); return name ? (cid ? `${cid}|${name}` : name) : (cid || location.href); }
    function rdPageId(page) { if (!page) return null; return typeof page.id === 'function' ? page.id() : page.id; }
    function rdServerTimes() {
        const vm = rdVm(); if (!vm) return null;
        const course = rdUnwrap(vm.course); if (!course) return null;
        const chapters = rdUnwrap(course.chapters); if (!chapters) return null;
        const result = {}; const cid = rdCourseId();
        chapters.forEach(ch => {
            const sections = rdUnwrap(ch.sections); if (!sections) return;
            sections.forEach(sec => {
                let name = ''; try { name = rdTrim(rdUnwrap(sec.name)); } catch (e) {}
                if (!name) return;
                let total = 0;
                try { const sr = rdUnwrap(sec.record); if (sr && sr.sectionStudyTime !== undefined) total = rdUnwrap(sr.sectionStudyTime) || 0; } catch (e) {}
                if (total === 0) { const pages = rdUnwrap(sec.pages); if (pages) pages.forEach(pg => { try { const rec = rdUnwrap(pg.record); if (rec) total += (rdUnwrap(rec.studyTime) || 0) + (rdUnwrap(rec.lastStudyTime) || 0); } catch (e) {} }); }
                if (total > 0) result[cid ? `${cid}|${name}` : name] = total;
            });
        });
        return result;
    }
    /** 当前书的服务端累计秒数：null=取不到（不在课件页/视图模型未就绪），0=服务端暂无记录 */
    function rdServerTotal(key) {
        const st = rdServerTimes();
        if (!st) return null;
        const v = st[key || rdBookKey()];
        return (v === undefined || v === null) ? 0 : Math.max(0, Math.floor(Number(v) || 0));
    }
    /** 切书/过章节门槛：以服务端时长为准；服务端暂无记录时才退回本地累计 */
    function rdGateSec() {
        const key = gRead ? gRead.bookKey : rdBookKey();
        const s = rdServerTotal(key);
        const local = gRead ? gRead.total : rdBookTime(key);
        return (s !== null && s > 0) ? s : local;
    }
    /** 上方大号时间 = 本地累计；下方小字 = 服务端时长 */
    function rdRenderTimes() {
        const key = gRead ? gRead.bookKey : rdBookKey();
        const local = gRead ? gRead.total : rdBookTime(key);
        const s = rdServerTotal(key);
        const tEl = document.getElementById('dgut-rd-timer');
        if (tEl) tEl.textContent = rdFmt(local);
        const sEl = document.getElementById('dgut-rd-server');
        if (sEl) sEl.textContent = '服务端: ' + ((s !== null && s > 0) ? rdFmt(s) : '--');
    }
    /** 刷新服务端时长；同步本地时间：
        - syncLocal=true：手动同步，直接把本地对齐到服务端；
        - syncLocal=false：自动刷新，仅在检测到服务端时长变化时对齐。 */
    function rdRefreshServer(syncLocal) {
        const key = gRead ? gRead.bookKey : rdBookKey();
        const s = rdServerTotal(key);
        if (s === null) { rdRenderTimes(); return null; }
        const prev = gRead ? gRead.serverTotal : null;
        const changed = (prev !== null && s !== prev);
        if (s > 0 && (syncLocal || changed)) {
            rdSetBookTime(key, s);
            if (gRead) { gRead.total = s; gRead.accumulated = s; gRead.sessionStart = Date.now(); gRead.lastSave = s; }
        }
        if (gRead) { gRead.serverTotal = s; gRead.lastServerAt = Date.now(); }
        rdRenderTimes();
        return s;
    }
    function rdStopViewTimer() { if (gRdViewTimer) { clearInterval(gRdViewTimer); gRdViewTimer = null; } }
    function rdStartViewTimer() {
        rdStopViewTimer();
        gRdViewTimer = setInterval(() => {
            if (!document.getElementById('dgut-rd-timer')) { rdStopViewTimer(); return; }   // 离开读书视图就停
            rdRefreshServer(false);
        }, READ_VIEW_REFRESH_MS);
    }
    function rdFlatList(vm) {
        const course = rdUnwrap(vm.course); const chapters = course && rdUnwrap(course.chapters); if (!chapters) return [];
        const out = [];
        chapters.forEach(ch => { const sections = rdUnwrap(ch.sections); if (!sections) return; sections.forEach(sec => { if (rdUnwrap(sec.isHide)) return; const pages = rdUnwrap(sec.pages); if (!pages) return; pages.forEach(pg => out.push({ page: pg, section: sec, chapter: ch })); }); });
        return out;
    }
    function rdFindIndex(list, pid) { return list.findIndex(it => String(rdPageId(it.page)) === String(pid)); }
    function rdMoveLabel(from, to) { if (!from || !to) return '切换'; if (rdPageId(from.chapter) !== rdPageId(to.chapter)) return '切换下一章'; if (rdPageId(from.section) !== rdPageId(to.section)) return '切换下一书'; return '切换下一节'; }
    function rdMoveTarget(it) { if (!it) return '(未知)'; const ch = rdTrim(rdUnwrap(it.chapter && it.chapter.name)); const sec = rdTrim(rdUnwrap(it.section && it.section.name)); const pg = rdTrim(rdUnwrap(it.page && it.page.name)); if (sec) return (ch ? ch + ' / ' : '') + sec + ' - ' + pg; return pg || '(未知)'; }
    function rdAdvanceSection(vm, curId) {
        const list = rdFlatList(vm); const idx = rdFindIndex(list, curId);
        if (idx >= 0 && idx < list.length - 1) { const cur = list[idx], nxt = list[idx + 1]; try { vm.selectPage(nxt.page, nxt.section, nxt.chapter); } catch (e) {} return { ok: true, label: rdMoveLabel(cur, nxt), target: rdMoveTarget(nxt) }; }
        return { ok: false, atEnd: list.length > 0 };
    }
    function rdSolveChapterModal() {
        const modal = document.querySelector('.stat-page.chapter-stat');
        if (!modal) return false;
        const r = modal.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const btns = modal.querySelectorAll('.stat-next .btn-hollow');
        if (!btns.length) return false;
        if (rdGateSec() < READ_MIN_SEC) { btns[0].click(); gRead.pageStart = Date.now(); }
        else if (btns.length > 1) { btns[1].click(); gRead.curPageId = null; gRead.pageStart = Date.now(); }
        else { btns[0].click(); gRead.pageStart = Date.now(); }
        return true;
    }
    function rdSyncReader() {
        const cfg = rdCfg();
        const payload = { type: 'DGUT_SINGLE_FILE_READER_SYNC', intervalSec: cfg.readerSec, autoStart: cfg.autoStart };
        Array.from(document.querySelectorAll('iframe')).forEach(f => { try { if (f.contentWindow) f.contentWindow.postMessage(payload, '*'); } catch (e) {} });
    }
    function rdTick() {
        if (!gRead || !gRead.running) return;
        const vm = rdVm();
        const modal = document.querySelector('.modal.fade.in');
        if (modal && pgVisible(modal)) { const b = modal.querySelector('.btn-submit'); if (b && pgVisible(b)) b.click(); return; }
        if (rdSolveChapterModal()) return;
        const key = rdBookKey();
        if (key !== gRead.bookKey) { rdSetBookTime(gRead.bookKey, gRead.total); gRead.bookKey = key; gRead.accumulated = rdBookTime(key); gRead.sessionStart = Date.now(); gRead.lastSave = gRead.accumulated; gRead.lastAdvancePageId = null; gRead.lastAdvanceAt = 0; gRead.stuckWarned = false; gRead.serverTotal = null; gRead.lastServerAt = 0; }
        /* 阅读中定期刷新服务端时长；本地累计落后时自动补到服务端值 */
        if (Date.now() - (gRead.lastServerAt || 0) >= READ_SERVER_POLL_SEC * 1000) rdRefreshServer(false);
        if (vm && vm.currentPage) {
            const list = rdFlatList(vm);
            const pid = rdPageId(vm.currentPage());
            if (pid && pid !== gRead.curPageId) { gRead.curPageId = pid; gRead.pageStart = Date.now(); }
            /* 是否已满 4h10m 以服务端阅读时长为准（服务端暂无记录才用本地） */
            if ((gRead.serverTotal > 0 ? gRead.serverTotal : gRead.total) >= READ_MIN_SEC) {
                const dwellOk = gRead.curPageId && Date.now() - gRead.pageStart >= READ_NAV_SEC * 1000;
                /* 修复「连着翻页、跳过中间内容」（与刷课跳过中间视频同一类 bug）：
                   goNextPage() 之后 currentPage 可能要过一会儿才更新，而旧实现每
                   READ_NAV_SEC(3s) 就无条件再点一次 —— 页面还没切走就被连点跳过。
                   现在：同一页只点一次；点过之后必须等 currentPage 真正切走才允许再点。
                   若长时间没切走，只按 15 秒一次做低频重试，并先给出提示。 */
                if (dwellOk && gRead.lastAdvancePageId !== gRead.curPageId) {
                    gRead.lastAdvancePageId = gRead.curPageId;
                    gRead.lastAdvanceAt = Date.now();
                    gRead.stuckWarned = false;
                    try { if (typeof vm.goNextPage === 'function') vm.goNextPage(); } catch (e) {}
                    gRead.pageStart = Date.now();
                    const idx = rdFindIndex(list, gRead.curPageId);
                    if (idx >= list.length - 1) { const res = rdAdvanceSection(vm, gRead.curPageId); if (!res.ok && res.atEnd) { rdStop(); showToastCard(`${KAO.ok} 求是读书`, '全部书目已读完', '', 8000); } }
                } else if (dwellOk) {
                    const stuckMs = Date.now() - (gRead.lastAdvanceAt || gRead.pageStart);
                    if (stuckMs > 15000) {
                        gRead.lastAdvanceAt = Date.now();
                        gRead.stuckWarned = false;
                        try { if (typeof vm.goNextPage === 'function') vm.goNextPage(); } catch (e) {}
                    } else if (!gRead.stuckWarned && stuckMs > 8000) {
                        gRead.stuckWarned = true;
                        showStatus('求是读书：已点翻页但页面未切换，等待中…');
                    }
                }
            }
        }
        if (!gRead) return;
        gRead.total = gRead.accumulated + Math.floor((Date.now() - gRead.sessionStart) / 1000);
        if (gRead.total - gRead.lastSave >= READ_SAVE_INTERVAL) { rdSetBookTime(gRead.bookKey, gRead.total); gRead.lastSave = gRead.total; }
        rdRenderTimes();
    }
    function rdStart() {
        if (gRead && gRead.running) return;
        const vm = rdVm();
        if (!vm) {
            showStatus(errFull(ERR.READ_NO_VM), true);
            showToastCard('求是读书未启动', '未找到课件视图模型 koLearnCourseViewModel，可能不在课件页或运行在 iframe 中。', '', 8000);
            return;
        }
        const key = rdBookKey();
        gRead = { running: true, timer: null, bookKey: key, accumulated: rdBookTime(key), sessionStart: Date.now(), lastSave: rdBookTime(key), total: rdBookTime(key), curPageId: null, pageStart: Date.now(), lastAdvancePageId: null, lastAdvanceAt: 0, stuckWarned: false, serverTotal: null, lastServerAt: 0 };
        if (vm.currentPage) gRead.curPageId = rdPageId(vm.currentPage());
        gRead.timer = setInterval(rdTick, 1000);
        rdSaveCfg({ readerAutoStart: true });
        rdSyncReader();
        rdRefreshServer(true);
        showStatus('求是读书：开始');
    }
    function rdStop() {
        if (!gRead) return;
        gRead.running = false;
        if (gRead.timer) clearInterval(gRead.timer);
        rdSetBookTime(gRead.bookKey, gRead.total);
        rdSaveCfg({ readerAutoStart: false });
        rdSyncReader();
        gRead = null;
        rdRenderTimes();
        showStatus('求是读书：已暂停');
    }
    function renderReadView(ac) {
        const cfg = rdCfg();
        const vm = rdVm();
        const onPage = /\/learnCourse\//i.test(location.href) || (vm && vm.currentPage);
        const hasVm = !!vm;
        ac.innerHTML = actionHeader(ACTION_TITLES.read, '课件阅读时长统计与自动翻页') + `
            <div class="dgut-hint ${onPage ? 'dgut-hint--success' : 'dgut-hint--warn'}">
                ${onPage ? '当前在课件页，可开始求是阅读。' : '请先在优学院打开求是读书课件页（地址含 <b>ua.dgut.edu.cn/learnCourse/learnCourse.html</b>）。'}
                ${!hasVm ? '<br><span style="color:var(--dgut-error);">未检测到 koLearnCourseViewModel，启动后会空转。</span>' : ''}
            </div>
            <div class="dgut-card">
                <div style="text-align:center;font-size:30px;font-weight:700;color:var(--dgut-primary);font-family:Consolas,monospace;" id="dgut-rd-timer">${rdFmt(rdBookTime(rdBookKey()))}</div>
                <div style="text-align:center;font-size:12px;color:var(--dgut-on-surface-variant);margin:4px 0 12px;" id="dgut-rd-server">服务端: --</div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label">翻页间隔 <input type="number" id="dgut-rd-sec" class="dgut-input" value="${cfg.readerSec}" min="1" style="width:64px;padding:4px 6px;"> 秒/页</label>
                    <span style="color:var(--dgut-on-surface-variant);font-size:12px;">满 4h10m 后自动切书</span>
                </div>
                <div class="dgut-row dgut-row--end">
                    <button id="dgut-rd-save" class="dgut-btn">${icons.settings} 保存间隔</button>
                    <button id="dgut-rd-start" class="dgut-btn dgut-btn-primary">开始</button>
                    <button id="dgut-rd-stop" class="dgut-btn">暂停</button>
                    <button id="dgut-rd-sync" class="dgut-btn">同步服务端</button>
                </div>
            </div>`;
        const readSec = () => Math.max(1, parseInt(ac.querySelector('#dgut-rd-sec').value, 10) || 30);
        ac.querySelector('#dgut-rd-save').onclick = () => { rdSaveCfg({ readerSec: readSec() }); rdSyncReader(); showStatus('翻页间隔已保存'); };
        ac.querySelector('#dgut-rd-start').onclick = () => { rdSaveCfg({ readerSec: readSec() }); rdStart(); };
        ac.querySelector('#dgut-rd-stop').onclick = rdStop;
        ac.querySelector('#dgut-rd-sync').onclick = () => {
            const s = rdRefreshServer(true);
            if (s === null) { showStatus('同步失败', true); return; }
            if (!s) { showStatus('服务端暂无记录'); return; }
            showStatus('已同步');
        };
        rdRefreshServer(false);   // 打开视图先拉一次服务端时长
        rdStartViewTimer();       // 停留在视图期间每 30 秒自动刷新
    }

    /* ============================================================
     * 文档工具
     * ============================================================ */
    function getDocDraft() { return GM_getValue(DOC_DRAFT_KEY, ''); }
    function saveDocDraft(t) { GM_setValue(DOC_DRAFT_KEY, String(t || '')); }
    function getDocTitle() { return GM_getValue(DOC_TITLE_KEY, `文档_${dateKey()}`); }
    function saveDocTitle(t) { GM_setValue(DOC_TITLE_KEY, String(t || '').trim() || `文档_${dateKey()}`); }
    function getSignatures() { return GM_getValue(DOC_SIGN_KEY, []) || []; }
    function addSignature(sig) { const l = getSignatures(); l.push(sig); GM_setValue(DOC_SIGN_KEY, l.slice(-30)); }
    function deleteSignature(id) { GM_setValue(DOC_SIGN_KEY, getSignatures().filter(s => String(s.id) !== String(id))); }

    async function mdToHtml(md) {
        const lib = await ensureMarked();
        if (!lib) throw new Error(errFull(ERR.DOC_NO_MARKED));
        try { if (typeof lib.setOptions === 'function') lib.setOptions({ breaks: true, gfm: true }); } catch (e) {}
        try { return lib.parse(String(md || '')); }
        catch (e) { throw new Error(errFull(ERR.DOC_PARSE_MD, e.message)); }
    }
    function signaturesHtml(signatures) {
        if (!signatures || !signatures.length) return '';
        return signatures.map(s => `
            <div style="margin-top:20px;text-align:right;font-size:14px;color:#49454E;">
                <div>${escapeHtml(s.name || '签名')}</div>
                <img src="${s.dataUrl}" style="width:180px;height:auto;vertical-align:bottom;">
            </div>`).join('');
    }
    function wrapForWord(html, title, signatures = []) {
        return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]>
<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml>
<![endif]-->
<style>
    @page { size: A4; margin: 2cm; }
    body { font-family: "PingFang SC", "Microsoft YaHei", SimSun, sans-serif; font-size: 12pt; line-height: 1.65; color: #1D1B20; }
    h1 { font-size: 20pt; border-bottom: 1px solid #CAC4D0; padding-bottom: 4pt; }
    h2 { font-size: 16pt; } h3 { font-size: 14pt; } h4 { font-size: 12pt; }
    code { background: #F3EDF7; padding: 1pt 4pt; border-radius: 3pt; font-family: Consolas, "Courier New", monospace; font-size: 10.5pt; }
    pre { background: #F7F2FA; padding: 10pt; border-radius: 6pt; overflow-x: auto; }
    pre code { background: transparent; padding: 0; }
    table { border-collapse: collapse; margin: 6pt 0; }
    th, td { border: 1pt solid #CAC4D0; padding: 4pt 8pt; font-size: 11pt; }
    th { background: #F3EDF7; }
    blockquote { border-left: 3pt solid #6750A4; padding-left: 10pt; color: #49454E; margin-left: 0; }
    ul, ol { margin: 6pt 0; padding-left: 20pt; }
    hr { border: none; border-top: 1pt solid #CAC4D0; margin: 12pt 0; }
    img { max-width: 100%; height: auto; }
</style>
</head>
<body>
${html}
${signaturesHtml(signatures)}
</body>
</html>`;
    }

    const PDF_MARGIN_MM = 14;
    const PDF_PAGE_W_MM = 210;
    const PDF_PAGE_H_MM = 297;
    const PDF_RENDER_W = 780;
    const PDF_INLINE_STYLE = `
        * { box-sizing: border-box; }
        h1 { font-size: 26px; border-bottom: 1px solid #CAC4D0; padding-bottom: 6px; margin: 18px 0 10px; }
        h2 { font-size: 21px; margin: 16px 0 8px; }
        h3 { font-size: 18px; margin: 14px 0 6px; }
        h4 { font-size: 16px; margin: 12px 0 6px; }
        h5, h6 { font-size: 15px; margin: 10px 0 6px; }
        p { margin: 8px 0; }
        ul, ol { margin: 8px 0; padding-left: 26px; }
        li { margin: 3px 0; }
        blockquote { border-left: 4px solid #6750A4; margin: 10px 0; padding: 4px 14px; color: #49454E; background: #F7F2FA; }
        pre { background: #F7F2FA; padding: 12px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
        code { background: #F3EDF7; padding: 1px 5px; border-radius: 3px; font-family: Consolas, "Courier New", monospace; font-size: 14px; }
        pre code { background: transparent; padding: 0; }
        table { border-collapse: collapse; margin: 10px 0; width: 100%; }
        th, td { border: 1px solid #CAC4D0; padding: 6px 10px; font-size: 15px; word-break: break-word; }
        th { background: #F3EDF7; }
        img { max-width: 100%; height: auto; }
        hr { border: none; border-top: 1px solid #CAC4D0; margin: 16px 0; }
        a { color: #6750A4; text-decoration: underline; }
    `;
    // 每处理 N 页让出一次主线程，避免长时间卡死 UI
    const PDF_YIELD_EVERY = 3;
    const yieldToUI = () => new Promise(r => setTimeout(r, 0));

    async function htmlToPdfBlob(innerHtml, title, onProgress) {
        const [h2c, PDFCtor] = await Promise.all([ensureHtml2Canvas(), ensureJsPDF()]);
        if (!h2c) throw new Error(errFull(ERR.DOC_NO_H2C));
        if (!PDFCtor) throw new Error(errFull(ERR.DOC_NO_JSPDF));
        const contentW = PDF_PAGE_W_MM - PDF_MARGIN_MM * 2;
        const contentH = PDF_PAGE_H_MM - PDF_MARGIN_MM * 2;
        const holder = document.createElement('div');
        holder.setAttribute('data-dgut-pdf-holder', '1');
        holder.style.cssText = [
            'position:absolute', 'left:-100000px', 'top:0', `width:${PDF_RENDER_W}px`,
            'margin:0', 'padding:0', 'background:#ffffff', 'color:#1D1B20',
            'font-family:"PingFang SC","Microsoft YaHei",SimSun,sans-serif',
            'font-size:16px', 'line-height:1.7', 'box-sizing:border-box', 'pointer-events:none'
        ].join(';');
        holder.innerHTML = `<style>${PDF_INLINE_STYLE}</style>${innerHtml}`;
        document.body.appendChild(holder);
        try {
            try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
            const imgs = Array.from(holder.querySelectorAll('img'));
            await Promise.all(imgs.map(im => (im.complete ? Promise.resolve() : new Promise(r => {
                im.addEventListener('load', r, { once: true });
                im.addEventListener('error', r, { once: true });
                setTimeout(r, 2000);
            }))));
            await new Promise(r => setTimeout(r, 80));
            const canvas = await h2c(holder, {
                scale: 2, backgroundColor: '#ffffff', useCORS: true, allowTaint: false, logging: false,
                width: holder.scrollWidth, height: holder.scrollHeight,
                windowWidth: PDF_RENDER_W, windowHeight: Math.max(holder.scrollHeight, 800)
            });
            const pxPerMm = canvas.width / contentW;
            const pageSlicePx = Math.max(1, Math.floor(contentH * pxPerMm));
            const totalPages = Math.ceil(canvas.height / pageSlicePx);
            const pdf = new PDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
            try { pdf.setProperties({ title: title || 'document', creator: 'DGUT Helper' }); } catch (e) {}
            let y = 0, pageIdx = 0;
            while (y < canvas.height) {
                const sliceH = Math.min(pageSlicePx, canvas.height - y);
                if (sliceH <= 0) break;
                const slice = document.createElement('canvas');
                slice.width = canvas.width; slice.height = sliceH;
                const sctx = slice.getContext('2d');
                sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, slice.width, slice.height);
                sctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
                const dataUrl = slice.toDataURL('image/jpeg', 0.94);
                if (pageIdx > 0) pdf.addPage();
                pdf.addImage(dataUrl, 'JPEG', PDF_MARGIN_MM, PDF_MARGIN_MM, contentW, sliceH / pxPerMm);
                y += sliceH; pageIdx++;
                if (pageIdx > 500) break;
                if (onProgress) { try { onProgress(pageIdx, totalPages); } catch (e) {} }
                if (pageIdx % PDF_YIELD_EVERY === 0) await yieldToUI();
            }
            return pdf.output('blob');
        } finally {
            holder.remove();
        }
    }
    function openPrintWindow(html) {
        let win = null;
        try {
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            win = window.open(url, '_blank');
            if (win) {
                setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 120000);
                const doPrint = () => { try { win.focus(); win.print(); } catch (e) {} };
                try { win.addEventListener('load', () => setTimeout(doPrint, 400), { once: true }); } catch (e) { setTimeout(doPrint, 900); }
                setTimeout(doPrint, 1400);
                return win;
            }
        } catch (e) {}
        try {
            win = window.open('', '_blank');
            if (!win) return null;
            win.document.open(); win.document.write(html); win.document.close();
            setTimeout(() => { try { win.focus(); win.print(); } catch (e) {} }, 700);
            return win;
        } catch (e) { return null; }
    }
    async function exportMdToWord() {
        const md = document.getElementById('dgut-doc-md')?.value || '';
        if (!md.trim()) { showStatus(errFull(ERR.DOC_EMPTY_MD), true); return; }
        const title = (document.getElementById('dgut-doc-title')?.value || getDocTitle()).trim() || `文档_${dateKey()}`;
        saveDocDraft(md); saveDocTitle(title);
        const sigs = getPickedSignatures();
        let html;
        try { html = await mdToHtml(md); }
        catch (e) { showStatus(e.message, true); return; }
        const fullHtml = wrapForWord(html, title, sigs);
        const blob = new Blob(['\uFEFF', fullHtml], { type: 'application/msword;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${title}.doc`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        showStatus(`已导出 Word：${title}.doc（含 ${sigs.length} 个签名）`);
    }
    async function exportMdToPdf(btn) {
        const md = document.getElementById('dgut-doc-md')?.value || '';
        if (!md.trim()) { showStatus(errFull(ERR.DOC_EMPTY_MD), true); return; }
        const title = (document.getElementById('dgut-doc-title')?.value || getDocTitle()).trim() || `文档_${dateKey()}`;
        saveDocDraft(md); saveDocTitle(title);
        const sigs = getPickedSignatures();
        let html;
        try { html = await mdToHtml(md); }
        catch (e) { showStatus(e.message, true); return; }
        const inner = html + signaturesHtml(sigs);
        const oldText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
        startStatusTicker('正在生成 PDF');
        try {
            const blob = await htmlToPdfBlob(inner, title, (cur, tot) => {
                if (btn) btn.textContent = `生成中 ${cur}/${tot}`;
            });
            stopStatusTicker();
            imgDownloadBlob(blob, `${title}.pdf`);
            showStatus(`已导出 PDF：${title}.pdf（${imgFmtSize(blob.size)}）`);
        } catch (e) {
            stopStatusTicker();
            showStatus('PDF 生成失败：' + e.message, true);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = oldText; }
        }
    }
    async function exportMdToPrintView() {
        const md = document.getElementById('dgut-doc-md')?.value || '';
        if (!md.trim()) { showStatus(errFull(ERR.DOC_EMPTY_MD), true); return; }
        const title = (document.getElementById('dgut-doc-title')?.value || getDocTitle()).trim() || `文档_${dateKey()}`;
        saveDocDraft(md); saveDocTitle(title);
        const sigs = getPickedSignatures();
        let html;
        try { html = await mdToHtml(md); }
        catch (e) { showStatus(e.message, true); return; }
        const fullHtml = wrapForWord(html, title, sigs);
        const win = openPrintWindow(fullHtml);
        if (!win) { showStatus('弹窗被拦截：请允许本站弹窗后重试', true); return; }
        showStatus('已打开打印视图：可在打印对话框中选择"另存为 PDF"');
    }
    function createSignaturePad(canvas) {
        const ctx = canvas.getContext('2d');
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const resize = () => {
            const r = canvas.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            canvas.width = Math.round(r.width * dpr);
            canvas.height = Math.round(r.height * dpr);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#1D1B20';
        };
        canvas.__dgutPadResize = resize;   // 面板缩放时重新同步画板分辨率
        resize();
        let drawing = false, lastX = 0, lastY = 0;
        const pos = (e) => {
            const r = canvas.getBoundingClientRect();
            const p = e.touches ? (e.touches[0] || e.changedTouches[0]) : e;
            return { x: p.clientX - r.left, y: p.clientY - r.top };
        };
        const onStart = (e) => {
            e.preventDefault();
            drawing = true;
            const p = pos(e); lastX = p.x; lastY = p.y;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
            ctx.fillStyle = '#1D1B20';
            ctx.fill();
        };
        const onMove = (e) => {
            if (!drawing) return;
            e.preventDefault();
            const p = pos(e);
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            lastX = p.x; lastY = p.y;
        };
        const onEnd = () => { drawing = false; };
        canvas.addEventListener('mousedown', onStart);
        canvas.addEventListener('mousemove', onMove);
        canvas.addEventListener('mouseup', onEnd);
        canvas.addEventListener('mouseleave', onEnd);
        canvas.addEventListener('touchstart', onStart, { passive: false });
        canvas.addEventListener('touchmove', onMove, { passive: false });
        canvas.addEventListener('touchend', onEnd);
        canvas.addEventListener('touchcancel', onEnd);
        return {
            clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); },
            isEmpty() {
                try {
                    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                    for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) return false; }
                    return true;
                } catch (e) { return false; }
            },
            toDataURL() { return canvas.toDataURL('image/png'); },
            resize
        };
    }
    function getPickedSignatures() {
        const picked = Array.from(document.querySelectorAll('.dgut-sig-pick:checked')).map(c => c.dataset.id);
        if (!picked.length) return [];
        const all = getSignatures();
        return all.filter(s => picked.includes(String(s.id)));
    }
    function renderSignatureList() {
        const el = document.getElementById('dgut-sig-list');
        if (!el) return;
        const sigs = getSignatures();
        if (!sigs.length) {
            el.innerHTML = `<div style="font-size:12px;color:var(--dgut-on-surface-variant);padding:6px 0;">暂无保存的签名。画完后点「保存签名」。</div>`;
            return;
        }
        el.innerHTML = sigs.slice().reverse().map(s => `
            <div class="dgut-sig-card">
                <img src="${s.dataUrl}" alt="签名">
                <div class="dgut-sig-meta">
                    <input type="checkbox" class="dgut-sig-pick" data-id="${escapeHtml(String(s.id))}" style="cursor:pointer;accent-color:var(--dgut-primary);">
                    <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(s.name || '')}">${escapeHtml(s.name || '未命名')}</span>
                    <span class="dgut-sig-del" data-id="${escapeHtml(String(s.id))}" title="删除">×</span>
                </div>
            </div>`).join('');
        el.querySelectorAll('.dgut-sig-del').forEach(b => b.onclick = (ev) => {
            ev.stopPropagation();
            if (!confirm('删除此签名？')) return;
            deleteSignature(b.dataset.id);
            renderSignatureList();
        });
    }
    function renderDocToolView(ac) {
        const draft = getDocDraft();
        const title = getDocTitle();
        ac.innerHTML = actionHeader(ACTION_TITLES.doc, 'Markdown 转 Word / PDF（PDF 直出下载）+ 手绘电子签名') + `
            <div class="dgut-card">
                <div class="dgut-section-title">Markdown 内容</div>
                <textarea id="dgut-doc-md" class="dgut-textarea" placeholder="在此输入 Markdown 内容…&#10;支持标准语法：# 标题、**粗体**、*斜体*、- 列表、\`代码\`、\`\`\`代码块\`\`\`、> 引用、| 表格 | 等。" style="width:100%;min-height:180px;resize:vertical;font-family:Consolas,monospace;line-height:1.6;">${escapeHtml(draft)}</textarea>
                <div class="dgut-row" style="margin-top:10px;">
                    <input id="dgut-doc-title" class="dgut-input" placeholder="文件名" value="${escapeHtml(title)}" style="flex:1;min-width:140px;">
                    <button id="dgut-doc-preview" class="dgut-btn">${icons.list} 预览</button>
                    <button id="dgut-doc-word" class="dgut-btn">${icons.export} 导出 Word</button>
                    <button id="dgut-doc-pdf" class="dgut-btn dgut-btn-primary">${icons.export} 下载 PDF</button>
                    <button id="dgut-doc-print" class="dgut-btn">打印 PDF</button>
                    <button id="dgut-doc-clear" class="dgut-btn">清空</button>
                </div>
                <div id="dgut-doc-preview-box" style="display:none;"></div>
            </div>
            <div class="dgut-card">
                <div class="dgut-section-title">手绘电子签名</div>
                <div style="font-size:11px;color:var(--dgut-on-surface-variant);margin-bottom:8px;line-height:1.7;">在下方画板手写签名（支持鼠标/触屏/触控笔）。保存后勾选需要附加到导出文档末尾的签名。签名以透明 PNG 形式嵌入 Word/PDF。</div>
                <input id="dgut-sig-name" class="dgut-input" placeholder="签名标签（如：本人签名、导师签字）" style="width:100%;margin-bottom:8px;">
                <canvas id="dgut-sig-canvas"></canvas>
                <div class="dgut-row dgut-row--end" style="margin-top:10px;">
                    <button id="dgut-sig-clear" class="dgut-btn">清除画布</button>
                    <button id="dgut-sig-save" class="dgut-btn dgut-btn-primary">${icons.add} 保存签名</button>
                </div>
                <div style="font-size:12px;color:var(--dgut-on-surface);font-weight:600;margin:14px 0 6px;">已保存签名（勾选=附加到导出文档）</div>
                <div id="dgut-sig-list" style="display:flex;gap:10px;flex-wrap:wrap;"></div>
            </div>
            <div class="dgut-hint">
                <b>导出说明</b>：<br>
                · <b>下载 PDF</b>：生成需要几秒钟，请耐心等待<br>
                · <b>打印 PDF</b>：打开打印视图，在打印对话框中选择"另存为 PDF"（文字为矢量，体积更小）；<br>
                · 所有处理均在浏览器本地完成，内容不上传任何服务器。
            </div>`;
        const mdEl = ac.querySelector('#dgut-doc-md');
        const titleEl = ac.querySelector('#dgut-doc-title');
        const previewBox = ac.querySelector('#dgut-doc-preview-box');
        const pad = createSignaturePad(ac.querySelector('#dgut-sig-canvas'));
        mdEl.addEventListener('input', () => saveDocDraft(mdEl.value));
        titleEl.addEventListener('input', () => saveDocTitle(titleEl.value));
        ac.querySelector('#dgut-doc-preview').onclick = async () => {
            const md = mdEl.value;
            if (!md.trim()) { showStatus(errFull(ERR.DOC_EMPTY_MD), true); return; }
            try { const html = await mdToHtml(md); previewBox.style.display = 'block'; previewBox.innerHTML = html; }
            catch (e) { showStatus(e.message, true); }
        };
        ac.querySelector('#dgut-doc-word').onclick = exportMdToWord;
        ac.querySelector('#dgut-doc-pdf').onclick = (e) => exportMdToPdf(e.currentTarget);
        ac.querySelector('#dgut-doc-print').onclick = exportMdToPrintView;
        ac.querySelector('#dgut-doc-clear').onclick = () => {
            if (!confirm('清空 Markdown 内容？此操作不可撤销。')) return;
            mdEl.value = ''; saveDocDraft('');
            previewBox.style.display = 'none'; previewBox.innerHTML = '';
        };
        ac.querySelector('#dgut-sig-clear').onclick = () => pad.clear();
        ac.querySelector('#dgut-sig-save').onclick = () => {
            if (pad.isEmpty()) { showStatus('画板为空，请先手写签名', true); return; }
            const name = (ac.querySelector('#dgut-sig-name')?.value || '').trim() || '签名_' + new Date().toLocaleString('zh-CN');
            addSignature({ id: String(Date.now()) + '_' + Math.random().toString(36).slice(2, 7), name, dataUrl: pad.toDataURL(), at: Date.now() });
            pad.clear();
            ac.querySelector('#dgut-sig-name').value = '';
            renderSignatureList();
            showStatus('签名已保存');
        };
        renderSignatureList();
    }

    /* ============================================================
     * Word 转 PDF
     * ============================================================ */
    function wpBuildPrintHtml(innerHtml, title) {
        return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
    @page { size: A4; margin: 2cm; }
    html, body { margin: 0; padding: 0; }
    body { font-family: "PingFang SC", "Microsoft YaHei", SimSun, sans-serif; font-size: 12pt; line-height: 1.7; color: #1D1B20; padding: 20px; }
    h1 { font-size: 20pt; border-bottom: 1px solid #CAC4D0; padding-bottom: 4pt; }
    h2 { font-size: 16pt; } h3 { font-size: 14pt; } h4 { font-size: 12pt; }
    p { margin: 6pt 0; }
    code { background: #F3EDF7; padding: 1pt 4pt; border-radius: 3pt; font-family: Consolas, "Courier New", monospace; font-size: 10.5pt; }
    pre { background: #F7F2FA; padding: 10pt; border-radius: 6pt; overflow-x: auto; }
    pre code { background: transparent; padding: 0; }
    table { border-collapse: collapse; margin: 6pt 0; max-width: 100%; }
    th, td { border: 1pt solid #CAC4D0; padding: 4pt 8pt; font-size: 11pt; }
    th { background: #F3EDF7; }
    blockquote { border-left: 3pt solid #6750A4; padding-left: 10pt; color: #49454E; margin-left: 0; }
    ul, ol { margin: 6pt 0; padding-left: 20pt; }
    img { max-width: 100%; height: auto; }
    @media print { body { padding: 0; } }
</style>
</head>
<body>${innerHtml}</body>
</html>`;
    }
    async function wpParseDocxFile(file) {
        const mammoth = await ensureMammoth();
        if (!mammoth) throw new Error(errFull(ERR.WP_NO_MAMMOTH));
        const arrayBuffer = await file.arrayBuffer();
        const options = {
            styleMap: [
                "p[style-name='Title'] => h1:fresh",
                "p[style-name='Heading 1'] => h1:fresh",
                "p[style-name='Heading 2'] => h2:fresh",
                "p[style-name='Heading 3'] => h3:fresh",
                "p[style-name='Heading 4'] => h4:fresh"
            ],
            convertImage: mammoth.images.imgElement(function (image) {
                return image.read('base64').then(function (b64) {
                    return { src: 'data:' + image.contentType + ';base64,' + b64 };
                });
            })
        };
        const result = await mammoth.convertToHtml({ arrayBuffer }, options);
        return { html: result.value || '', messages: result.messages || [] };
    }
    function renderWordPdfView(ac) {
        ac.innerHTML = actionHeader(ACTION_TITLES.wordpdf, '本地解析 .docx → 直接下载 PDF / 打印视图 / 导出 .doc') + `
            <div class="dgut-hint">
                <b>使用步骤</b><br>
                1. 选择 <code>.docx</code> 文件（Word 2007 及以上格式）<br>
                2. 点「下载 PDF」→ 本地生成 A4 PDF 并直接保存，<b>无需打印对话框</b><br>
                3. 或点「打印 PDF」→ 新窗口按 <b>Ctrl/Cmd + P</b>，目标选「另存为 PDF」<br>
                4. 或点「导出为 .doc」下载 Word 可直接编辑的文件<br>
                <span style="color:var(--dgut-warn);">仅支持 <code>.docx</code>；旧版 <code>.doc</code> 二进制格式请先用 Word 另存为 .docx。</span><br>
                <b>依赖说明</b>：首次使用时会自动从 CDN 加载 mammoth / html2canvas / jsPDF（jsDelivr 主源，unpkg 备源，失败后走 GM 拉取），需联网。
            </div>
            <div class="dgut-card">
                <div class="dgut-row dgut-row--mb">
                    <input type="file" id="dgut-wp-file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" class="dgut-input" style="flex:1;min-width:0;">
                </div>
                <div class="dgut-row dgut-row--mb">
                    <input id="dgut-wp-title" class="dgut-input" placeholder="文档标题（用于文件名）" value="${escapeHtml(getDocTitle())}" style="flex:1;min-width:0;">
                </div>
                <div class="dgut-row dgut-row--end">
                    <button id="dgut-wp-pdf" class="dgut-btn dgut-btn-primary">${icons.export} 下载 PDF</button>
                    <button id="dgut-wp-print" class="dgut-btn">打印 PDF</button>
                    <button id="dgut-wp-word" class="dgut-btn">${icons.doc} 导出为 .doc</button>
                </div>
                <div id="dgut-wp-status" style="font-size:12px;color:var(--dgut-on-surface-variant);margin-top:10px;line-height:1.7;"></div>
            </div>
            <div class="dgut-card dgut-card--tight">
                <div class="dgut-section-title">内容预览</div>
                <div id="dgut-wp-preview" style="max-height:340px;overflow:auto;padding:12px;background:var(--dgut-surface-3);border:1px solid var(--dgut-outline-variant);border-radius:10px;color:var(--dgut-on-surface);font-size:13px;line-height:1.7;">
                    <span style="color:var(--dgut-on-surface-variant);font-size:12px;">选择文件后点击上方按钮进行转换…</span>
                </div>
            </div>`;
        const fileEl = ac.querySelector('#dgut-wp-file');
        const titleEl = ac.querySelector('#dgut-wp-title');
        const statusEl = ac.querySelector('#dgut-wp-status');
        const previewEl = ac.querySelector('#dgut-wp-preview');
        const setStatus = (msg, isErr) => {
            statusEl.innerHTML = `<span style="color:${isErr ? 'var(--dgut-error)' : 'var(--dgut-on-surface-variant)'};">${escapeHtml(msg)}</span>`;
        };
        const resolveTitle = (file) => (titleEl.value || '').trim() || file.name.replace(/\.docx$/i, '') || `Word文档_${dateKey()}`;
        ac.querySelector('#dgut-wp-pdf').onclick = async (e) => {
            const btn = e.currentTarget;
            const file = fileEl.files && fileEl.files[0];
            if (!file) { setStatus(errFull(ERR.WP_NO_FILE), true); return; }
            const oldText = btn.textContent;
            btn.disabled = true; btn.textContent = '生成中…';
            setStatus('正在加载依赖并解析文档…');
            try {
                const { html, messages } = await wpParseDocxFile(file);
                if (!html.trim()) throw new Error(errFull(ERR.WP_EMPTY));
                previewEl.innerHTML = html;
                const title = resolveTitle(file);
                saveDocTitle(title);
                setStatus('正在生成 PDF（大文档可能需要十几秒）…');
                const blob = await htmlToPdfBlob(html, title, (cur, tot) => { btn.textContent = `生成中 ${cur}/${tot}`; });
                imgDownloadBlob(blob, `${title}.pdf`);
                const warns = (messages || []).filter(m => m.type === 'warning').length;
                setStatus(`? 已导出 PDF：${title}.pdf（${imgFmtSize(blob.size)}）${warns ? `，${warns} 条兼容性警告` : ''}`);
            } catch (err) {
                setStatus('转换失败：' + err.message, true);
            } finally {
                btn.disabled = false; btn.textContent = oldText;
            }
        };
        ac.querySelector('#dgut-wp-print').onclick = async () => {
            const file = fileEl.files && fileEl.files[0];
            if (!file) { setStatus(errFull(ERR.WP_NO_FILE), true); return; }
            setStatus('正在解析…');
            try {
                const { html, messages } = await wpParseDocxFile(file);
                if (!html.trim()) throw new Error(errFull(ERR.WP_EMPTY));
                previewEl.innerHTML = html;
                const title = resolveTitle(file);
                saveDocTitle(title);
                const win = openPrintWindow(wpBuildPrintHtml(html, title));
                if (!win) throw new Error('弹窗被拦截，请允许本站弹窗后重试');
                const warns = (messages || []).filter(m => m.type === 'warning').length;
                setStatus(`? 解析完成，已在打印视图中打开。${warns ? `（${warns} 条兼容性警告，可忽略）` : ''}`);
            } catch (e) { setStatus('转换失败：' + e.message, true); }
        };
        ac.querySelector('#dgut-wp-word').onclick = async () => {
            const file = fileEl.files && fileEl.files[0];
            if (!file) { setStatus(errFull(ERR.WP_NO_FILE), true); return; }
            setStatus('正在解析…');
            try {
                const { html } = await wpParseDocxFile(file);
                if (!html.trim()) throw new Error(errFull(ERR.WP_EMPTY));
                previewEl.innerHTML = html;
                const title = resolveTitle(file);
                saveDocTitle(title);
                const full = wpBuildPrintHtml(html, title);
                const blob = new Blob(['\uFEFF', full], { type: 'application/msword;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `${title}.doc`;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                setStatus(`? 已导出：${title}.doc`);
            } catch (e) { setStatus('导出失败：' + e.message, true); }
        };
    }

    /* ============================================================
     * 图片工具（像素处理走 Web Worker）
     * ============================================================ */
    const IMG_RATIO_PRESETS = [
        { id: 'orig',   label: '原始比例',             w: 0,  h: 0 },
        { id: '1:1',    label: '1 : 1（正方形）',       w: 1,  h: 1 },
        { id: '4:3',    label: '4 : 3（传统屏）',       w: 4,  h: 3 },
        { id: '3:4',    label: '3 : 4（竖版）',         w: 3,  h: 4 },
        { id: '16:9',   label: '16 : 9（宽屏）',        w: 16, h: 9 },
        { id: '9:16',   label: '9 : 16（竖屏）',        w: 9,  h: 16 },
        { id: '3:2',    label: '3 : 2（单反）',         w: 3,  h: 2 },
        { id: '2:3',    label: '2 : 3（竖版单反）',     w: 2,  h: 3 },
        { id: '21:9',   label: '21 : 9（超宽）',        w: 21, h: 9 },
        { id: 'custom', label: '自定义（手动填宽高）',  w: -1, h: -1 }
    ];
    let gImgState = null;

    /* ---------- Web Worker：像素级滤镜多线程执行 ---------- */
    const IMG_WORKER_SRC = `
'use strict';
function applyConvolution(data, width, height, kernel, divisor, offset) {
    const out = new Uint8ClampedArray(data.length);
    const kh = kernel.length, kw = kernel[0].length;
    const cy = (kh >> 1), cx = (kw >> 1);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0;
            for (let ky = 0; ky < kh; ky++) {
                const py = Math.min(height - 1, Math.max(0, y + ky - cy));
                for (let kx = 0; kx < kw; kx++) {
                    const px = Math.min(width - 1, Math.max(0, x + kx - cx));
                    const idx = (py * width + px) * 4;
                    const k = kernel[ky][kx];
                    r += data[idx] * k; g += data[idx + 1] * k; b += data[idx + 2] * k;
                }
            }
            const i = (y * width + x) * 4;
            out[i]     = r / divisor + offset;
            out[i + 1] = g / divisor + offset;
            out[i + 2] = b / divisor + offset;
            out[i + 3] = data[i + 3];
        }
    }
    return out;
}
function sharpen(data, width, height, amount) {
    const a = Math.max(0.05, Math.min(3, Number(amount) || 1));
    const center = 1 + 4 * a;
    return applyConvolution(data, width, height, [[0, -a, 0], [-a, center, -a], [0, -a, 0]], 1, 0);
}
function grayscale(data, width, height) {
    const out = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
        const v = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        out[i] = out[i + 1] = out[i + 2] = v;
        out[i + 3] = data[i + 3];
    }
    return out;
}
function equalize(data, width, height) {
    const total = width * height;
    const hist = new Uint32Array(256);
    const lumArr = new Uint8ClampedArray(total);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        lumArr[j] = lum; hist[lum]++;
    }
    const cdf = new Uint32Array(256);
    let acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; cdf[i] = acc; }
    let cdfMin = 0;
    for (let i = 0; i < 256; i++) { if (cdf[i] > 0) { cdfMin = cdf[i]; break; } }
    const denom = Math.max(1, total - cdfMin);
    const map = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) map[i] = Math.round((cdf[i] - cdfMin) / denom * 255);
    const out = new Uint8ClampedArray(data.length);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const lum = lumArr[j];
        const newLum = map[lum];
        const scale = lum > 0 ? Math.min(4, newLum / lum) : 1;
        out[i]     = Math.min(255, Math.round(data[i] * scale));
        out[i + 1] = Math.min(255, Math.round(data[i + 1] * scale));
        out[i + 2] = Math.min(255, Math.round(data[i + 2] * scale));
        out[i + 3] = data[i + 3];
    }
    return out;
}
self.onmessage = function (e) {
    const d = e.data || {};
    const id = d.id, width = d.width, height = d.height, params = d.params || {};
    try {
        let data = new Uint8ClampedArray(d.buffer);
        if (params.sharpen) data = sharpen(data, width, height, params.sharpenAmount);
        if (params.bw)      data = grayscale(data, width, height);
        if (params.eq)      data = equalize(data, width, height);
        self.postMessage({ id: id, ok: true, buffer: data.buffer }, [data.buffer]);
    } catch (err) {
        self.postMessage({ id: id, ok: false, error: (err && err.message) ? err.message : String(err) });
    }
};
`;

    let gImgWorker = null, gImgWorkerFailed = false, gImgTaskId = 0;
    const gImgPending = new Map();

    function getImgWorker() {
        if (gImgWorkerFailed) return null;
        if (gImgWorker) return gImgWorker;
        if (typeof Worker !== 'function') { gImgWorkerFailed = true; return null; }
        try {
            const blob = new Blob([IMG_WORKER_SRC], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            const w = new Worker(url);
            w.onmessage = (e) => {
                const d = e.data || {};
                const p = gImgPending.get(d.id);
                if (!p) return;
                gImgPending.delete(d.id);
                if (d.ok) p.resolve(d.buffer);
                else p.reject(new Error(d.error || 'Worker 处理失败'));
            };
            w.onerror = () => {
                gImgWorkerFailed = true;
                gImgWorker = null;
                gImgPending.forEach(p => p.reject(new Error('Worker 运行错误')));
                gImgPending.clear();
            };
            gImgWorker = w;
            log('[图片] Web Worker 已启动，像素处理将多线程执行');
            return w;
        } catch (e) {
            gImgWorkerFailed = true;
            return null;
        }
    }

    function imgWorkerRun(buffer, width, height, params) {
        const w = getImgWorker();
        if (!w) return Promise.reject(new Error('Worker 不可用'));
        const id = ++gImgTaskId;
        return new Promise((resolve, reject) => {
            gImgPending.set(id, { resolve, reject });
            try { w.postMessage({ id, buffer, width, height, params }, [buffer]); }
            catch (e) { gImgPending.delete(id); reject(e); return; }
            setTimeout(() => {
                if (gImgPending.has(id)) { gImgPending.delete(id); reject(new Error('Worker 超时')); }
            }, 60000);
        });
    }

    async function imgApplyFiltersAsync(canvas, cfg) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        if (!w || !h) return;
        if (getImgWorker()) {
            try {
                const imgData = ctx.getImageData(0, 0, w, h);
                const buf = await imgWorkerRun(imgData.data.buffer, w, h, {
                    sharpen: cfg.sharpen, sharpenAmount: cfg.sharpenAmount,
                    bw: cfg.bw, eq: cfg.eq
                });
                ctx.putImageData(new ImageData(new Uint8ClampedArray(buf), w, h), 0, 0);
                return;
            } catch (e) {
                log('[图片] Worker 处理失败，回退主线程：', e.message);
            }
        }
        // 主线程兜底（注意 buffer 可能已被 transfer 清空，需重新取）
        let d = ctx.getImageData(0, 0, w, h);
        if (cfg.sharpen) d = imgApplySharpen(d, cfg.sharpenAmount);
        if (cfg.bw) d = imgApplyBlackWhite(d);
        if (cfg.eq) d = imgApplyHistEqualize(d);
        ctx.putImageData(d, 0, 0);
    }

    /* ---------- 主线程版的滤镜实现（作为 Worker 不可用时的兜底） ---------- */
    function imgApplyConvolution(imageData, kernel, divisor = 1, offset = 0) {
        const { width, height, data } = imageData;
        const out = new Uint8ClampedArray(data.length);
        const kh = kernel.length, kw = kernel[0].length;
        const cy = Math.floor(kh / 2), cx = Math.floor(kw / 2);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let r = 0, g = 0, b = 0;
                for (let ky = 0; ky < kh; ky++) {
                    const py = Math.min(height - 1, Math.max(0, y + ky - cy));
                    for (let kx = 0; kx < kw; kx++) {
                        const px = Math.min(width - 1, Math.max(0, x + kx - cx));
                        const idx = (py * width + px) * 4;
                        const k = kernel[ky][kx];
                        r += data[idx] * k; g += data[idx + 1] * k; b += data[idx + 2] * k;
                    }
                }
                const i = (y * width + x) * 4;
                out[i]     = r / divisor + offset;
                out[i + 1] = g / divisor + offset;
                out[i + 2] = b / divisor + offset;
                out[i + 3] = data[i + 3];
            }
        }
        return new ImageData(out, width, height);
    }
    function imgApplySharpen(imageData, amount = 1) {
        const a = Math.max(0.05, Math.min(3, Number(amount) || 1));
        const center = 1 + 4 * a;
        return imgApplyConvolution(imageData, [[0, -a, 0], [-a, center, -a], [0, -a, 0]], 1, 0);
    }
    function imgApplyBlackWhite(imageData) {
        /* 「黑白」= 转灰度图（保留明暗层次），不是二值化 */
        const { width, height, data } = imageData;
        const out = new Uint8ClampedArray(data.length);
        for (let i = 0; i < data.length; i += 4) {
            const v = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            out[i] = out[i + 1] = out[i + 2] = v;
            out[i + 3] = data[i + 3];
        }
        return new ImageData(out, width, height);
    }
    function imgApplyHistEqualize(imageData) {
        const { width, height, data } = imageData;
        const hist = new Uint32Array(256);
        const lumArr = new Uint8ClampedArray(width * height);
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            lumArr[j] = lum; hist[lum]++;
        }
        const cdf = new Uint32Array(256); let acc = 0;
        for (let i = 0; i < 256; i++) { acc += hist[i]; cdf[i] = acc; }
        let cdfMin = 0;
        for (let i = 0; i < 256; i++) { if (cdf[i] > 0) { cdfMin = cdf[i]; break; } }
        const total = width * height;
        const denom = Math.max(1, total - cdfMin);
        const map = new Uint8ClampedArray(256);
        for (let i = 0; i < 256; i++) map[i] = Math.round((cdf[i] - cdfMin) / denom * 255);
        const out = new Uint8ClampedArray(data.length);
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            const lum = lumArr[j];
            const newLum = map[lum];
            const scale = lum > 0 ? Math.min(4, newLum / lum) : 1;
            out[i]     = Math.min(255, Math.round(data[i] * scale));
            out[i + 1] = Math.min(255, Math.round(data[i + 1] * scale));
            out[i + 2] = Math.min(255, Math.round(data[i + 2] * scale));
            out[i + 3] = data[i + 3];
        }
        return new ImageData(out, width, height);
    }

    /* ---------- 通用工具 ---------- */
    function imgFmtSize(bytes) {
        if (bytes === undefined || bytes === null || isNaN(bytes)) return '--';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    }
    function imgFileToImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => resolve({ img, dataUrl: reader.result, file });
                img.onerror = () => reject(new Error(errFull(ERR.IMG_DECODE_FAIL)));
                img.src = reader.result;
            };
            reader.onerror = () => reject(new Error(errFull(ERR.IMG_READ_FAIL)));
            reader.readAsDataURL(file);
        });
    }
    function imgCanvasToBlob(canvas, mime, quality) {
        return new Promise((resolve, reject) => {
            try {
                canvas.toBlob((b) => {
                    if (!b) return reject(new Error(errFull(ERR.IMG_ENCODE_FAIL)));
                    if (mime === 'image/webp' && b.type !== 'image/webp') return reject(new Error(errFull(ERR.IMG_ENCODE_FAIL, '浏览器不支持 WebP 编码')));
                    resolve(b);
                }, mime, typeof quality === 'number' ? quality : undefined);
            } catch (e) { reject(e); }
        });
    }
    function imgDownloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    function imgProgressiveScale(src, targetW, targetH) {
        targetW = Math.max(1, Math.round(targetW));
        targetH = Math.max(1, Math.round(targetH));
        let cur = src, cw = src.width, ch = src.height, guard = 0;
        while (guard++ < 16 && (cw > targetW * 2 || ch > targetH * 2)) {
            const nw = Math.max(targetW, Math.round(cw / 2));
            const nh = Math.max(targetH, Math.round(ch / 2));
            if (nw >= cw && nh >= ch) break;
            const nc = document.createElement('canvas');
            nc.width = nw; nc.height = nh;
            const nx = nc.getContext('2d');
            nx.imageSmoothingEnabled = true;
            nx.imageSmoothingQuality = 'high';
            nx.drawImage(cur, 0, 0, nw, nh);
            cur = nc; cw = nw; ch = nh;
        }
        if (cw === targetW && ch === targetH) return cur;
        const fc = document.createElement('canvas');
        fc.width = targetW; fc.height = targetH;
        const fx = fc.getContext('2d');
        fx.imageSmoothingEnabled = true;
        fx.imageSmoothingQuality = 'high';
        fx.drawImage(cur, 0, 0, targetW, targetH);
        return fc;
    }
    function imgComputeTargetSize(srcW, srcH, cfg) {
        if (cfg.sizeMode === 'none') return { w: srcW, h: srcH };
        if (cfg.sizeMode === 'percent') {
            const p = Math.max(1, Math.min(1000, Number(cfg.percent) || 100)) / 100;
            return { w: Math.max(1, Math.round(srcW * p)), h: Math.max(1, Math.round(srcH * p)) };
        }
        const preset = IMG_RATIO_PRESETS.find(p => p.id === cfg.ratioPreset) || IMG_RATIO_PRESETS[0];
        let rw = srcW, rh = srcH;
        if (preset.id !== 'orig' && preset.id !== 'custom' && preset.w > 0 && preset.h > 0) { rw = preset.w; rh = preset.h; }
        const W = Math.round(Number(cfg.targetW) || 0);
        const H = Math.round(Number(cfg.targetH) || 0);
        if (W > 0 && H > 0) return { w: W, h: H };
        if (W > 0) return { w: W, h: Math.max(1, Math.round(W * rh / rw)) };
        if (H > 0) return { w: Math.max(1, Math.round(H * rw / rh)), h: H };
        return { w: srcW, h: srcH };
    }
    function imgDrawResized(srcCanvas, targetW, targetH, fit, smooth) {
        targetW = Math.max(1, Math.round(targetW));
        targetH = Math.max(1, Math.round(targetH));
        const sw = srcCanvas.width, sh = srcCanvas.height;
        const canvas = document.createElement('canvas');
        canvas.width = targetW; canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = (smooth !== 'none');
        ctx.imageSmoothingQuality = 'high';
        let dx, dy, dw, dh;
        if (fit === 'fill') { dx = 0; dy = 0; dw = targetW; dh = targetH; }
        else {
            const s = fit === 'contain' ? Math.min(targetW / sw, targetH / sh) : Math.max(targetW / sw, targetH / sh);
            dw = sw * s; dh = sh * s;
            dx = (targetW - dw) / 2; dy = (targetH - dh) / 2;
        }
        const shrink = Math.min(dw / sw, dh / sh);
        let drawSrc = srcCanvas, drawX = dx, drawY = dy, drawW = dw, drawH = dh;
        if (smooth === 'high' && shrink < 0.5 && !(Math.abs(dw - sw) < 0.5 && Math.abs(dh - sh) < 0.5)) {
            const scaled = imgProgressiveScale(srcCanvas, dw, dh);
            drawSrc = scaled;
            drawW = scaled.width; drawH = scaled.height;
            drawX = (targetW - drawW) / 2; drawY = (targetH - drawH) / 2;
        }
        if (fit === 'cover') {
            ctx.save(); ctx.beginPath(); ctx.rect(0, 0, targetW, targetH); ctx.clip();
            ctx.drawImage(drawSrc, drawX, drawY, drawW, drawH);
            ctx.restore();
        } else {
            ctx.drawImage(drawSrc, drawX, drawY, drawW, drawH);
        }
        return canvas;
    }
    async function imgCompressByResize(canvas, targetBytes, mime, smooth) {
        let cur = canvas, last = null;
        for (let iter = 0; iter < 10; iter++) {
            let blob;
            try { blob = await imgCanvasToBlob(cur, mime, 0.72); }
            catch (e) { break; }
            if (blob.size <= targetBytes) return blob;
            last = blob;
            const nw = Math.max(1, Math.round(cur.width * 0.82));
            const nh = Math.max(1, Math.round(cur.height * 0.82));
            if (nw === cur.width && nh === cur.height) break;
            const nc = document.createElement('canvas');
            nc.width = nw; nc.height = nh;
            const c = nc.getContext('2d');
            c.imageSmoothingEnabled = smooth !== 'none';
            c.imageSmoothingQuality = 'high';
            c.drawImage(cur, 0, 0, nw, nh);
            cur = nc;
        }
        return last;
    }
    async function imgCompressToTargetSize(canvas, targetBytes, mime, allowResize, smooth) {
        if (mime === 'image/png') {
            const first = await imgCanvasToBlob(canvas, mime, 1.0);
            if (first.size <= targetBytes) return { blob: first, achieved: true };
            if (!allowResize) return { blob: first, achieved: false };
            const resized = await imgCompressByResize(canvas, targetBytes, mime, smooth);
            return { blob: resized || first, achieved: !!(resized && resized.size <= targetBytes) };
        }
        const maxBlob = await imgCanvasToBlob(canvas, mime, 1.0);
        if (maxBlob.size <= targetBytes) return { blob: maxBlob, achieved: true };
        let lo = 0.01, hi = 1.0, best = null;
        for (let i = 0; i < 12; i++) {
            const mid = (lo + hi) / 2;
            let blob;
            try { blob = await imgCanvasToBlob(canvas, mime, mid); }
            catch (e) { break; }
            if (blob.size <= targetBytes) { best = blob; lo = mid; }
            else { hi = mid; }
        }
        if (best) return { blob: best, achieved: true };
        let minBlob;
        try { minBlob = await imgCanvasToBlob(canvas, mime, 0.01); }
        catch (e) { minBlob = null; }
        if (!allowResize) return { blob: minBlob || maxBlob, achieved: false };
        const resized = await imgCompressByResize(canvas, targetBytes, mime, smooth);
        return { blob: resized || minBlob || maxBlob, achieved: !!(resized && resized.size <= targetBytes) };
    }
    async function imgInflateToSize(blob, targetBytes, mode) {
        if (blob.size >= targetBytes) return blob;
        const buf = await blob.arrayBuffer();
        const padLen = targetBytes - buf.byteLength;
        if (padLen <= 0) return blob;
        const combined = new Uint8Array(buf.byteLength + padLen);
        combined.set(new Uint8Array(buf), 0);
        if (mode === 'random') {
            let seed = 0x13579BDF >>> 0;
            for (let i = buf.byteLength; i < combined.length; i++) {
                seed = (seed * 1664525 + 1013904223) >>> 0;
                combined[i] = seed & 0xff;
            }
        }
        return new Blob([combined], { type: blob.type });
    }
    function imgLoadCfg() {
        const d = {
            sizeMode: 'none', percent: 100, targetW: 0, targetH: 0,
            ratioPreset: 'orig', fit: 'contain', format: 'keep', quality: 92,
            targetSizeKB: 0, allowResize: false, inflateKB: 0, inflateMode: 'random',
            sharpen: false, sharpenAmount: 1, bw: false, eq: false, smooth: 'high'
        };
        return Object.assign(d, GM_getValue(IMG_CFG_KEY, {}) || {});
    }
    function imgSaveCfg(cfg) { GM_setValue(IMG_CFG_KEY, Object.assign(imgLoadCfg(), cfg)); }
    function imgReadCfg(ac) {
        const q = (sel) => ac.querySelector(sel);
        const num = (sel, dft) => { const v = Number(q(sel)?.value); return isNaN(v) ? dft : v; };
        return {
            sizeMode: q('#dgut-img-sizemode')?.value || 'none',
            percent: num('#dgut-img-percent', 100),
            targetW: num('#dgut-img-w', 0),
            targetH: num('#dgut-img-h', 0),
            ratioPreset: q('#dgut-img-ratio')?.value || 'orig',
            fit: q('#dgut-img-fit')?.value || 'contain',
            format: q('#dgut-img-format')?.value || 'keep',
            quality: num('#dgut-img-quality', 92) / 100,
            targetSizeKB: num('#dgut-img-target', 0),
            allowResize: !!q('#dgut-img-allow-resize')?.checked,
            inflateKB: num('#dgut-img-inflate', 0),
            inflateMode: q('#dgut-img-inflate-mode')?.value || 'random',
            sharpen: !!q('#dgut-img-sharpen')?.checked,
            sharpenAmount: num('#dgut-img-sharpen-amt', 1),
            bw: !!q('#dgut-img-bw')?.checked,
            eq: !!q('#dgut-img-eq')?.checked,
            smooth: q('#dgut-img-smooth')?.value || 'high'
        };
    }
    async function imgRunPipeline(ac) {
        const st = gImgState;
        if (!st || !st.img) throw new Error(errFull(ERR.IMG_NO_FILE));
        const cfg = imgReadCfg(ac);
        let canvas = document.createElement('canvas');
        canvas.width = st.img.naturalWidth; canvas.height = st.img.naturalHeight;
        let ctx = canvas.getContext('2d');
        ctx.drawImage(st.img, 0, 0);
        if (cfg.sharpen || cfg.bw || cfg.eq) await imgApplyFiltersAsync(canvas, cfg);
        const tgt = imgComputeTargetSize(canvas.width, canvas.height, cfg);
        if (tgt.w !== canvas.width || tgt.h !== canvas.height) canvas = imgDrawResized(canvas, tgt.w, tgt.h, cfg.fit, cfg.smooth);
        let mime;
        switch (cfg.format) {
            case 'jpeg': mime = 'image/jpeg'; break;
            case 'webp': mime = 'image/webp'; break;
            case 'png':  mime = 'image/png';  break;
            default:
                mime = (st.file && st.file.type) || 'image/png';
                if (mime === 'image/jpg') mime = 'image/jpeg';
        }
        let blob, achieved = true, targetBytes = 0;
        let capped = false;
        if (cfg.targetSizeKB > 0) {
            targetBytes = cfg.targetSizeKB * 1024;
            const r = await imgCompressToTargetSize(canvas, targetBytes, mime, cfg.allowResize, cfg.smooth);
            blob = r.blob; achieved = r.achieved;
        } else {
            blob = await imgCanvasToBlob(canvas, mime, cfg.quality);
            /* 处理（锐化/灰度/亮度均匀/缩放）后重新编码可能比原图大：
               JPEG/WebP 时自动降一点质量，尽量不超过原图大小；PNG 无损无法这样压。 */
            const origSize = (st.file && st.file.size) || 0;
            const changed = cfg.sharpen || cfg.bw || cfg.eq || canvas.width !== st.img.naturalWidth || canvas.height !== st.img.naturalHeight;
            if (origSize > 0 && blob.size > origSize && changed && /^image\/(jpeg|webp)$/.test(mime)) {
                let q = Math.min(0.95, Number(cfg.quality) || 0.92);
                let best = blob;
                for (let i = 0; i < 10 && best.size > origSize && q > 0.6; i++) {
                    q = Math.max(0.6, q - 0.06);
                    const b = await imgCanvasToBlob(canvas, mime, q);
                    if (b.size < best.size) best = b;
                }
                if (best.size < blob.size) { blob = best; capped = true; }
            }
        }
        if (!blob) throw new Error(errFull(ERR.IMG_ENCODE_FAIL));
        let inflated = false;
        if (cfg.inflateKB > 0 && blob.size < cfg.inflateKB * 1024) {
            blob = await imgInflateToSize(blob, cfg.inflateKB * 1024, cfg.inflateMode);
            inflated = true;
        }
        return { canvas, blob, mime, inflated, achieved, targetBytes, capped };
    }
    function imgExtFromMime(mime) {
        if (mime === 'image/jpeg') return 'jpg';
        if (mime === 'image/webp') return 'webp';
        if (mime === 'image/png') return 'png';
        if (mime === 'image/gif') return 'gif';
        return 'png';
    }
    function renderImageToolView(ac) {
        const saved = imgLoadCfg();
        const ratioOpts = IMG_RATIO_PRESETS.map(p => `<option value="${p.id}" ${p.id === saved.ratioPreset ? 'selected' : ''}>${p.label}</option>`).join('');
        const opt = (v, cur) => v === cur ? ' selected' : '';
        ac.innerHTML = actionHeader(ACTION_TITLES.imagetool, '缩放 · 压缩到指定大小 · 增大文件 · 高质量平滑 / 锐化 / 灰度 / 亮度均匀（像素处理多线程）') + `
            <div class="dgut-hint">
                <b>说明</b><br>
                · 所有处理均在浏览器本地完成，图片不上传服务器。<br>
                · <b>像素滤镜（锐化/灰度/亮度均匀）默认在 Web Worker 中执行</b>，不阻塞主线程；不可用时自动回退主线程。<br>
                · <b>平滑</b>除极限情况下建议保持「高质量」。<br>
                · 压缩：填了「目标大小」时，脚本自动调节质量逼近该大小；未填时，使用「输出质量」。<br>
                · 锐化会增加画面细节，JPEG/WebP 默认会自动压低一点质量，尽量不超过原图大小。<br>
                · 增大：将图片增大到指定大小，注意不是超分。
            </div>
            <div class="dgut-card">
                <div class="dgut-row dgut-row--mb">
                    <input type="file" id="dgut-img-file" accept="image/*" class="dgut-input" style="flex:1;min-width:0;">
                    <button id="dgut-img-reset" class="dgut-btn" style="flex:none;">重置</button>
                </div>
                <div id="dgut-img-info" style="font-size:12px;color:var(--dgut-on-surface-variant);margin-bottom:10px;line-height:1.7;">尚未选择图片。</div>
                <div style="background:var(--dgut-surface-2);border:1px solid var(--dgut-outline-variant);border-radius:10px;padding:10px;text-align:center;">
                    <canvas id="dgut-img-preview" style="max-width:100%;max-height:300px;border-radius:6px;background:repeating-conic-gradient(var(--dgut-surface-3) 0% 25%, var(--dgut-surface-2) 0% 50%) 50% / 16px 16px;"></canvas>
                </div>
            </div>
            <div class="dgut-card">
                <div class="dgut-section-title">缩放</div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label">模式
                        <select id="dgut-img-sizemode" class="dgut-select" style="padding:5px 8px;">
                            <option value="none"${opt('none', saved.sizeMode)}>不缩放</option>
                            <option value="percent"${opt('percent', saved.sizeMode)}>按百分比</option>
                            <option value="dimensions"${opt('dimensions', saved.sizeMode)}>按像素尺寸</option>
                        </select>
                    </label>
                    <label class="dgut-label" data-when="percent">百分比
                        <input type="number" id="dgut-img-percent" class="dgut-input" value="${saved.percent}" min="1" max="1000" style="width:70px;padding:4px 6px;"> %
                    </label>
                    <label class="dgut-label" data-when="dimensions">宽
                        <input type="number" id="dgut-img-w" class="dgut-input" placeholder="px" min="1" style="width:80px;padding:4px 6px;"> px
                    </label>
                    <label class="dgut-label" data-when="dimensions">高
                        <input type="number" id="dgut-img-h" class="dgut-input" placeholder="px" min="1" style="width:80px;padding:4px 6px;"> px
                    </label>
                    <label class="dgut-label" data-when="dimensions">比例
                        <select id="dgut-img-ratio" class="dgut-select" style="padding:5px 8px;">${ratioOpts}</select>
                    </label>
                    <label class="dgut-label" data-when="dimensions">适配
                        <select id="dgut-img-fit" class="dgut-select" style="padding:5px 8px;">
                            <option value="contain"${opt('contain', saved.fit)}>包含（完整显示，留边）</option>
                            <option value="cover"${opt('cover', saved.fit)}>覆盖（铺满，裁剪边缘）</option>
                            <option value="fill"${opt('fill', saved.fit)}>拉伸（拉伸填满）</option>
                        </select>
                    </label>
                </div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label">平滑
                        <select id="dgut-img-smooth" class="dgut-select" style="padding:5px 8px;">
                            <option value="high"${opt('high', saved.smooth)}>高质量</option>
                            <option value="browser"${opt('browser', saved.smooth)}>标准</option>
                            <option value="none"${opt('none', saved.smooth)}>关闭</option>
                        </select>
                    </label>
                    <span style="font-size:11px;color:var(--dgut-outline);">缩小较多时选「高质量」，可减轻毛糙</span>
                </div>
            </div>
            <div class="dgut-card">
                <div class="dgut-section-title">图像处理 <span style="font-weight:400;font-size:11px;color:var(--dgut-on-surface-variant);">（Web Worker 多线程）</span></div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label"><input type="checkbox" id="dgut-img-sharpen" ${saved.sharpen ? 'checked' : ''}> 锐化</label>
                    <label class="dgut-label">强度
                        <input type="number" id="dgut-img-sharpen-amt" class="dgut-input" value="${saved.sharpenAmount}" min="0.1" max="3" step="0.1" style="width:60px;padding:4px 6px;">
                    </label>
                    <span style="font-size:11px;color:var(--dgut-outline);">照片压缩后若显毛糙，关掉锐化试试</span>
                </div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label"><input type="checkbox" id="dgut-img-bw" ${saved.bw ? 'checked' : ''}> 黑白（转灰度）</label>
                    <span style="font-size:11px;color:var(--dgut-outline);">保留明暗层次，不是二值化</span>
                </div>
                <div class="dgut-row">
                    <label class="dgut-label"><input type="checkbox" id="dgut-img-eq" ${saved.eq ? 'checked' : ''}> 亮度均匀</label>
                </div>
            </div>
            <div class="dgut-card">
                <div class="dgut-section-title">输出</div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label">格式
                        <select id="dgut-img-format" class="dgut-select" style="padding:5px 8px;">
                            <option value="keep"${opt('keep', saved.format)}>保持原格式</option>
                            <option value="jpeg"${opt('jpeg', saved.format)}>JPEG</option>
                            <option value="png"${opt('png', saved.format)}>PNG</option>
                            <option value="webp"${opt('webp', saved.format)}>WebP</option>
                        </select>
                    </label>
                </div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label">压缩到目标大小
                        <input type="number" id="dgut-img-target" class="dgut-input" placeholder="留空=不限" min="0" value="${saved.targetSizeKB || ''}" style="width:90px;padding:4px 6px;"> KB
                    </label>
                    <label class="dgut-label">
                        <input type="checkbox" id="dgut-img-allow-resize" ${saved.allowResize ? 'checked' : ''}> 允许降低分辨率
                    </label>
                </div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label">输出质量
                        <input type="number" id="dgut-img-quality" class="dgut-input" value="${saved.quality}" min="1" max="100" style="width:60px;padding:4px 6px;"> %
                        <span id="dgut-img-quality-note" style="font-size:11px;color:var(--dgut-outline);"></span>
                    </label>
                </div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label">增大到
                        <input type="number" id="dgut-img-inflate" class="dgut-input" placeholder="留空=不增大" min="0" value="${saved.inflateKB || ''}" style="width:90px;padding:4px 6px;"> KB
                    </label>
                    <label class="dgut-label">填充
                        <select id="dgut-img-inflate-mode" class="dgut-select" style="padding:5px 8px;">
                            <option value="random"${opt('random', saved.inflateMode)}>随机填充</option>
                            <option value="zero"${opt('zero', saved.inflateMode)}>全零填充</option>
                        </select>
                    </label>
                </div>
                <div id="dgut-img-status" style="font-size:12px;color:var(--dgut-on-surface-variant);margin-top:10px;line-height:1.7;"></div>
            </div>
            <div class="dgut-row dgut-row--end">
                <button id="dgut-img-run" class="dgut-btn">${icons.list} 预览效果</button>
                <button id="dgut-img-dl" class="dgut-btn dgut-btn-primary">${icons.export} 处理并下载</button>
            </div>`;
        const infoEl = ac.querySelector('#dgut-img-info');
        const statusEl = ac.querySelector('#dgut-img-status');
        const canvasEl = ac.querySelector('#dgut-img-preview');
        const fileEl = ac.querySelector('#dgut-img-file');
        const sizeModeEl = ac.querySelector('#dgut-img-sizemode');
        const ratioEl = ac.querySelector('#dgut-img-ratio');
        const wEl = ac.querySelector('#dgut-img-w');
        const hEl = ac.querySelector('#dgut-img-h');
        const targetEl = ac.querySelector('#dgut-img-target');
        const qualityEl = ac.querySelector('#dgut-img-quality');
        const qualityNoteEl = ac.querySelector('#dgut-img-quality-note');
        const setStatus = (msg, isErr) => { statusEl.innerHTML = `<span style="color:${isErr ? 'var(--dgut-error)' : 'var(--dgut-on-surface-variant)'};">${escapeHtml(msg)}</span>`; };
        const refreshVisibility = () => {
            const m = sizeModeEl.value;
            ac.querySelectorAll('[data-when]').forEach(el => { el.style.display = (el.dataset.when === m) ? '' : 'none'; });
        };
        const refreshOutputState = () => {
            const useTarget = Number(targetEl.value) > 0;
            qualityEl.disabled = useTarget;
            qualityNoteEl.textContent = useTarget ? '（已设定目标大小，质量自动调节）' : '';
        };
        const syncFromWidth = () => {
            const preset = IMG_RATIO_PRESETS.find(p => p.id === ratioEl.value);
            if (!preset || preset.id === 'orig' || preset.id === 'custom') return;
            const W = Number(wEl.value) || 0;
            if (W > 0) hEl.value = Math.max(1, Math.round(W * preset.h / preset.w));
        };
        const syncFromHeight = () => {
            const preset = IMG_RATIO_PRESETS.find(p => p.id === ratioEl.value);
            if (!preset || preset.id === 'orig' || preset.id === 'custom') return;
            const H = Number(hEl.value) || 0;
            if (H > 0) wEl.value = Math.max(1, Math.round(H * preset.w / preset.h));
        };
        const persistCfg = () => { try { imgSaveCfg(imgReadCfg(ac)); } catch (e) {} };
        sizeModeEl.addEventListener('change', () => { refreshVisibility(); persistCfg(); });
        wEl.addEventListener('input', () => { syncFromWidth(); persistCfg(); });
        hEl.addEventListener('input', () => { syncFromHeight(); persistCfg(); });
        ratioEl.addEventListener('change', () => { if (wEl.value) syncFromWidth(); else if (hEl.value) syncFromHeight(); persistCfg(); });
        targetEl.addEventListener('input', () => { refreshOutputState(); persistCfg(); });
        ac.querySelectorAll('#dgut-img-smooth, #dgut-img-fit, #dgut-img-format, #dgut-img-inflate-mode, #dgut-img-allow-resize, #dgut-img-sharpen, #dgut-img-bw, #dgut-img-eq, #dgut-img-quality')
            .forEach(el => el.addEventListener('change', persistCfg));
        refreshVisibility(); refreshOutputState();
        ac.querySelector('#dgut-img-reset').onclick = () => {
            gImgState = null; fileEl.value = '';
            infoEl.textContent = '尚未选择图片。';
            canvasEl.width = 0; canvasEl.height = 0;
            setStatus('');
        };
        fileEl.addEventListener('change', async () => {
            const file = fileEl.files && fileEl.files[0];
            if (!file) return;
            setStatus('读取中…');
            try {
                const { img } = await imgFileToImage(file);
                gImgState = { img, file, name: file.name, size: file.size, type: file.type };
                infoEl.innerHTML = `原始尺寸：<b>${img.naturalWidth} × ${img.naturalHeight}</b> px · 文件大小：<b>${imgFmtSize(file.size)}</b> · 类型：<b>${escapeHtml(file.type || '未知')}</b>`;
                canvasEl.width = img.naturalWidth; canvasEl.height = img.naturalHeight;
                const c = canvasEl.getContext('2d');
                c.clearRect(0, 0, canvasEl.width, canvasEl.height);
                c.drawImage(img, 0, 0);
                if (!wEl.value) wEl.value = img.naturalWidth;
                if (!hEl.value) hEl.value = img.naturalHeight;
                setStatus('已载入，可调整参数后点击「预览效果」或「处理并下载」。');
            } catch (e) { gImgState = null; setStatus('读取失败：' + e.message, true); }
        });
        const doPreview = async () => {
            try {
                setStatus('处理中…');
                const { canvas, blob, inflated, achieved, targetBytes, capped } = await imgRunPipeline(ac);
                canvasEl.width = canvas.width; canvasEl.height = canvas.height;
                const c = canvasEl.getContext('2d');
                c.clearRect(0, 0, canvas.width, canvas.height);
                c.drawImage(canvas, 0, 0);
                let msg;
                if (targetBytes > 0 && !achieved) {
                    msg = `已用最低质量，无法压缩到目标大小 ${imgFmtSize(targetBytes)} · 实际 ${imgFmtSize(blob.size)}。如需更小请勾选"允许降低分辨率"。`;
                } else if (inflated) {
                    msg = `输出尺寸 ${canvas.width} × ${canvas.height} px · ${imgFmtSize(blob.size)}（已填充至目标大小）`;
                } else {
                    msg = `输出尺寸 ${canvas.width} × ${canvas.height} px · ${imgFmtSize(blob.size)}`;
                }
                if (capped) msg += '（已自动调整质量，尽量不超过原图大小）';
                setStatus(msg);
                return { canvas, blob };
            } catch (e) { setStatus('处理失败：' + e.message, true); return null; }
        };
        ac.querySelector('#dgut-img-run').onclick = doPreview;
        ac.querySelector('#dgut-img-dl').onclick = async () => {
            const r = await doPreview();
            if (!r) return;
            try {
                const base = (gImgState?.name || 'image').replace(/\.[^.]+$/, '');
                const ext = imgExtFromMime(r.blob.type);
                const fname = `${base}_处理_${dateKey()}.${ext}`;
                imgDownloadBlob(r.blob, fname);
                setStatus(`已下载 ${fname} · ${imgFmtSize(r.blob.size)}`);
            } catch (e) { setStatus('下载失败：' + e.message, true); }
        };
    }

    /* ============================================================
     * 视图路由
     * ============================================================ */
    let gActionName = null;
    const ACTION_TITLES = {
        schedule: '近七天日程',
        course: '优学院刷课助手',
        peer: '作业互评记录',
        read: '求是读书',
        doc: '文档工具（MD→Word/PDF + 电子签名）',
        wordpdf: 'Word 转 PDF',
        imagetool: '图片工具（压缩/增大/处理）',
        appearance: '外观设置',
        detail: '详情'
    };

    function actionHeader(title, hint) {
        return `<div style="margin-bottom:14px;">
            <div style="font-size:15px;font-weight:700;color:var(--dgut-on-surface);line-height:1.3;">${title}</div>
            ${hint ? `<div style="font-size:11px;color:var(--dgut-on-surface-variant);margin-top:2px;">${hint}</div>` : ''}
        </div>`;
    }
    function openActionView(name) {
        if (name) GM_setValue(VIEW_MODE_KEY, name);
        const raw = name || GM_getValue(VIEW_MODE_KEY, 'schedule');
        /* 旧版本默认视图是「课程签到」（sign）；签到功能已移除，老用户自动切到「日程」 */
        const mode = raw === 'sign' ? 'schedule' : raw;
        if (raw === 'sign') GM_setValue(VIEW_MODE_KEY, mode);
        gActionName = mode;
        if (!document.getElementById('dgut-main-panel')) {
            GM_setValue(PANEL_OPEN_KEY, true);
            createPanel();
            return;
        }
        const ac = document.getElementById('dgut-action-container');
        if (!ac) return;
        ac.style.display = 'block';
        document.querySelectorAll('.dgut-nav').forEach(t => t.classList.remove('dgut-tab-active'));
        document.querySelector(`.dgut-nav[data-action="${mode}"]`)?.classList.add('dgut-tab-active');
        renderActionView(mode);
    }
    function renderActionView(name) {
        const ac = document.getElementById('dgut-action-container');
        if (!ac) return;
        /* 离开日程页就停掉它的「过期自动清理」定时器（它只在打开日程时运行） */
        if (name !== 'schedule' && typeof schedStopTicker === 'function') { try { schedStopTicker(); } catch (e) {} }
        /* 离开读书页就停掉它的「服务端时长自动刷新」定时器 */
        if (name !== 'read' && typeof rdStopViewTimer === 'function') { try { rdStopViewTimer(); } catch (e) {} }
        switch (name) {
            case 'schedule': renderScheduleView(ac); break;
            case 'course': renderCourseView(ac); break;
            case 'peer': renderPeerView(ac); break;
            case 'read': renderReadView(ac); break;
            case 'doc': renderDocToolView(ac); break;
            case 'wordpdf': renderWordPdfView(ac); break;
            case 'imagetool': renderImageToolView(ac); break;
            case 'appearance': renderAppearanceView(ac); break;
            case 'detail': renderDetailView(ac); break;
            default: renderDetailView(ac);
        }
    }

    function renderAppearanceView(ac) {
        const mode = GM_getValue(THEME_MODE_KEY, 'auto');
        const accent = GM_getValue(ACCENT_KEY, 'purple');
        const swatches = Object.entries(ACCENTS).map(([id, a]) => {
            const isActive = accent === id;
            return `<button class="dgut-accent" data-id="${id}" title="${a.name}" style="
                width:36px;height:36px;border-radius:50%;
                border:3px solid ${isActive ? 'var(--dgut-on-surface)' : 'transparent'};
                background:${a.primary};cursor:pointer;box-sizing:border-box;
                transition:border-color .15s;
            "></button>`;
        }).join('');
        const modeBtn = (v, label) => {
            const on = mode === v;
            return `<button class="dgut-mode" data-mode="${v}" style="
                padding:8px 16px;border-radius:999px;
                border:1px solid ${on ? 'var(--dgut-primary)' : 'var(--dgut-outline)'};
                background:${on ? 'var(--dgut-primary-container)' : 'var(--dgut-surface-3)'};
                color:${on ? 'var(--dgut-on-primary-container)' : 'var(--dgut-on-surface-variant)'};
                font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;
                transition:background .15s, color .15s, border-color .15s;
            ">${label}</button>`;
        };
        ac.innerHTML = actionHeader(ACTION_TITLES.appearance, '亮/暗/跟随系统 + 主体色') + `
            <div class="dgut-card">
                <div class="dgut-section-title">主题模式</div>
                <div class="dgut-row">
                    ${modeBtn('light', '亮色')}
                    ${modeBtn('dark', '暗色')}
                    ${modeBtn('auto', '跟随系统')}
                </div>
            </div>
            <div class="dgut-card">
                <div class="dgut-section-title">主体色</div>
                <div class="dgut-row">${swatches}</div>
                <div class="dgut-row" style="margin-top:14px;">
                    <span class="dgut-label">自定义颜色</span>
                    <input type="color" id="dgut-accent-custom" value="${/^#([0-9a-f]{6})$/i.test(accent) ? accent : '#6750A4'}" style="width:46px;height:32px;cursor:pointer;">
                    <button id="dgut-accent-apply" class="dgut-btn dgut-btn-primary">应用自定义色</button>
                    <span style="font-size:11px;color:var(--dgut-on-surface-variant);">当前：${escapeHtml(accentOf(accent).name)}</span>
                </div>
            </div>`;
        ac.querySelectorAll('.dgut-mode').forEach(b => b.onclick = () => { GM_setValue(THEME_MODE_KEY, b.dataset.mode); applyTheme(); renderAppearanceView(ac); showStatus('主题模式已更新'); });
        ac.querySelectorAll('.dgut-accent').forEach(b => b.onclick = () => { GM_setValue(ACCENT_KEY, b.dataset.id); applyTheme(); renderAppearanceView(ac); showStatus('主体色已更新'); });
        ac.querySelector('#dgut-accent-apply').onclick = () => {
            const v = ac.querySelector('#dgut-accent-custom').value;
            if (/^#[0-9a-f]{6}$/i.test(v)) { GM_setValue(ACCENT_KEY, v); applyTheme(); renderAppearanceView(ac); showStatus('已应用自定义主体色'); }
        };
    }

    /* ============================================================
     * GitHub 项目信息（v5.6.0 新增：Star / Fork / 作者与贡献者头像）
     * ------------------------------------------------------------
     * · 数据来源 api.github.com（需 @connect，见头部元数据）
     * · 30 分钟缓存 + 失败回退过期缓存；匿名 API 限 60 次/小时/IP
     * · 403 限流 / 404 仓库不存在 / 网络失败均有提示与重试按钮
     * · 详情页「作者与许可」栏调用 renderGitHubInfo() 注入卡片
     * ============================================================ */
    const GH_REPO = 'BrocadeHutHost/DGUT-ULearningTakeQuizzesAssistant';
    const GH_CACHE_KEY = 'dgut_github_info_cache';
    const GH_CACHE_TTL = 30 * 60 * 1000;

    const GH_ICONS = {
        star: `<svg viewBox="0 0 24 24"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`,
        fork: `<svg viewBox="0 0 24 24"><path d="M14 4l2.29 2.29-2.88 2.88 1.42 1.42 2.88-2.88L20 10V4h-6zm-4 0H4v6l2.29-2.29 4.71 4.7V20h2v-8.41l-5.29-5.3z"/></svg>`,
        eye: `<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`,
        person: `<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
        people: `<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`,
        external: `<svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>`,
        refresh: icons.refresh
    };

    GM_addStyle(`
        @keyframes dgutGhSpin { to { transform: rotate(360deg); } }
        .dgut-gh-loading { font-size: 12px; color: var(--dgut-on-surface-variant); display: inline-flex; align-items: center; gap: 8px; padding: 8px 2px; }
        .dgut-gh-loading svg { width: 14px; height: 14px; fill: currentColor; animation: dgutGhSpin 1s linear infinite; }
        .dgut-gh-error { border: 1px solid var(--dgut-outline-variant); border-radius: 10px; padding: 12px 14px; background: var(--dgut-error-container); color: var(--dgut-on-error-container); font-size: 12px; line-height: 1.7; }
        .dgut-gh-error .dgut-btn { background: var(--dgut-error); color: #fff; }
        .dgut-gh-error .dgut-btn:hover { background: var(--dgut-error); filter: brightness(1.1); color: #fff; }
        .dgut-gh-card { border: 1px solid var(--dgut-outline-variant); border-radius: 12px; padding: 14px; background: var(--dgut-surface-2); margin-bottom: 12px; }
        .dgut-gh-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .dgut-gh-repo-link { font-size: 14px; font-weight: 700; color: var(--dgut-primary); text-decoration: none; display: inline-flex; align-items: center; gap: 6px; word-break: break-all; }
        .dgut-gh-repo-link:hover { text-decoration: underline; }
        .dgut-gh-repo-link svg { width: 15px; height: 15px; fill: currentColor; flex: none; }
        .dgut-gh-stats { display: inline-flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }
        .dgut-gh-stat { display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px; border-radius: 999px; background: var(--dgut-secondary-container); color: var(--dgut-on-secondary-container); font-size: 12px; font-weight: 700; text-decoration: none; font-variant-numeric: tabular-nums; transition: background .15s, color .15s, transform .15s; }
        .dgut-gh-stat:hover { background: var(--dgut-primary-container); color: var(--dgut-on-primary-container); transform: translateY(-1px); }
        .dgut-gh-stat svg { width: 14px; height: 14px; fill: currentColor; flex: none; }
        .dgut-gh-stat--star { background: var(--dgut-warn-container); color: var(--dgut-on-warn-container); }
        .dgut-gh-stat--star:hover { background: var(--dgut-warn-container); color: var(--dgut-on-warn-container); filter: brightness(1.07); }
        .dgut-gh-stat-label { font-weight: 500; opacity: .7; }
        .dgut-gh-desc { font-size: 12px; color: var(--dgut-on-surface-variant); line-height: 1.7; margin: 8px 0 2px; }
        .dgut-gh-people { margin-top: 14px; }
        .dgut-gh-people-title { font-size: 12px; font-weight: 700; color: var(--dgut-on-surface); display: flex; align-items: center; gap: 5px; margin-bottom: 8px; }
        .dgut-gh-people-title svg { width: 14px; height: 14px; fill: currentColor; flex: none; }
        .dgut-gh-avatars { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        /* Star History 图表：独占一行、按面板宽度自适应，避免大图撑破卡片 */
        .dgut-gh-starhistory { flex: 1 0 100%; line-height: 1.5; display: block; margin-top: 4px; }
        .dgut-gh-starhistory img { display: block; width: 100%; max-width: 720px; height: auto; border-radius: 8px; }
        .dgut-gh-avatar { display: inline-block; position: relative; text-decoration: none; line-height: 0; }
        .dgut-gh-avatar img { display: block; width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 2px solid var(--dgut-surface-2); box-shadow: 0 1px 4px rgba(0,0,0,.22); background: var(--dgut-surface-3); transition: transform .15s, border-color .15s; }
        .dgut-gh-avatar:hover { z-index: 3; }
        .dgut-gh-avatar:hover img { transform: scale(1.16); border-color: var(--dgut-primary); }
        .dgut-gh-avatar--owner img { width: 44px; height: 44px; border-color: var(--dgut-primary); }
        .dgut-gh-owner-badge { position: absolute; left: 50%; transform: translateX(-50%); bottom: -7px; font-size: 9px; font-weight: 700; line-height: 1; padding: 2px 6px; border-radius: 999px; background: var(--dgut-primary); color: var(--dgut-on-primary); white-space: nowrap; box-shadow: 0 0 0 2px var(--dgut-surface-2); }
        .dgut-gh-avatar-fb { display: inline-flex; width: 34px; height: 34px; border-radius: 50%; background: var(--dgut-secondary-container); color: var(--dgut-on-secondary-container); align-items: center; justify-content: center; font-size: 14px; font-weight: 700; line-height: 1; }
        .dgut-gh-home-btn { display: inline-flex; align-items: center; gap: 5px; padding: 7px 15px; border-radius: 999px; background: var(--dgut-primary); color: var(--dgut-on-primary); font-size: 12px; font-weight: 700; text-decoration: none; transition: background .15s, transform .15s; }
        .dgut-gh-home-btn:hover { background: var(--dgut-primary-hover); color: var(--dgut-on-primary); transform: translateY(-1px); }
        .dgut-gh-home-btn svg { width: 14px; height: 14px; fill: currentColor; flex: none; }
        .dgut-gh-more { font-size: 12px; color: var(--dgut-primary); text-decoration: none; margin-left: 4px; }
        .dgut-gh-more:hover { text-decoration: underline; }
        .dgut-gh-empty { font-size: 12px; color: var(--dgut-on-surface-variant); }
        .dgut-gh-meta { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; font-size: 11px; color: var(--dgut-on-surface-variant); margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--dgut-outline-variant); }
        .dgut-gh-refresh-btn { border: none; background: none; color: var(--dgut-primary); font-size: 11px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; padding: 3px 8px; border-radius: 6px; font-family: inherit; }
        .dgut-gh-refresh-btn:hover { background: var(--dgut-primary-container); color: var(--dgut-on-primary-container); }
        .dgut-gh-refresh-btn svg { width: 12px; height: 12px; fill: currentColor; }
        .dgut-gh-warnline { font-size: 11px; color: var(--dgut-on-warn-container); background: var(--dgut-warn-container); border-radius: 8px; padding: 6px 10px; margin-top: 10px; line-height: 1.6; }
    `);

    function ghAvatarUrl(u, size) {
        if (!u) return '';
        return u + (u.indexOf('?') >= 0 ? '&' : '?') + 's=' + (size || 64);
    }
    function ghFmtNum(n) {
        n = parseInt(n, 10);
        if (isNaN(n)) return '0';
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return String(n);
    }
    function ghReadCache(staleOk) {
        try {
            const c = GM_getValue(GH_CACHE_KEY, null);
            if (c && c.ts && (staleOk || Date.now() - c.ts < GH_CACHE_TTL)) return c;
        } catch (e) {}
        return null;
    }
    function ghGetJSON(url) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('GM_xmlhttpRequest 不可用'));
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: 15000,
                headers: { 'Accept': 'application/vnd.github+json' },
                onload: (res) => {
                    if (res.status === 200) {
                        try { resolve(JSON.parse(res.responseText)); }
                        catch (e) { reject(new Error('GitHub 数据解析失败')); }
                    }
                    else if (res.status === 403) reject(new Error('GitHub API 速率受限（未认证 60 次/小时/IP），请稍后重试'));
                    else if (res.status === 404) reject(new Error('GitHub 仓库不存在：' + GH_REPO));
                    else reject(new Error('GitHub 请求失败（HTTP ' + res.status + '）'));
                },
                onerror: () => reject(new Error('GitHub 请求失败（网络错误）')),
                ontimeout: () => reject(new Error('GitHub 请求失败（超时）'))
            });
        });
    }
    async function ghFetchAll(force) {
        if (!force) {
            const fresh = ghReadCache(false);
            if (fresh) return { data: fresh, cache: 'fresh' };
        }
        try {
            const [repo, contribs] = await Promise.all([
                ghGetJSON('https://api.github.com/repos/' + GH_REPO),
                ghGetJSON('https://api.github.com/repos/' + GH_REPO + '/contributors?per_page=24').catch(e => {
                    log('[GitHub] 贡献者列表获取失败：' + e.message);
                    return [];
                })
            ]);
            const ownerLogin = (repo.owner && repo.owner.login) || GH_REPO.split('/')[0];
            const data = {
                ts: Date.now(),
                repo: {
                    full_name: repo.full_name || GH_REPO,
                    html_url: repo.html_url || ('https://github.com/' + GH_REPO),
                    stars: repo.stargazers_count | 0,
                    forks: repo.forks_count | 0,
                    watchers: repo.subscribers_count | 0,
                    description: repo.description || '',
                    pushed_at: repo.pushed_at || '',
                    license: (repo.license && repo.license.name) || '',
                    owner: {
                        login: ownerLogin,
                        avatar_url: (repo.owner && repo.owner.avatar_url) || '',
                        html_url: (repo.owner && repo.owner.html_url) || ('https://github.com/' + ownerLogin)
                    }
                },
                contributors: (Array.isArray(contribs) ? contribs : [])
                    .filter(c => c && c.login && c.login !== ownerLogin)
                    .map(c => ({
                        login: c.login,
                        avatar_url: c.avatar_url || '',
                        html_url: c.html_url || ('https://github.com/' + c.login),
                        contributions: c.contributions | 0
                    }))
            };
            try { GM_setValue(GH_CACHE_KEY, data); } catch (e) {}
            log('[GitHub] 数据已获取并缓存：' + data.repo.full_name);
            return { data: data, cache: 'live' };
        } catch (e) {
            const stale = ghReadCache(true);
            if (stale) {
                log('[GitHub] 获取失败，使用过期缓存：' + e.message);
                return { data: stale, cache: 'stale', warn: e.message };
            }
            throw e;
        }
    }
    async function renderGitHubInfo(container, force) {
        if (!container) return;
        container.innerHTML = '<div class="dgut-gh-loading">' + GH_ICONS.refresh + ' 正在从 GitHub 获取项目数据…</div>';
        let result;
        try { result = await ghFetchAll(force); }
        catch (e) {
            container.innerHTML = `
                <div class="dgut-gh-error">
                    <div>${escapeHtml(e.message)}</div>
                    <button class="dgut-btn dgut-btn-primary" id="dgut-gh-retry" style="margin-top:10px">${GH_ICONS.refresh} 重试</button>
                </div>`;
            const btn = container.querySelector('#dgut-gh-retry');
            if (btn) btn.addEventListener('click', () => renderGitHubInfo(container, true));
            return;
        }
        const d = result.data, r = d.repo;
        const contribHtml = d.contributors.length
            ? d.contributors.map(c => `
                <a class="dgut-gh-avatar" href="${escapeHtml(c.html_url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(c.login)} · ${c.contributions} 次提交">
                    <img src="${escapeHtml(ghAvatarUrl(c.avatar_url, 72))}" alt="${escapeHtml(c.login)}" loading="lazy" referrerpolicy="no-referrer">
                </a>`).join('')
            : '<span class="dgut-gh-empty">暂无其他贡献者数据</span>';
        const cacheNote = result.cache === 'live' ? '实时获取' : '缓存于 ' + new Date(d.ts).toLocaleTimeString();
        container.innerHTML = `
            <div class="dgut-gh-card">
                <div class="dgut-gh-head">
                    <a class="dgut-gh-repo-link" href="${escapeHtml(r.html_url)}" target="_blank" rel="noopener noreferrer" title="打开项目主页">${GH_ICONS.external}<span>${escapeHtml(r.full_name)}</span></a>
                    <span class="dgut-gh-stats">
                        <a class="dgut-gh-stat dgut-gh-stat--star" href="${escapeHtml(r.html_url)}/stargazers" target="_blank" rel="noopener noreferrer" title="去 GitHub 点个 Star">${GH_ICONS.star}<span>${ghFmtNum(r.stars)}</span><span class="dgut-gh-stat-label">Stars</span></a>
                        <a class="dgut-gh-stat" href="${escapeHtml(r.html_url)}/forks" target="_blank" rel="noopener noreferrer" title="Fork 数">${GH_ICONS.fork}<span>${ghFmtNum(r.forks)}</span><span class="dgut-gh-stat-label">Forks</span></a>
                        <a class="dgut-gh-stat" href="${escapeHtml(r.html_url)}/watchers" target="_blank" rel="noopener noreferrer" title="Watch 数">${GH_ICONS.eye}<span>${ghFmtNum(r.watchers)}</span><span class="dgut-gh-stat-label">Watch</span></a>
                    </span>
                </div>
                ${r.description ? '<div class="dgut-gh-desc">' + escapeHtml(r.description) + '</div>' : ''}
                <div class="dgut-gh-people">
                    <div class="dgut-gh-people-title">${GH_ICONS.person} 作者</div>
                    <div class="dgut-gh-avatars">
                        <a class="dgut-gh-starhistory" href="https://www.star-history.com/?repos=brocadehuthost%2Fdgut-ulearningtakequizzesassistant&type=date&legend=top-left" target="_blank" rel="noopener noreferrer" title="查看 Star History">
                            <picture>
                                <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=brocadehuthost/dgut-ulearningtakequizzesassistant&type=date&theme=dark&legend=top-left" />
                                <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=brocadehuthost/dgut-ulearningtakequizzesassistant&type=date&legend=top-left" />
                                <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=brocadehuthost/dgut-ulearningtakequizzesassistant&type=date&legend=top-left" loading="lazy" referrerpolicy="no-referrer" />
                            </picture>
                        </a>
                        <a class="dgut-gh-avatar dgut-gh-avatar--owner" href="${escapeHtml(r.owner.html_url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.owner.login)} · 项目作者">
                            <img src="${escapeHtml(ghAvatarUrl(r.owner.avatar_url, 96))}" alt="${escapeHtml(r.owner.login)}" referrerpolicy="no-referrer">
                            <span class="dgut-gh-owner-badge">作者</span>
                        </a>
                        <a class="dgut-gh-home-btn" href="${escapeHtml(r.html_url)}" target="_blank" rel="noopener noreferrer" title="打开项目主页">${GH_ICONS.external} 项目主页</a>
                    </div>
                </div>
                <div class="dgut-gh-people">
                    <div class="dgut-gh-people-title">${GH_ICONS.people} 贡献者（${d.contributors.length} 人）</div>
                    <div class="dgut-gh-avatars">
                        ${contribHtml}
                        <a class="dgut-gh-more" href="${escapeHtml(r.html_url)}/graphs/contributors" target="_blank" rel="noopener noreferrer">查看全部 →</a>
                    </div>
                </div>
                <div class="dgut-gh-meta">
                    ${r.pushed_at ? '<span>最近推送：' + new Date(r.pushed_at).toLocaleDateString() + '</span>' : ''}
                    ${r.license ? '<span>仓库许可：' + escapeHtml(r.license) + '</span>' : ''}
                    <span>${cacheNote}</span>
                    <button class="dgut-gh-refresh-btn" id="dgut-gh-refresh" title="清除缓存并重新获取">${GH_ICONS.refresh} 刷新数据</button>
                </div>
                ${result.warn ? '<div class="dgut-gh-warnline">' + escapeHtml(result.warn) + '（当前展示过期缓存数据）</div>' : ''}
            </div>`;
        // 头像加载失败 → 首字母圆形占位（部分站点 CSP 拦截外链图片时仍可辨认）
        container.querySelectorAll('.dgut-gh-avatar img').forEach(img => {
            img.addEventListener('error', function () {
                const wrap = this.closest('.dgut-gh-avatar');
                if (!wrap) return;
                const name = (wrap.getAttribute('title') || '?').split(' ')[0] || '?';
                this.outerHTML = '<span class="dgut-gh-avatar-fb">' + escapeHtml(name.charAt(0).toUpperCase()) + '</span>';
            }, { once: true });
        });
        const rf = container.querySelector('#dgut-gh-refresh');
        if (rf) rf.addEventListener('click', () => renderGitHubInfo(container, true));
    }
    /* ============================================================
     * 详情页
     * ============================================================ */
    /* 必须与 00-userscript-header.js 的 @version 保持一致；
       之前它硬编码成 v5.7.1 一路没改，导致详情页显示的版本号是错的，
       排查问题时会把所有人误导。npm run test:logic 有断言强制两者一致。 */
    const ABOUT_VERSION = 'v5.12.2';
    const GITHUB_URL = 'https://github.com/BrocadeHutHost/DGUT-ULearningTakeQuizzesAssistant';

    /* ------------------------------------------------------------------
     * 更新检查（**可选、默认关闭**）+「一键更新」（半自动）
     *
     * 不使用油猴的 @updateURL/@downloadURL（那会让油猴在后台静默替换脚本，用户无法选择）；
     * 改为这里提供一个开关，默认关闭。开启后只「拉取远端 @version 做比较并提示」，
     * 发现新版本时给一个「立即更新」按钮：点了才打开油猴安装页，
     * **由用户在油猴弹窗里按下确认**后覆盖安装 —— 替换动作始终由用户决定。
     *
     * 注意：安装链接必须以 `.user.js` 结尾：油猴只把「.user.js 结尾」的链接识别成可安装
     *   脚本（官方 FAQ Q102），指向 `理工小助手.js` 只会显示源码、不弹安装页。
     *   所以仓库根目录同时发布了内容完全相同的 `理工小助手.user.js`，
     *   由 tools/prepare-publish.mjs 在发布时生成，并强制校验两者字节一致。
     * ------------------------------------------------------------------ */
    /* 多源：raw.githubusercontent.com 在国内常被 DNS 污染/拦截（实测解析到非公网 IP），
       所以再挂一个 jsDelivr 镜像源；两个都失败才算检查失败。
       两个源都指向 .user.js —— 查到版本的那条链接，就是点「立即更新」要打开的安装页。 */
    const UPDATE_SOURCES = [
        {
            name: 'raw.githubusercontent.com',
            url: 'https://raw.githubusercontent.com/BrocadeHutHost/DGUT-ULearningTakeQuizzesAssistant/main/%E7%90%86%E5%B7%A5%E5%B0%8F%E5%8A%A9%E6%89%8B.user.js',
        },
        {
            name: 'cdn.jsdelivr.net',
            url: 'https://cdn.jsdelivr.net/gh/BrocadeHutHost/DGUT-ULearningTakeQuizzesAssistant@main/%E7%90%86%E5%B7%A5%E5%B0%8F%E5%8A%A9%E6%89%8B.user.js',
        },
    ];
    /** 检查失败时也要能手动更新：默认用 jsDelivr（raw 在国内常被 DNS 污染） */
    const DEFAULT_INSTALL_URL = UPDATE_SOURCES[UPDATE_SOURCES.length - 1].url;

    /** 打开油猴安装页。必须在用户点击的调用栈里同步执行，否则会被弹窗拦截。
        （用 <a target="_blank"> 而不是 location.href：不要毁掉用户当前页面） */
    function openInstallPage(url) {
        try {
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            document.body.appendChild(a);
            a.click();
            try { a.remove(); } catch (e) {}
            return true;
        } catch (e) {
            try { window.open(url, '_blank', 'noopener'); return true; } catch (e2) { return false; }
        }
    }

    function updateCheckOn() { return GM_getValue(AUTO_UPDATE_KEY, false) === true; }
    function cmpVer(a, b) {
        const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
        const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const d = (pa[i] || 0) - (pb[i] || 0);
            if (d) return d > 0 ? 1 : -1;
        }
        return 0;
    }
    function fetchText(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: 15000,
                onload: (r) => (r.status === 200 ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status))),
                onerror: () => reject(new Error('网络错误')),
                ontimeout: () => reject(new Error('请求超时')),
            });
        });
    }
    /** 依次尝试各镜像源，返回 { version, from, installUrl }；全部失败才抛错 */
    async function fetchRemoteVersion() {
        if (typeof GM_xmlhttpRequest !== 'function') throw new Error('GM_xmlhttpRequest 不可用');
        const errs = [];
        for (const src of UPDATE_SOURCES) {
            try {
                const text = await fetchText(src.url);
                const m = /^\/\/\s*@version\s+(\S+)\s*$/m.exec(text);
                if (!m) { errs.push(src.name + ': 响应里没有 @version'); continue; }
                return { version: m[1], from: src.name, installUrl: src.url };
            } catch (e) {
                errs.push(src.name + ': ' + ((e && e.message) || e));
            }
        }
        throw new Error(errs.join('；'));
    }

    function renderDetailView(ac) {
        let activeTab = GM_getValue(DETAIL_TAB_KEY, 'about');
        ac.innerHTML = actionHeader(ACTION_TITLES.detail, '软件简介与错误代码列表') + `
            <div class="dgut-tab-bar">
                <button class="dgut-tab-btn ${activeTab === 'about' ? 'active' : ''}" data-tab="about">软件简介</button>
                <button class="dgut-tab-btn ${activeTab === 'errors' ? 'active' : ''}" data-tab="errors">错误代码列表</button>
            </div>
            <div id="dgut-detail-content"></div>`;
        const contentEl = ac.querySelector('#dgut-detail-content');
        const code = (s) => `<code>${s}</code>`;

        const renderAbout = () => {
            const ifr = detectIframe();
            contentEl.innerHTML = `
                <div class="dgut-card">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <svg viewBox="0 0 24 24" width="40" height="40" style="fill:var(--dgut-primary);flex:none;"><path d="M12 3 1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/></svg>
                        <div>
                            <div style="font-size:16px;font-weight:700;">优学院助手 + 文档工具</div>
                            <div style="font-size:12px;color:var(--dgut-on-surface-variant);">${ABOUT_VERSION}</div>
                        </div>
                    </div>
                </div>
                <div class="dgut-card">
                    <div class="dgut-section-title">运行环境</div>
                    <div style="font-size:12px;line-height:2;">
                        <div>域名：<b>${escapeHtml(location.hostname)}</b></div>
                        <div>顶层窗口：<b>${ifr.isTop ? '是' : '否（iframe）'}</b></div>
                        <div>本帧 video：<b>${ifr.hasVideo ? '有' : '无'}</b> · 课件VM：<b>${ifr.hasVM ? '有' : '无'}</b> · ko：<b>${ifr.hasKo ? '有' : '无'}</b></div>
                        <div>Web Worker：<b>${typeof Worker === 'function' ? '可用（图片处理多线程）' : '不可用'}</b></div>
                    </div>
                </div>
                <div class="dgut-card">
                    <div class="dgut-section-title">作者与许可</div>
                    <div id="dgut-gh-info"></div>
                    <div style="font-size:13px;line-height:2;margin-top:12px;">
                        <div><b>许可证：</b>AGPL-3.0-only · <a class="dgut-link" href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">许可全文</a></div>
                        <div><b>版本：</b>${ABOUT_VERSION}</div>
                    </div>
                    <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(128,128,128,.25);">
                        <label class="dgut-label"><input type="checkbox" id="dgut-auto-update" ${updateCheckOn() ? 'checked' : ''}> 自动检查更新（默认关闭）</label>
                        <button id="dgut-check-update" class="dgut-btn" style="margin-left:8px;">立即检查</button>
                        <button id="dgut-do-update" class="dgut-btn" style="margin-left:8px;display:none;">立即更新</button>
                        <div id="dgut-update-result" style="font-size:12px;color:var(--dgut-on-surface-variant);line-height:1.7;margin-top:6px;">未开启自动检查。本脚本<strong>不会在后台自动替换</strong>自己：点「立即检查」看有没有新版本，发现新版后点「立即更新」打开油猴安装页，确认后覆盖安装。</div>
                        <div style="font-size:11px;color:var(--dgut-on-surface-variant);line-height:1.9;margin-top:4px;">
                            手动更新入口（油猴只识别 <code>.user.js</code> 结尾的链接）：
                            <a class="dgut-link" href="${UPDATE_SOURCES[1].url}" target="_blank" rel="noopener noreferrer">jsDelivr</a>
                            · <a class="dgut-link" href="${UPDATE_SOURCES[0].url}" target="_blank" rel="noopener noreferrer">GitHub raw</a>
                        </div>
                    </div>
                </div>
                <div class="dgut-card">
                    <div class="dgut-section-title">功能一览</div>
                    <div style="font-size:13px;line-height:2;">
                        · <b>近七天日程</b>：只读优学院「活动日历」接口，平铺显示近 7 天事项；勾选后置灰，过期自动清理，无提醒<br>
                        · <b>刷课助手</b>：视频倍速守卫、自动答题、自动翻页、题库收集<br>
                        · <b>作业互评</b>：读取互评接口，汇总与筛选记录<br>
                        · <b>求是读书</b>：课件阅读时长统计与自动翻页<br>
                        · <b>文档工具</b>：Markdown 转 Word / PDF（PDF 直出下载）+ 手绘电子签名<br>
                        · <b>Word 转 PDF</b>：本地解析 .docx 并导出 PDF / .doc<br>
                        · <b>图片工具</b>：缩放、压缩、增大文件、锐化 / 黑白 / 亮度均匀<br>
                        · <b>外观设置</b>：亮/暗/跟随系统主题 + 主体色
                    </div>
                </div>`;
            renderGitHubInfo(contentEl.querySelector('#dgut-gh-info'));

            /* 更新检查：**默认关闭**；只有开关打开时，打开本页才会自动检查一次。
               只做「检查 + 提示」；替换必须由用户点「立即更新」并在油猴安装页里确认。 */
            const upCb = contentEl.querySelector('#dgut-auto-update');
            const upBtn = contentEl.querySelector('#dgut-check-update');
            const upGo = contentEl.querySelector('#dgut-do-update');
            const upRes = () => contentEl.querySelector('#dgut-update-result');
            const IDLE_TEXT = '未开启自动检查。本脚本不会在后台自动替换自己：点「立即检查」看有没有新版本，发现新版后点「立即更新」打开油猴安装页，确认后覆盖安装。';
            const runCheck = async (manual) => {
                if (!manual && !updateCheckOn()) return;
                const el = upRes();
                if (el) el.textContent = '正在检查…';
                try {
                    const r = await fetchRemoteVersion();
                    const remote = r.version;
                    const local = ABOUT_VERSION.replace(/^v/i, '');
                    /* 无论有没有更新，都把「远端 / 本地」两个版本号一起显示。
                       否则用户看到「已是最新」时无法判断：是真的一样，
                       还是远端压根没取到、逻辑走偏了。 */
                    if (cmpVer(remote, local) > 0) {
                        if (el) el.innerHTML = `发现新版本 <b>v${escapeHtml(remote)}</b>（本地 v${escapeHtml(local)}）· <a class="dgut-link" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">查看更新说明</a><br><span style="opacity:.7">来源：${escapeHtml(r.from)}</span>`;
                        /* 记住「是哪条源真的取到了版本」，点更新时就用同一条源，避免换源又要重新碰运气 */
                        if (upGo) { upGo.dataset.installUrl = r.installUrl; upGo.style.display = ''; }
                        showToastCard(`发现新版本 v${remote}`, `本地 v${local}，点「立即更新」一键覆盖安装`, '油猴会弹出安装页，你确认后才会替换', 12000);
                    } else {
                        if (el) el.textContent = `已是最新（远端 v${remote} · 本地 v${local}）· 来源：${r.from}`;
                        if (upGo) upGo.style.display = 'none';
                    }
                } catch (e) {
                    if (el) el.textContent = '检查失败：' + ((e && e.message) || e) + '（仍可用下方手动入口打开安装页）';
                    if (upGo) upGo.style.display = 'none';
                }
            };
            if (upCb) upCb.onchange = () => {
                GM_setValue(AUTO_UPDATE_KEY, upCb.checked === true);
                showStatus(upCb.checked ? '已开启自动检查更新' : '已关闭自动检查更新');
                if (upCb.checked) runCheck(true);
                else { const el = upRes(); if (el) el.textContent = IDLE_TEXT; if (upGo) upGo.style.display = 'none'; }
            };
            if (upBtn) upBtn.onclick = () => runCheck(true);
            if (upGo) upGo.onclick = () => {
                const url = upGo.dataset.installUrl || DEFAULT_INSTALL_URL;
                const opened = openInstallPage(url);
                showStatus(opened
                    ? '已打开安装页：在油猴弹窗里点「安装 / 重新安装」即可覆盖更新'
                    : '打开安装页失败，请用下方手动入口', !opened);
            };
            runCheck(false);
        };

        const renderErrors = () => {
            const sc = window.__dgutSelfCheckResults || [];
            const scRows = sc.length ? sc.map(r => `
                <div class="dgut-err-row">
                    <span class="dgut-err-code" style="color:${r.ok ? 'var(--dgut-success)' : 'var(--dgut-error)'};">${r.ok ? 'OK' : 'E' + r.errDef.code}</span>
                    <span style="flex:1;">${escapeHtml(r.name)}</span>
                    <span style="flex:none;color:var(--dgut-on-surface-variant);">${r.ok ? '通过' : '未就绪'}</span>
                </div>`).join('') : `<div style="font-size:12px;color:var(--dgut-on-surface-variant);padding:6px 0;">自检尚未运行，请刷新页面。</div>`;

            const tableHtml = ERR_GROUPS.map(group => `
                <div style="margin-bottom:14px;">
                    <div class="dgut-section-title" style="margin-bottom:6px;">${escapeHtml(group.module)} <span style="font-weight:400;color:var(--dgut-on-surface-variant);font-size:11px;">（${String(group.codes[0]).charAt(0)}xxx）</span></div>
                    <div style="background:var(--dgut-surface-2);border:1px solid var(--dgut-outline-variant);border-radius:10px;overflow:hidden;">
                        ${group.codes.map(c => {
                            const it = ERR_BY_CODE[c];
                            if (!it) return '';
                            return `<div class="dgut-err-row">
                                <span class="dgut-err-code">E${it.code}</span>
                                <span style="flex:1;color:var(--dgut-on-surface);">${escapeHtml(it.msg)}</span>
                            </div>`;
                        }).join('')}
                    </div>
                </div>`).join('');

            contentEl.innerHTML = `
                <div class="dgut-hint">
                    <b>编码规则</b>：四位数字 <code>M T N N</code><br>
                    · <b>M（千位）</b> 模块：1=网络/认证（历史签到段） 2=刷课 3=互评 4=读书 5=文档 6=Word转PDF 7=图片 8=通用/框架<br>
                    · <b>T（百位）</b> 类型：0=未知 1=请求 2=处理 3=认证 4=依赖缺失 5=参数 6=用户操作<br>
                    · <b>NN（十/个位）</b> 具体编号
                </div>
                <div class="dgut-card">
                    <div class="dgut-section-title">本次自检（同步阶段）</div>
                    <div style="background:var(--dgut-surface-2);border:1px solid var(--dgut-outline-variant);border-radius:10px;overflow:hidden;">${scRows}</div>
                    <div style="font-size:11px;color:var(--dgut-on-surface-variant);margin-top:8px;">异步阶段（Token 检查）会输出到控制台。可打开 F12 查看。</div>
                </div>
                <div class="dgut-card">
                    <div class="dgut-section-title">错误代码列表</div>
                    ${tableHtml}
                </div>`;
        };

        const switchTab = (tab) => {
            activeTab = tab;
            GM_setValue(DETAIL_TAB_KEY, tab);
            ac.querySelectorAll('.dgut-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
            if (tab === 'about') renderAbout();
            else renderErrors();
        };
        ac.querySelectorAll('.dgut-tab-btn').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
        switchTab(activeTab);
    }

    /* ============================================================
     * 面板与悬浮按钮
     * ============================================================ */
    /* ---------------- 面板：可调大小 / Ctrl+滚轮缩放 / 布局持久化 ---------------- */
    const PANEL_DEFAULT_W = 780, PANEL_DEFAULT_H = 620;
    const PANEL_MIN_W = 380, PANEL_MIN_H = 280;
    const PANEL_ZOOM_MIN = 0.6, PANEL_ZOOM_MAX = 2.2, PANEL_ZOOM_STEP = 0.1;
    let gPanelZoomTimer = null;

    function panelNum(v, d) { const n = parseFloat(v); return isFinite(n) ? n : d; }
    function panelLayoutOf(raw) {
        const o = (raw && typeof raw === 'object') ? raw : {};
        const zoom = panelNum(o.zoom, 1);
        return {
            left: (typeof o.left === 'number' && isFinite(o.left)) ? o.left : null,
            top: (typeof o.top === 'number' && isFinite(o.top)) ? o.top : null,
            width: panelNum(o.width, PANEL_DEFAULT_W),
            height: panelNum(o.height, PANEL_DEFAULT_H),
            zoom: Math.min(PANEL_ZOOM_MAX, Math.max(PANEL_ZOOM_MIN, zoom))
        };
    }
    function panelLayout() { return panelLayoutOf(GM_getValue(UI_POS_KEY, null)); }
    function panelZoomOf(p) {
        const z = panelNum(p && p.dataset ? p.dataset.zoom : 1, 1);
        return z > 0 ? z : 1;
    }
    function panelStateOf(p) {
        if (!p || !p.style) return panelLayout();
        return {
            left: p.style.left && p.style.left !== 'auto' ? panelNum(p.style.left, null) : null,
            top: p.style.top && p.style.top !== 'auto' ? panelNum(p.style.top, null) : null,
            width: panelNum(p.style.width, PANEL_DEFAULT_W),
            height: panelNum(p.style.height, PANEL_DEFAULT_H),
            zoom: panelZoomOf(p)
        };
    }
    function savePanelState(patch) {
        const p = document.getElementById('dgut-main-panel');
        const base = p ? panelStateOf(p) : panelLayout();
        GM_setValue(UI_POS_KEY, Object.assign({}, base, patch || {}));
    }
    /* 宽高永远不超过浏览器可视区域（缩放后按视觉尺寸换算） */
    function panelClampBox(p) {
        p = p || document.getElementById('dgut-main-panel');
        if (!p) return;
        const z = panelZoomOf(p);
        const vw = Math.max(PANEL_MIN_W, window.innerWidth || PANEL_DEFAULT_W);
        const vh = Math.max(PANEL_MIN_H, window.innerHeight || PANEL_DEFAULT_H);
        const maxW = Math.max(PANEL_MIN_W, Math.floor((vw - 8) / z));
        const maxH = Math.max(PANEL_MIN_H, Math.floor((vh - 8) / z));
        const w = Math.min(maxW, Math.max(PANEL_MIN_W, panelNum(p.style.width, PANEL_DEFAULT_W)));
        const h = Math.min(maxH, Math.max(PANEL_MIN_H, panelNum(p.style.height, PANEL_DEFAULT_H)));
        p.style.width = Math.round(w) + 'px';
        p.style.height = Math.round(h) + 'px';
        if (p.style.left && p.style.left !== 'auto') {
            const l = panelNum(p.style.left, 0);
            p.style.left = Math.round(Math.max(0, Math.min(Math.max(0, vw - w * z), l))) + 'px';
        }
        if (p.style.top && p.style.top !== 'auto') {
            const t = panelNum(p.style.top, 0);
            p.style.top = Math.round(Math.max(0, Math.min(Math.max(0, vh - h * z), t))) + 'px';
        }
    }
    function panelShowZoom(p, z) {
        const badge = p.querySelector('#dgut-panel-zoom-badge');
        if (!badge) return;
        badge.textContent = Math.round(z * 100) + '%';
        badge.style.opacity = '1';
        if (gPanelZoomTimer) clearTimeout(gPanelZoomTimer);
        gPanelZoomTimer = setTimeout(() => { try { badge.style.opacity = '0'; } catch (e) {} }, 1400);
    }
    function panelApplyZoom(z) {
        const p = document.getElementById('dgut-main-panel');
        if (!p) return;
        z = Math.min(PANEL_ZOOM_MAX, Math.max(PANEL_ZOOM_MIN, Math.round(z * 100) / 100));
        p.dataset.zoom = String(z);
        p.style.transformOrigin = '0 0';
        p.style.transform = (z === 1) ? '' : ('scale(' + z + ')');
        panelClampBox(p);
        panelShowZoom(p, z);
        /* 画板等按 rect 计算的元素需要按新尺寸重建 */
        try { const sig = document.getElementById('dgut-sig-canvas'); if (sig && typeof sig.__dgutPadResize === 'function') sig.__dgutPadResize(); } catch (e) {}
    }
    function panelEnableInteractions(panel) {
        const header = panel.querySelector('#dgut-panel-header');
        let drag = null;
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('#dgut-panel-close') || e.target.closest('.dgut-resizer')) return;
            const rect = panel.getBoundingClientRect();
            drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
            panel.style.right = 'auto'; panel.style.bottom = 'auto';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!drag) return;
            const z = panelZoomOf(panel);
            const w = panelNum(panel.style.width, PANEL_DEFAULT_W) * z;
            const h = panelNum(panel.style.height, PANEL_DEFAULT_H) * z;
            const maxX = Math.max(0, window.innerWidth - w);
            const maxY = Math.max(0, window.innerHeight - Math.min(h, 120));
            panel.style.left = Math.round(Math.max(0, Math.min(maxX, e.clientX - drag.dx))) + 'px';
            panel.style.top = Math.round(Math.max(0, Math.min(maxY, e.clientY - drag.dy))) + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (!drag) return;
            drag = null;
            savePanelState(panelStateOf(panel));
        });
        /* 双击标题栏：缩放回到 100% */
        header.addEventListener('dblclick', (e) => {
            if (e.target.closest('#dgut-panel-close') || e.target.closest('.dgut-resizer')) return;
            panelApplyZoom(1);
            savePanelState(panelStateOf(panel));
        });
        /* 八向中的五向拖拽边框（右/下/左/上/右下角） */
        panel.querySelectorAll('.dgut-resizer').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault(); e.stopPropagation();
                const dir = handle.dataset.dir || 'se';
                const z = panelZoomOf(panel);
                const rect = panel.getBoundingClientRect();
                panel.style.right = 'auto'; panel.style.bottom = 'auto';
                panel.style.left = Math.round(rect.left) + 'px';
                panel.style.top = Math.round(rect.top) + 'px';
                const st = {
                    dir: dir, x: e.clientX, y: e.clientY,
                    w: panelNum(panel.style.width, PANEL_DEFAULT_W),
                    h: panelNum(panel.style.height, PANEL_DEFAULT_H),
                    l: rect.left, t: rect.top
                };
                const onMove = (ev) => {
                    const dx = (ev.clientX - st.x) / z, dy = (ev.clientY - st.y) / z;
                    let w = st.w, h = st.h, l = st.l, t = st.t;
                    if (st.dir.indexOf('e') !== -1) w = st.w + dx;
                    if (st.dir.indexOf('s') !== -1) h = st.h + dy;
                    if (st.dir.indexOf('w') !== -1) { w = st.w - dx; l = st.l + dx; }
                    if (st.dir.indexOf('n') !== -1) { h = st.h - dy; t = st.t + dy; }
                    if (w < PANEL_MIN_W) { if (st.dir.indexOf('w') !== -1) l -= (PANEL_MIN_W - w); w = PANEL_MIN_W; }
                    if (h < PANEL_MIN_H) { if (st.dir.indexOf('n') !== -1) t -= (PANEL_MIN_H - h); h = PANEL_MIN_H; }
                    if (l < 0) { if (st.dir.indexOf('w') !== -1) w = Math.max(PANEL_MIN_W, w + l); l = 0; }
                    if (t < 0) { if (st.dir.indexOf('n') !== -1) h = Math.max(PANEL_MIN_H, h + t); t = 0; }
                    const maxW = Math.max(PANEL_MIN_W, (window.innerWidth - 8) / z - l);
                    const maxH = Math.max(PANEL_MIN_H, (window.innerHeight - 8) / z - t);
                    w = Math.min(maxW, Math.max(PANEL_MIN_W, w));
                    h = Math.min(maxH, Math.max(PANEL_MIN_H, h));
                    panel.style.width = Math.round(w) + 'px';
                    panel.style.height = Math.round(h) + 'px';
                    panel.style.left = Math.round(l) + 'px';
                    panel.style.top = Math.round(t) + 'px';
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    savePanelState(panelStateOf(panel));
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        });
        /* Ctrl + 滚轮：整体缩放文字与元素（等价于面板级 zoom） */
        panel.addEventListener('wheel', (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            e.stopPropagation();
            const step = (e.deltaY < 0 ? 1 : -1) * PANEL_ZOOM_STEP;
            panelApplyZoom(panelZoomOf(panel) + step);
            savePanelState(panelStateOf(panel));
        }, { passive: false });
    }
    function createPanel() {
        if (document.getElementById('dgut-main-panel')) return;
        const layout = panelLayout();
        const panel = document.createElement('div');
        panel.id = 'dgut-main-panel';
        panel.style.width = Math.round(layout.width) + 'px';
        panel.style.height = Math.round(layout.height) + 'px';
        panel.dataset.zoom = String(layout.zoom);
        panel.style.transformOrigin = '0 0';
        if (layout.zoom !== 1) panel.style.transform = 'scale(' + layout.zoom + ')';
        if (layout.left !== null) {
            panel.style.left = Math.max(0, layout.left) + 'px';
            panel.style.top = Math.max(0, layout.top === null ? 16 : layout.top) + 'px';
        } else { panel.style.right = '16px'; panel.style.bottom = '16px'; }
        panel.innerHTML = `
            <div id="dgut-panel-header">
                <svg viewBox="0 0 24 24" width="22" height="22" style="fill:currentColor;flex:none;"><path d="M12 3 1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/></svg>
                <div style="flex:1;min-width:0;">
                    <div class="panel-title">优学院助手 + 文档工具</div>
                </div>
                <button id="dgut-panel-close" title="收起为悬浮面板">×</button>
            </div>
            <div style="display:flex;flex:1;min-height:0;">
                <div id="dgut-sidebar">
                    <div class="dgut-nav-label">优学院</div>
                    <button class="dgut-nav" data-action="schedule">${icons.calendar} 近七天日程</button>
                    <button class="dgut-nav" data-action="course">${icons.course} 刷课助手</button>
                    <button class="dgut-nav" data-action="peer">${icons.peer} 作业互评</button>
                    <button class="dgut-nav" data-action="read">${icons.read} 求是读书</button>
                    <div class="dgut-nav-label">工具</div>
                    <button class="dgut-nav" data-action="doc">${icons.doc} md转word/PDF</button>
                    <button class="dgut-nav" data-action="wordpdf">${icons.doc} Word 转 PDF</button>
                    <button class="dgut-nav" data-action="imagetool">${icons.upload} 照片处理</button>
                    <button class="dgut-nav" data-action="appearance">${icons.theme} 外观设置</button>
                    <button class="dgut-nav" data-action="detail">${icons.info} 详情</button>
                    <div style="flex:1;"></div>
                    <div id="dgut-panel-footer-version">${ABOUT_VERSION}</div>
                </div>
                <div style="flex:1;min-width:0;display:flex;flex-direction:column;background:var(--dgut-surface);">
                    <div id="dgut-panel-body">
                        <div id="dgut-action-container"></div>
                    </div>
                    <div id="dgut-status-bar"></div>
                </div>
            </div>`;
        document.body.appendChild(panel);
        /* 改变大小用的拖拽边框 + 缩放比例提示 */
        ['n', 's', 'w', 'e', 'se'].forEach(dir => {
            const grip = document.createElement('div');
            grip.className = 'dgut-resizer';
            grip.id = 'dgut-panel-resizer-' + dir;
            grip.dataset.dir = dir;
            grip.title = '拖拽调整面板大小';
            panel.appendChild(grip);
        });
        const zoomBadge = document.createElement('div');
        zoomBadge.id = 'dgut-panel-zoom-badge';
        panel.appendChild(zoomBadge);
        panelEnableInteractions(panel);
        panelClampBox(panel);
        panel.querySelector('#dgut-panel-close').onclick = () => togglePanel();
        panel.querySelectorAll('.dgut-nav[data-action]').forEach(t => t.onclick = () => {
            GM_setValue(VIEW_MODE_KEY, t.dataset.action);
            gActionName = t.dataset.action;
            panel.querySelectorAll('.dgut-nav').forEach(x => x.classList.remove('dgut-tab-active'));
            t.classList.add('dgut-tab-active');
            renderActionView(t.dataset.action);
        });
        const rawMode = GM_getValue(VIEW_MODE_KEY, 'schedule');
        /* 旧版本默认「课程签到」（sign）；签到已移除，老用户自动切到「日程」 */
        const mode = rawMode === 'sign' ? 'schedule' : rawMode;
        if (rawMode === 'sign') GM_setValue(VIEW_MODE_KEY, mode);
        gActionName = mode;
        panel.querySelectorAll('.dgut-nav').forEach(x => x.classList.toggle('dgut-tab-active', x.dataset.action === mode));
        renderActionView(mode);
    }

    const MINI_ICON_SVG = `<svg viewBox="0 0 24 24" width="44" height="44" fill="none">
        <circle class="mini-ring" cx="12" cy="12" r="9" stroke-width="1.8" fill="none"/>
        <path class="mini-check" d="M7 12.5l3.2 3.2L17 9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`;

        /* ============================================================
     * 悬浮面板「靠边吸附」—— 贴边隐藏 + 鼠标靠近滑出
     * ------------------------------------------------------------
     * 开关在油猴 / 脚本猫的「用户脚本命令」菜单里。开启后：
     *   · 拖到距屏幕左/右边缘 60px 内松手 → 吸附到那一侧，**常态只露出 5px**；
     *   · 鼠标移到该边缘附近（横向 24px 内、纵向覆盖面板高度）→ 面板滑出；
     *   · 鼠标移开 → 收回，只留 5px；
     *   · 拖到屏幕中间松手 → 解除吸附，保持完整显示。
     * 默认值：标准版 = 开，完整版 = 关（见 FAB_EDGE_SNAP_DEFAULT）。
     * ============================================================ */
    const FAB_DOCK_PEEK = 5;         // 吸附后露出的宽度（只露这么一点）
    const FAB_SNAP_MARGIN = 60;      // 距左右边缘小于该值才吸附
    const FAB_TRIGGER_PX = 24;       // 鼠标距边缘多少 px 内自动滑出
    const FAB_DOCK_INSET = 8;        // 滑出后与屏幕边缘的间隙
    let gFabSnapMenuId = null;
    let gFabResizeBound = false;
    let gFabDockBound = false;

    function fabEdgeSnapOn() {
        try { return GM_getValue(FAB_EDGE_SNAP_KEY, FAB_EDGE_SNAP_DEFAULT) === true; }
        catch (e) { return FAB_EDGE_SNAP_DEFAULT; }
    }
    function fabDockSide(mini) { return (mini && mini.dataset && mini.dataset.dockSide) || ''; }
    function fabIsShown(mini) { return !!(mini && mini.dataset && mini.dataset.dockShown === '1'); }
    function fabSize(mini) { return { w: mini.offsetWidth || 56, h: mini.offsetHeight || 56 }; }
    function fabViewport() {
        return {
            vw: window.innerWidth || document.documentElement.clientWidth || 0,
            vh: window.innerHeight || document.documentElement.clientHeight || 0
        };
    }
    function fabDockTop(mini, top, vh) {
        const h = fabSize(mini).h;
        return Math.max(FAB_DOCK_INSET, Math.min(Math.max(FAB_DOCK_INSET, vh - h - FAB_DOCK_INSET), top));
    }
    function fabSetX(mini, x) {
        mini.style.right = 'auto';
        mini.style.bottom = 'auto';
        mini.style.left = Math.round(x) + 'px';
    }
    /** 吸附到某一侧并收起（只露 FAB_DOCK_PEEK） */
    function fabDockTo(mini, side) {
        if (!mini) return;
        const { w } = fabSize(mini);
        const { vw, vh } = fabViewport();
        if (!vw || !vh) return;
        mini.dataset.dockSide = side;
        mini.dataset.dockShown = '0';
        mini.style.top = Math.round(fabDockTop(mini, mini.getBoundingClientRect().top, vh)) + 'px';
        fabSetX(mini, side === 'left' ? -(w - FAB_DOCK_PEEK) : (vw - FAB_DOCK_PEEK));
    }
    /** 滑出完整面板 */
    function fabDockShow(mini) {
        if (!mini) return;
        const side = fabDockSide(mini);
        if (!side) return;
        const { w } = fabSize(mini);
        const { vw } = fabViewport();
        if (!vw) return;
        mini.dataset.dockShown = '1';
        fabSetX(mini, side === 'left' ? FAB_DOCK_INSET : (vw - w - FAB_DOCK_INSET));
    }
    /** 收回，只露 FAB_DOCK_PEEK */
    function fabDockHide(mini) {
        if (!mini) return;
        const side = fabDockSide(mini);
        if (!side) return;
        const { w } = fabSize(mini);
        const { vw } = fabViewport();
        if (!vw) return;
        mini.dataset.dockShown = '0';
        fabSetX(mini, side === 'left' ? -(w - FAB_DOCK_PEEK) : (vw - FAB_DOCK_PEEK));
    }
    function fabUndock(mini) {
        if (!mini) return;
        mini.dataset.dockSide = '';
        mini.dataset.dockShown = '0';
        mini.style.right = 'auto';
        mini.style.bottom = 'auto';
    }
    /** 拖动结束 / 创建时调用：靠边就吸附收起，否则解除吸附 */
    function applyFabSnap(mini) {
        mini = mini || document.getElementById('dgut-mini-panel');
        if (!mini) return false;
        if (!fabEdgeSnapOn()) { fabUndock(mini); return false; }
        const { vw } = fabViewport();
        if (!vw) return false;
        const r = mini.getBoundingClientRect();
        const distLeft = r.left, distRight = vw - r.right;
        let side = '';
        if (distLeft <= FAB_SNAP_MARGIN) side = 'left';
        else if (distRight <= FAB_SNAP_MARGIN) side = 'right';
        if (!side) { fabUndock(mini); return false; }
        fabDockTo(mini, side);
        return true;
    }
    /** 全局 mousemove：靠近边缘就滑出、离开就收回（显隐的唯一来源，避免抖动） */
    function bindFabDockTrigger() {
        if (gFabDockBound) return;
        gFabDockBound = true;
        document.addEventListener('mousemove', (e) => {
            const mini = document.getElementById('dgut-mini-panel');
            if (!mini || !fabEdgeSnapOn()) return;
            if (mini.dataset.dragging === '1') return;      // 拖动中不干预
            const side = fabDockSide(mini);
            if (!side) return;
            const { h } = fabSize(mini);
            const { vw } = fabViewport();
            if (!vw) return;
            const r = mini.getBoundingClientRect();
            const inBandY = e.clientY >= r.top - 16 && e.clientY <= r.top + h + 16;
            const near = side === 'left'
                ? e.clientX <= Math.max(FAB_TRIGGER_PX, r.right + 8)
                : e.clientX >= Math.min(vw - FAB_TRIGGER_PX, r.left - 8);
            if (near && inBandY) {
                if (!fabIsShown(mini)) fabDockShow(mini);
            } else if (fabIsShown(mini)) {
                fabDockHide(mini);
            }
        }, { passive: true });
    }
    function bindFabResizeSnap() {
        if (gFabResizeBound) return;
        gFabResizeBound = true;
        window.addEventListener('resize', () => {
            try {
                const mini = document.getElementById('dgut-mini-panel');
                if (!mini) return;
                const side = fabDockSide(mini);
                if (side) {
                    const wasShown = fabIsShown(mini);
                    fabDockTo(mini, side);
                    if (wasShown) fabDockShow(mini);
                } else {
                    applyFabSnap(mini);
                }
            } catch (e) {}
        });
    }
    function fabSnapMenuLabel() {
        return '悬浮面板靠边吸附：' + (fabEdgeSnapOn() ? '开（点击关闭）' : '关（点击开启）');
    }
    /** 重新注册菜单项，让标题始终反映当前状态 */
    function refreshFabEdgeSnapMenu() {
        try {
            if (gFabSnapMenuId !== null && typeof GM_unregisterMenuCommand === 'function') {
                GM_unregisterMenuCommand(gFabSnapMenuId);
                gFabSnapMenuId = null;
            }
        } catch (e) {}
        try {
            const id = GM_registerMenuCommand(fabSnapMenuLabel(), toggleFabEdgeSnap);
            gFabSnapMenuId = (id === undefined) ? null : id;
        } catch (e) {}
    }
    function toggleFabEdgeSnap() {
        const next = !fabEdgeSnapOn();
        try { GM_setValue(FAB_EDGE_SNAP_KEY, next); } catch (e) {}
        refreshFabEdgeSnapMenu();
        const mini = document.getElementById('dgut-mini-panel');
        if (mini) {
            const side = fabDockSide(mini);
            if (next) {
                applyFabSnap(mini);
            } else {
                fabUndock(mini);                       // 关闭吸附：恢复完整显示
                if (side) {
                    const { w } = fabSize(mini);
                    const { vw } = fabViewport();
                    fabSetX(mini, side === 'left' ? FAB_DOCK_INSET : Math.max(0, vw - w - FAB_DOCK_INSET));
                }
            }
            try {
                const rect = mini.getBoundingClientRect();
                GM_setValue(FAB_POS_KEY, { left: rect.left, top: rect.top, side: fabDockSide(mini) });
            } catch (e) {}
        }
        try {
            showStatus(next
                ? '悬浮面板靠边吸附已开启：靠边后只露 5px，鼠标靠近边缘自动滑出'
                : '悬浮面板靠边吸附已关闭');
        } catch (e) {}
    }

    function createMiniPanel() {
        if (document.getElementById('dgut-mini-panel')) return;
        const pos = GM_getValue(FAB_POS_KEY, null);
        const mini = document.createElement('div');
        mini.id = 'dgut-mini-panel';
        mini.title = '打开优学院助手';
        if (pos && pos.left !== undefined) {
            mini.style.left = Math.max(0, Math.min(Math.max(0, window.innerWidth - 80), pos.left)) + 'px';
            mini.style.top = Math.max(0, Math.min(Math.max(0, window.innerHeight - 80), pos.top)) + 'px';
        } else { mini.style.right = '20px'; mini.style.bottom = '20px'; }
        mini.style.transition = 'left .18s ease, top .18s ease';
        mini.innerHTML = MINI_ICON_SVG;
        document.body.appendChild(mini);
        bindFabResizeSnap();
        bindFabDockTrigger();
        if (fabEdgeSnapOn() && pos && pos.side) {
            fabDockTo(mini, pos.side);          // 恢复上次的吸附侧，直接收起
        } else {
            applyFabSnap(mini);                 // 否则按当前位置判断是否靠边
        }
        let drag = null, moved = false;
        mini.addEventListener('mousedown', (e) => {
            /* 吸附状态下只露 5px，先滑出完整面板再拖，并关掉过渡避免跟手延迟 */
            if (fabDockSide(mini)) fabDockShow(mini);
            mini.dataset.dragging = '1';
            mini.style.transition = 'none';
            const rect = mini.getBoundingClientRect();
            drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, ox: rect.left, oy: rect.top, w: rect.width, h: rect.height };
            moved = false;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!drag) return;
            const nx = e.clientX - drag.dx, ny = e.clientY - drag.dy;
            if (!moved && (Math.abs(nx - drag.ox) > 4 || Math.abs(ny - drag.oy) > 4)) moved = true;
            mini.style.right = 'auto'; mini.style.bottom = 'auto';
            mini.style.left = Math.max(0, Math.min(window.innerWidth - (drag.w || 56), nx)) + 'px';
            mini.style.top = Math.max(0, Math.min(window.innerHeight - (drag.h || 56), ny)) + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (!drag) return;
            drag = null;
            mini.dataset.dragging = '';
            mini.style.transition = 'left .18s ease, top .18s ease';
            if (moved) {
                applyFabSnap(mini);                  // 靠边就吸附收起到 5px，否则解除吸附
                const rect = mini.getBoundingClientRect();
                GM_setValue(FAB_POS_KEY, { left: rect.left, top: rect.top, side: fabDockSide(mini) });
            } else if (fabDockSide(mini)) {
                fabDockShow(mini);                   // 只是点了一下：保持滑出，移开鼠标再收回
            }
        });
        mini.addEventListener('click', () => {
            if (moved) return;
            if (document.getElementById('dgut-main-panel')) {
                document.getElementById('dgut-main-panel').remove();
                GM_setValue(PANEL_OPEN_KEY, false);
                return;
            }
            GM_setValue(PANEL_OPEN_KEY, true);
            createPanel();
        });
    }

    function togglePanel(forceOpen) {
        const existing = document.getElementById('dgut-main-panel');
        const mini = document.getElementById('dgut-mini-panel');
        if (existing && !forceOpen) {
            existing.remove();
            GM_setValue(PANEL_OPEN_KEY, false);
            if (!mini) createMiniPanel();
            return;
        }
        if (!existing) { GM_setValue(PANEL_OPEN_KEY, true); createPanel(); }
    }

    function resetPanelPositions() {
        GM_setValue(UI_POS_KEY, null);
        GM_setValue(FAB_POS_KEY, null);
        document.getElementById('dgut-main-panel')?.remove();
        document.getElementById('dgut-mini-panel')?.remove();
        createMiniPanel();
        if (GM_getValue(PANEL_OPEN_KEY, false)) createPanel();
        showToastCard(`${KAO.ok} 布局已重置`, '面板位置、大小与缩放已恢复默认（右下角 780×620、100%）。', '', 4000);
    }

    function resetPanelSize() {
        const p = document.getElementById('dgut-main-panel');
        if (!p) {
            GM_setValue(UI_POS_KEY, Object.assign(panelLayout(), { width: PANEL_DEFAULT_W, height: PANEL_DEFAULT_H, zoom: 1 }));
            showStatus('面板大小已重置（下次打开生效）');
            return;
        }
        p.dataset.zoom = '1';
        p.style.transform = '';
        p.style.width = PANEL_DEFAULT_W + 'px';
        p.style.height = PANEL_DEFAULT_H + 'px';
        p.style.right = 'auto'; p.style.bottom = 'auto';
        panelClampBox(p);
        savePanelState(panelStateOf(p));
        showToastCard('面板大小已重置', `恢复默认 ${PANEL_DEFAULT_W}×${PANEL_DEFAULT_H}、缩放 100%。`, '', 4000);
    }

    function init() {
        initThemeWatcher();
        GM_registerMenuCommand('打开/关闭主面板', () => togglePanel());
        GM_registerMenuCommand('重置面板/悬浮面板位置', resetPanelPositions);
        GM_registerMenuCommand('重置面板大小与缩放', resetPanelSize);
        refreshFabEdgeSnapMenu();
        GM_registerMenuCommand('近七天日程', () => openActionView('schedule'));
        GM_registerMenuCommand('优学院刷课助手', () => openActionView('course'));
        GM_registerMenuCommand('作业互评记录', () => openActionView('peer'));
        GM_registerMenuCommand('求是读书', () => openActionView('read'));
        GM_registerMenuCommand('md转word/PDF', () => openActionView('doc'));
        GM_registerMenuCommand('Word 转 PDF', () => openActionView('wordpdf'));
        GM_registerMenuCommand('照片处理工具', () => openActionView('imagetool'));
        GM_registerMenuCommand('外观设置（主题/主体色）', () => openActionView('appearance'));
        GM_registerMenuCommand('详情（简介与错误码）', () => openActionView('detail'));

        window.addEventListener('resize', () => { try { panelClampBox(); } catch (e) {} });
        createMiniPanel();
        if (GM_getValue(PANEL_OPEN_KEY, false)) createPanel();
    }
    init();
})();
