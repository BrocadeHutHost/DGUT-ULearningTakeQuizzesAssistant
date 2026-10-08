// ==UserScript==
// @name         优学院助手 + 文档工具（签到/刷课/互评/读书 + MD转Word·PDF + 电子签名）
// @namespace    https://github.com/BrocadeHutHost
// @version      5.7.0
// @description  优学院课程签到监测 + 刷课助手(倍速守卫/自动答题/题库) + 作业互评面板 + 求是读书 + 外观设置 + Markdown 转 Word/PDF(直出下载) + Word 转 PDF + 图片工具 + 手绘电子签名。v5.7.0：刷课助手内核重写——答案接口改为真异步等待、自动答题/自动翻页开关真实生效、取不到答案绝不提交（不空交）、视频卡死与加载失败自动分级恢复、专题末页自动从目录寻找下一未完成页、任务代次杜绝重复提交与提前翻页；主面板支持拖拽改变大小、Ctrl+滚轮缩放文字与元素、左侧栏可滚动，最大宽高不超过浏览器窗口。v5.6.0：详情页「作者与许可」新增 GitHub 项目 Star/Fork/Watch 数据与作者、贡献者头像（30 分钟缓存）。v5.5.0：修复动态加载库在沙箱中读不到全局变量导致「mammoth 库未加载」的问题；图片像素处理迁移到 Web Worker 多线程执行；PDF 分片导出支持主线程让出。
// @author       BrocadeHutHost
// @match        *://*/*
// @icon         https://lms.dgut.edu.cn/favicon.ico
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_cookie
// @grant        GM_notification
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
// @license      AGPL-3.0-only
// ==/UserScript==

(function () {
    'use strict';

    const API_HOST = 'https://lms.dgut.edu.cn';
    const TAG = '[优学院助手]';
    const UI_POS_KEY = 'dgut_ui_positions';
    const FAB_POS_KEY = 'dgut_fab_pos';
    const PANEL_OPEN_KEY = 'dgut_panel_open_state';
    const VIEW_MODE_KEY = 'dgut_view_mode';
    const THEME_MODE_KEY = 'dgut_theme_mode';
    const ACCENT_KEY = 'dgut_theme_accent';
    const MANUAL_TOKEN_KEY = 'dgut_manual_token';
    const MANUAL_USERID_KEY = 'dgut_manual_userid';
    const SIGN_CONFIG_KEY = 'dgut_sign_config';
    const SIGN_LOG_KEY = 'dgut_sign_log';
    const SIGN_USERID_KEY = 'dgut_sign_userid';
    const COURSE_HELPER_KEY = 'dgut_course_helper_config';
    const BANK_KEY = 'dgut_quiz_bank';
    const PEER_KEY = 'dgut_peer_review_records';
    const READ_CFG_KEY = 'dgut_single_file_helper_config';
    const READ_RECORDS_KEY = 'dgut_reading_records';
    const DOC_DRAFT_KEY = 'dgut_doc_md_draft';
    const DOC_TITLE_KEY = 'dgut_doc_md_title';
    const DOC_SIGN_KEY  = 'dgut_doc_signatures';
    const IMG_CFG_KEY   = 'dgut_image_tool_config';
    const DETAIL_TAB_KEY = 'dgut_detail_tab';
    const DEBUG = true;

    /* ============================================================
     * 错误码系统
     * ============================================================ */
    const ERR = {
        SIGN_NO_TOKEN:      { code: 1131, msg: '无法获取 Token，请先登录优学院' },
        SIGN_TOKEN_EXPIRED: { code: 1132, msg: 'Token 已过期，请重新登录' },
        SIGN_NET_FAIL:      { code: 1111, msg: '网络请求失败' },
        SIGN_TIMEOUT:       { code: 1112, msg: '请求超时' },
        SIGN_HTTP_ERR:      { code: 1113, msg: 'HTTP 状态码异常' },
        SIGN_AUTH_FAIL:     { code: 1133, msg: '认证失败（401/403），请重新登录' },
        SIGN_PARSE_FAIL:    { code: 1121, msg: '返回数据解析失败' },
        SIGN_NO_USERID:     { code: 1231, msg: '未获取到用户ID (userid)' },
        SIGN_USERID_LOWCONF:{ code: 1232, msg: 'userid 来自低置信度来源（成员列表），可能与当前登录用户不符，已阻止自动签到' },
        SIGN_COURSE_EMPTY:  { code: 1221, msg: '课程列表为空' },
        SIGN_NO_COURSE:     { code: 1251, msg: '尚未选择课程' },
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
        { module: '课程签到',   codes: [1131, 1132, 1133, 1111, 1112, 1113, 1121, 1221, 1231, 1232, 1251] },
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

    if (window.top !== window.self) {
        (function readerFrameBootstrap() {
            const MSG = 'DGUT_SINGLE_FILE_READER_SYNC';
            const CFG_KEY = 'dgut_single_file_helper_config';
            const DEF = { readerSec: 30, readerAutoStart: true };
            function readCfg() {
                let r = {};
                try { r = GM_getValue(CFG_KEY, DEF) || {}; } catch (e) { r = {}; }
                const sec = parseInt(r.readerSec, 10);
                return { readerSec: sec > 0 ? sec : DEF.readerSec, readerAutoStart: r.readerAutoStart !== false };
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
            function apply(s, auto) { stop(); if (auto !== false) start(s); }
            window.addEventListener('message', (e) => {
                const d = e.data;
                if (!d || d.type !== MSG) return;
                const sec = parseInt(d.intervalSec, 10) || DEF.readerSec;
                rlog('收到同步：' + sec + '秒/页，' + (d.autoStart !== false ? '自动' : '暂停'));
                apply(sec, d.autoStart);
            });
            function tryStart() { const st = readCfg(); apply(st.readerSec, st.readerAutoStart); }
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
            if (r.ok) console.log(TAG, `[自检] ✓ ${r.name}`);
            else console.warn(TAG, `[自检] ✗ ${errTag(r.errDef)} ${r.name} 未就绪`);
        });

        const host = location.hostname;
        const isLms = /(^|\.)dgut\.edu\.cn$/i.test(host) || /(^|\.)ulearning\.cn$/i.test(host);
        console.log(TAG, `[自检] 当前域 ${host} ${isLms ? '✓ 属于优学院环境' : '⚠ 不在优学院环境中（部分功能不可用）'}`);

        const ifr = detectIframe();
        console.log(TAG, `[自检] ${ifr.isTop ? '✓ 顶层窗口' : '⚠ iframe 环境（刷课/读书建议在顶层打开）'}`);
        if (ifr.hasVideo) console.log(TAG, `[自检] ✓ 本帧存在 video 元素`);
        if (ifr.hasVM) console.log(TAG, `[自检] ✓ 本帧存在 koLearnCourseViewModel`);
        if (ifr.hasKo) console.log(TAG, `[自检] ✓ 本帧存在 ko`);
        console.log(TAG, '========== 自检结束 ==========');

        window.__dgutSelfCheckResults = results;        return results;
    }
    setTimeout(selfCheck, 800);

    setTimeout(async function asyncSelfCheck() {
        console.log(TAG, '========== 异步自检开始 ==========');
        try {
            const auth = await checkAuthToken();
            if (!auth.present) {
                console.warn(TAG, `[自检] ? ${errTag(ERR.SIGN_NO_TOKEN)} 未获取到 Token（可能未登录）`);
            } else {
                const expStr = (auth.payload && auth.payload.exp) ? new Date(auth.payload.exp * 1000).toLocaleString() : '无 exp';
                if (auth.expired) console.warn(TAG, `[自检] ? ${errTag(ERR.SIGN_TOKEN_EXPIRED)} Token 已过期（过期于 ${expStr}）`);
                else console.log(TAG, `[自检] ? Token 存在（来源：${auth.source}，长度 ${auth.token.length}，过期于 ${expStr}）`);
            }
        } catch (e) {}

        try {
            const uid = await signResolveUserId();
            if (uid) {
                const src = gSignUserIdSource || '未知';
                const conf = gSignUserIdConfidence || '未知';
                const lvl = conf === 'high' ? '?' : conf === 'medium' ? '?' : '?';
                console.log(TAG, `[自检] ${lvl} userid = ${uid}（来源：${src}，置信度：${conf}）`);
                if (conf === 'low') console.warn(TAG, `[自检] ? ${errTag(ERR.SIGN_USERID_LOWCONF)}`);
            } else {
                console.warn(TAG, `[自检] ? ${errTag(ERR.SIGN_NO_USERID)} 未获取到 userid`);
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
        sign: `<svg viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
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
        .dgut-list-box { max-height: 200px; overflow-y: auto; }
        .dgut-sign-course { display: block; width: 100%; text-align: left; margin-bottom: 4px; padding: 8px 10px; border: 1px solid var(--dgut-outline-variant); border-radius: 10px; background: var(--dgut-surface-3); cursor: pointer; font-size: 13px; color: var(--dgut-on-surface); font-family: inherit; transition: background .15s, border-color .15s, color .15s; }
        .dgut-sign-course:hover { background: var(--dgut-secondary-container); }
        .dgut-sign-course.active { border-color: var(--dgut-primary); background: var(--dgut-primary-container); color: var(--dgut-on-primary-container); }
        .dgut-sign-course .course-meta { color: var(--dgut-on-surface-variant); font-size: 11px; margin-left: 6px; }
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
        .dgut-conf { font-size: 11px; padding: 1px 6px; border-radius: 999px; font-weight: 600; }
        .dgut-conf-high { background: var(--dgut-success-container); color: var(--dgut-on-success-container); }
        .dgut-conf-mid  { background: var(--dgut-warn-container); color: var(--dgut-on-warn-container); }
        .dgut-conf-low  { background: var(--dgut-error-container); color: var(--dgut-on-error-container); }
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

    async function gmFetchEx(url, opts = {}) {
        const token = await getAuthToken();
        if (!token) throw new Error(errFull(ERR.SIGN_NO_TOKEN));
        const method = String(opts.method || 'GET').toUpperCase();
        const headers = { 'Accept': 'application/json, text/plain, */*', 'Referer': API_HOST + '/', 'Origin': API_HOST };
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
                    if (res.status === 401 || res.status === 403) return reject(new Error(errFull(ERR.SIGN_AUTH_FAIL, 'HTTP ' + res.status)));
                    if (res.status >= 400) return reject(new Error(errFull(ERR.SIGN_HTTP_ERR, 'HTTP ' + res.status)));
                    try { resolve(JSON.parse(res.responseText)); }
                    catch (e) { reject(new Error(errFull(ERR.SIGN_PARSE_FAIL, String(res.responseText).slice(0, 80)))); }
                },
                onerror: () => reject(new Error(errFull(ERR.SIGN_NET_FAIL))),
                ontimeout: () => reject(new Error(errFull(ERR.SIGN_TIMEOUT)))
            });
        });
    }

    /* ============================================================
     * 签到
     * ============================================================ */
    const SIGN_LMS_BASE = API_HOST + '/courseapi';
    const SIGN_APP_BASE = 'https://application.dgut.edu.cn/classroomapi';
    const SIGN_KINDS = { 0: '选人点名', 1: '二维码签到', 2: '数字码签到', 3: '一键签到' };
    const DEFAULT_SIGN_CONFIG = {
        selectedCourseId: null, selectedCourseName: '',
        pollInterval: 5, saveLog: true,
        lat: 23.0432, lng: 113.3993, address: '东莞理工学院'
    };
    const p2 = (n) => String(n).padStart(2, '0');
    let gSignCourses = [];
    let gSignUserId = null;
    let gSignUserIdSource = null;
    let gSignUserIdConfidence = null;
    let gSignMonitor = null;

    function getSignConfig() { return Object.assign({}, DEFAULT_SIGN_CONFIG, GM_getValue(SIGN_CONFIG_KEY, {}) || {}); }
    function saveSignConfig(patch) { GM_setValue(SIGN_CONFIG_KEY, Object.assign(getSignConfig(), patch)); }
    function signKindText(t) { return SIGN_KINDS[t] || '未知签到'; }

    async function signResolveUserId() {
        if (gSignUserId) return gSignUserId;

        const manual = Number(GM_getValue(MANUAL_USERID_KEY, 0));
        if (Number.isFinite(manual) && manual > 0) {
            gSignUserId = manual; gSignUserIdSource = '手动覆盖'; gSignUserIdConfidence = 'high';
            return manual;
        }

        let uid = null;

        // 1. JWT payload（最可靠）
        try {
            const token = await getAuthToken();
            const p = token ? parseJwt(token) : null;
            if (p) {
                const v = p.userid || p.userId || p.uid || p.id || p.sub;
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) { uid = n; gSignUserIdSource = 'JWT'; gSignUserIdConfidence = 'high'; }
            }
        } catch (e) {}

        // 2. document.cookie
        if (!uid) {
            try {
                const ck = document.cookie || '';
                const names = ['userid', 'userId', 'USERID', 'userID', 'uid', 'user_id', 'studentid', 'studentId'];
                for (const name of names) {
                    const m = ck.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)', 'i'));
                    if (!m) continue;
                    const n = Number(decodeURIComponent(m[1]));
                    if (Number.isFinite(n) && n > 0) { uid = n; gSignUserIdSource = 'document.cookie'; gSignUserIdConfidence = 'medium'; break; }
                }
            } catch (e) {}
        }

        // 3. GM_cookie
        if (!uid && typeof GM_cookie !== 'undefined' && GM_cookie.list) {
            const urls = [location.origin, 'https://lms.dgut.edu.cn', 'https://application.dgut.edu.cn', 'https://ua.dgut.edu.cn', 'https://www.ulearning.cn'];
            const names = ['userid', 'userId', 'USERID', 'userID', 'uid', 'user_id', 'studentid', 'studentId'];
            outer:
            for (const url of urls) {
                for (const name of names) {
                    const v = await new Promise((resolve) => {
                        try {
                            GM_cookie.list({ url, name }, (cookies, error) => {
                                if (error || !cookies || !cookies.length) return resolve(null);
                                const n = Number(cookies[0].value);
                                resolve(Number.isFinite(n) && n > 0 ? n : null);
                            });
                        } catch (e) { resolve(null); }
                    });
                    if (v) { uid = v; gSignUserIdSource = 'GM_cookie'; gSignUserIdConfidence = 'medium'; break outer; }
                }
            }
        }

        // 4. localStorage
        if (!uid) {
            try {
                const keys = ['userid','userId','USERID','uid','user','userInfo','USER_INFO','loginUser'];
                for (const k of keys) {
                    const raw = localStorage.getItem(k);
                    if (!raw) continue;
                    let v = raw;
                    try { const o = JSON.parse(raw); v = o && (o.userid || o.userId || o.id || o.uid || o.studentid); } catch (e) {}
                    const n = Number(v);
                    if (Number.isFinite(n) && n > 0) { uid = n; gSignUserIdSource = 'localStorage'; gSignUserIdConfidence = 'medium'; break; }
                }
            } catch (e) {}
        }

        // 5. 页面全局变量
        if (!uid) {
            try {
                const cands = [
                    PAGE_WIN.userInfo, PAGE_WIN.currentUser, PAGE_WIN.user,
                    PAGE_WIN.gUserInfo, PAGE_WIN.studentUser,
                    PAGE_WIN.koLearnCourseViewModel && (typeof PAGE_WIN.koLearnCourseViewModel.user === 'function'
                        ? PAGE_WIN.koLearnCourseViewModel.user() : PAGE_WIN.koLearnCourseViewModel.user),
                    PAGE_WIN.__INITIAL_STATE__ && PAGE_WIN.__INITIAL_STATE__.user
                ];
                for (const c of cands) {
                    if (!c) continue;
                    const v = c.userid || c.userId || c.id || c.uid || c.studentid;
                    const n = Number(v);
                    if (Number.isFinite(n) && n > 0) { uid = n; gSignUserIdSource = '页面全局变量'; gSignUserIdConfidence = 'medium'; break; }
                }
            } catch (e) {}
        }

        // 6. 课程成员列表（低置信度兜底）
        if (!uid) {
            try {
                const cid = (gSignCourses && gSignCourses[0] && gSignCourses[0].id)
                          || new URL(location.href).searchParams.get('courseId')
                          || GM_getValue(SIGN_CONFIG_KEY, {}).selectedCourseId;
                if (cid) {
                    const res = await gmFetchEx(`${SIGN_LMS_BASE}/classes?ocId=${cid}&pn=1&ps=9999&userId=&keyword=&lang=zh`);
                    const list = (res && (res.list || (res.result && res.result.list))) || [];
                    for (const m of list) {
                        const n = Number(m.userId || m.userid);
                        if (Number.isFinite(n) && n > 0) {
                            uid = n; gSignUserIdSource = '成员列表(兜底)'; gSignUserIdConfidence = 'low'; break;
                        }
                    }
                }
            } catch (e) {}
        }

        // 7. 缓存
        if (!uid) {
            const cached = GM_getValue(SIGN_USERID_KEY, null);
            const n = Number(cached);
            if (Number.isFinite(n) && n > 0) { uid = n; gSignUserIdSource = '缓存'; gSignUserIdConfidence = 'medium'; }
        }

        if (uid) { gSignUserId = uid; GM_setValue(SIGN_USERID_KEY, uid); }
        return gSignUserId;
    }

    function signUserIdBadge() {
        if (!gSignUserId) return '';
        const conf = gSignUserIdConfidence || 'medium';
        const cls = conf === 'high' ? 'dgut-conf-high' : conf === 'medium' ? 'dgut-conf-mid' : 'dgut-conf-low';
        const label = conf === 'high' ? '高' : conf === 'medium' ? '中' : '低';
        return `<span class="dgut-conf ${cls}" title="来源：${escapeHtml(gSignUserIdSource || '未知')}">userid ${gSignUserId} · 置信度${label}</span>`;
    }

    async function signLoadCourses(verbose = true) {
        if (verbose) startStatusTicker('正在读取优学院课程列表');
        try {
            const res = await gmFetchEx(`${SIGN_LMS_BASE}/courses/students?keyword=&publishStatus=1&type=1&pn=1&ps=50`);
            const list = (res && (res.courseList || (res.result && res.result.courseList))) || [];
            gSignCourses = list.map(c => ({ id: c.id, name: c.name || '未命名课程', teacherName: c.teacherName || '' }));
            await signResolveUserId();
            if (verbose) { stopStatusTicker(); showStatus(`已读取 ${gSignCourses.length} 门课程`); }
            if (gSignMonitor) renderSignViewRefreshCourses();
            return gSignCourses;
        } catch (e) {
            if (verbose) { stopStatusTicker(); showStatus('读取课程失败：' + e.message, true); }
            return gSignCourses;
        }
    }
    async function signFetchClassrooms(courseId) {
        const res = await gmFetchEx(`${SIGN_LMS_BASE}/wisdomClassroom/student/getClassroomList?ocId=${courseId}&status=&pageNum=1&pageSize=10&order=0&lang=zh`);
        const list = (res && res.code === 1 && res.result && res.result.list) || [];
        return list.map(c => ({ id: c.id, title: c.title || '' }));
    }
    async function signFetchActivities(classroomId) {
        const res = await gmFetchEx(`${SIGN_APP_BASE}/wisdomClassroom/student/classroomActivitys?classroomId=${classroomId}&pageNum=1&pageSize=999`);
        return (res && res.code === 1 && res.result && res.result.list) || [];
    }
    function signAttendanceCode(activity) {
        if (!activity) return '';
        for (const k of ['attendanceCode', 'code', 'codeStr', 'signCode', 'checkInCode']) { if (activity[k]) return String(activity[k]); }
        return '';
    }
    async function signSubmit(course, classroomId, activity) {
        const scoreType = activity.scoreType;
        const kind = signKindText(scoreType);
        const attendanceId = activity.relationId;
        const code = scoreType === 1 ? signAttendanceCode(activity) : '';
        if (scoreType === 1 && !code) return { skip: true, kind, message: '未找到二维码签到码，已跳过（脚本不识别教室现场二维码图片）' };
        if (![1, 2, 3].includes(scoreType)) return { skip: true, kind, message: '当前类型不支持自动处理，已跳过' };
        const cfg = getSignConfig();
        const uid = await signResolveUserId();
        if (!uid) return { ok: false, kind, message: errFull(ERR.SIGN_NO_USERID) };
        const payload = { attendanceID: attendanceId, classID: classroomId, userID: uid, location: `${cfg.lat},${cfg.lng}`, address: cfg.address, enterWay: 1, attendanceCode: code };
        let status, message;
        try {
            const res = await gmFetchEx(`${SIGN_APP_BASE}/newAttendance/signByStu`, { method: 'POST', data: payload });
            status = res && res.status;
            message = (res && (res.msg || res.message)) || (res ? JSON.stringify(res).slice(0, 120) : '');
        } catch (e) { status = 'exception'; message = e.message; }
        return { ok: status === 200 || status === 201, already: status === 201, status, message, kind };
    }
    function signLog(text, level = 'info') {
        const line = { t: Date.now(), text: String(text), level };
        const el = document.getElementById('dgut-sign-log');
        if (el) {
            const div = document.createElement('div');
            div.className = `dgut-log-line log-${level || 'info'}`;
            div.textContent = `[${new Date(line.t).toLocaleTimeString('zh-CN')}] ${line.text}`;
            el.appendChild(div);
            while (el.childElementCount > 400) el.removeChild(el.firstChild);
            el.scrollTop = el.scrollHeight;
        }
        log('[签到]', line.text);
    }
    function writeSignRecord(course, kind, activity, result) {
        if (!getSignConfig().saveLog) return;
        const rec = GM_getValue(SIGN_LOG_KEY, []);
        rec.push({ time: Date.now(), course, kind, attendanceID: activity && activity.relationId, status: result.status, message: result.message });
        GM_setValue(SIGN_LOG_KEY, rec.slice(-500));
    }
    async function signPollOnce(course) {
        if (gSignMonitor) gSignMonitor.busy = true;
        try {
            const d = new Date();
            const today = `${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
            let classrooms = [];
            try { classrooms = (await signFetchClassrooms(course.id)).filter(c => c.title && c.title.includes(today)); }
            catch (e) { signLog(`[${course.name}] 读取课堂列表失败：${e.message}`, 'warn'); return; }
            if (!classrooms.length) { signLog(`[${course.name}] 本轮完成：今天没有课堂，无需签到。`, 'muted'); return; }
            let activeCount = 0, newCount = 0;
            for (const classroom of classrooms) {
                let activities = [];
                try { activities = await signFetchActivities(classroom.id); }
                catch (e) { signLog(`[${course.name}] 读取课堂活动失败：${e.message}`, 'warn'); continue; }
                for (const activity of activities) {
                    if (activity.relationType !== 1 || activity.state !== 1 || activity.status !== 0) continue;
                    activeCount++;
                    const key = `${activity.relationId}_${classroom.id}`;
                    if (gSignMonitor.checked.has(key)) continue;
                    newCount++;
                    signLog(`[${course.name}] 发现 ${signKindText(activity.scoreType)}，正在处理…`, 'info');
                    let result;
                    try { result = await signSubmit(course, classroom.id, activity); }
                    catch (e) { result = { ok: false, kind: signKindText(activity.scoreType), message: e.message }; }
                    if (result.skip) { signLog(`[${course.name}] ${result.kind}：${result.message}`, 'warn'); gSignMonitor.checked.add(key); writeSignRecord(course.name, result.kind, activity, { status: 'skipped', message: result.message }); continue; }
                    if (result.ok) { gSignMonitor.checked.add(key); signLog(`? [${course.name}] ${result.kind}：${result.already ? '已签到过' : '签到成功'}`, 'success'); }
                    else signLog(`× [${course.name}] ${result.kind}：${result.message}`, 'warn');
                    writeSignRecord(course.name, result.kind, activity, result);
                }
            }
            if (activeCount === 0) signLog(`[${course.name}] 本轮完成：未发现进行中的签到。`, 'muted');
            else if (newCount === 0) signLog(`[${course.name}] 本轮完成：签到活动已处理，继续等待。`, 'muted');
        } finally {
            if (gSignMonitor) gSignMonitor.busy = false;
        }
    }
    function startSignMonitor() {
        const cfg = getSignConfig();
        const course = gSignCourses.find(c => String(c.id) === String(cfg.selectedCourseId));
        if (!course) { showStatus(errFull(ERR.SIGN_NO_COURSE), true); return; }
        if (gSignUserIdConfidence === 'low') {
            showToastCard('? userid 置信度低', '当前 userid 来自成员列表兜底，可能与登录用户不符。请在签到设置中手动填写 userid 后再启动。', '', 12000);
            showStatus(errFull(ERR.SIGN_USERID_LOWCONF), true);
            return;
        }
        stopSignMonitor(true);
        gSignMonitor = { timer: null, checked: new Set(), running: true, course, busy: false };
        const interval = Math.max(2, Number(cfg.pollInterval) || 5);
        signLog(`开始监测《${course.name}》，每 ${interval} 秒检查一次。`, 'success');
        signLog(`当前 userid: ${gSignUserId}（来源：${gSignUserIdSource}，置信度：${gSignUserIdConfidence}）`, 'muted');
        signLog('提示：数字码/一键签到可直接完成；二维码签到仅当活动数据自带签到码时才处理。', 'muted');
        const run = async () => {
            if (!gSignMonitor || !gSignMonitor.running || gSignMonitor.busy) return;
            await signPollOnce(gSignMonitor.course);
        };
        run();
        gSignMonitor.timer = setInterval(run, interval * 1000);
        renderSignViewStatus();
        showToastCard(`签到监测已启动`, `《${course.name}》· 每 ${interval} 秒检查一次`, '数字码/一键签到自动完成；二维码需活动自带码', 8000);
    }
    function stopSignMonitor(silent = false) {
        if (!gSignMonitor) return;
        gSignMonitor.running = false;
        if (gSignMonitor.timer) clearInterval(gSignMonitor.timer);
        gSignMonitor = null;
        if (!silent) { signLog('已停止签到监测。', 'warn'); renderSignViewStatus(); showStatus('已停止签到监测'); }
    }
    function exportSignLog() {
        const rec = GM_getValue(SIGN_LOG_KEY, []);
        if (!rec.length) { showStatus('暂无签到记录可导出', true); return; }
        let md = '# 签到记录\n\n';
        rec.slice().reverse().forEach(r => {
            const d = new Date(r.time);
            md += `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())} | ${r.course} | ${r.kind} |\n`;
            md += `  - attendanceID: ${r.attendanceID}\n  - status: ${r.status}\n  - response: ${r.message}\n\n`;
        });
        const uri = 'data:text/markdown;charset=utf-8,' + encodeURIComponent('\uFEFF' + md);
        const a = document.createElement('a');
        a.href = uri; a.download = `签到记录_${dateKey()}.md`;
        a.style.display = 'none'; document.body.appendChild(a); a.click();
        setTimeout(() => document.body.removeChild(a), 100);
        showStatus('签到记录已导出');
    }
    function renderSignViewStatus() {
        const el = document.getElementById('dgut-sign-status');
        if (!el) return;
        if (gSignMonitor && gSignMonitor.running) {
            el.innerHTML = `<span style="color:var(--dgut-success);font-weight:600;">● 监测中</span> · 《${escapeHtml(gSignMonitor.course.name)}》 · 已处理 ${gSignMonitor.checked.size} 项`;
        } else {
            el.innerHTML = `<span style="color:var(--dgut-on-surface-variant);">○ 未运行</span>`;
        }
    }
    function renderSignViewRefreshCourses() { const box = document.getElementById('dgut-sign-courses'); if (box) renderSignCourseList(box); }
    function renderSignCourseList(box) {
        if (!box) return;
        const cfg = getSignConfig();
        const kw = (document.getElementById('dgut-sign-search')?.value || '').trim().toLowerCase();
        const list = gSignCourses.filter(c => !kw || c.name.toLowerCase().includes(kw) || String(c.id).includes(kw) || (c.teacherName || '').toLowerCase().includes(kw));
        if (!list.length) {
            box.innerHTML = `<div style="font-size:12px;color:var(--dgut-on-surface-variant);padding:6px 0;">${gSignCourses.length ? '无匹配课程' : '尚未读取课程，点击上方"读取课程"'}</div>`;
            return;
        }
        box.innerHTML = list.slice(0, 60).map(c => {
            const active = String(c.id) === String(cfg.selectedCourseId);
            return `<button class="dgut-sign-course${active ? ' active' : ''}" data-id="${c.id}" data-name="${escapeHtml(c.name)}">
                <b>${escapeHtml(c.name)}</b><span class="course-meta">${escapeHtml(c.teacherName || '')} · #${c.id}</span></button>`;
        }).join('');
        box.querySelectorAll('.dgut-sign-course').forEach(btn => btn.onclick = () => {
            saveSignConfig({ selectedCourseId: Number(btn.dataset.id), selectedCourseName: btn.dataset.name });
            renderSignCourseList(box);
        });
    }
    function renderSignView(ac) {
        const cfg = getSignConfig();
        const manualUid = GM_getValue(MANUAL_USERID_KEY, 0) || '';
        ac.innerHTML = actionHeader(ACTION_TITLES.sign, '轮询当日课堂活动并自动签到') + `
            <div class="dgut-card">
                <div class="dgut-row dgut-row--mb">
                    <input id="dgut-sign-search" class="dgut-input" placeholder="搜索课程（名称/教师/ID）" style="flex:1;min-width:0;">
                    <button id="dgut-sign-load" class="dgut-btn dgut-btn-primary" style="flex:none;">${icons.refresh} 读取课程</button>
                </div>
                <div id="dgut-sign-courses" class="dgut-list-box"></div>
            </div>
            <div class="dgut-card">
                <div class="dgut-section-title">身份校验 <span style="font-weight:400;color:var(--dgut-on-surface-variant);font-size:11px;">（签到核心，请确认无误）</span></div>
                <div id="dgut-sign-uid-info" style="font-size:12px;color:var(--dgut-on-surface-variant);margin-bottom:8px;line-height:1.7;"></div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label">手动 userid
                        <input type="number" id="dgut-sign-uid" class="dgut-input" placeholder="留空=自动解析" min="0" value="${manualUid}" style="width:130px;padding:4px 6px;">
                    </label>
                    <button id="dgut-sign-uid-save" class="dgut-btn">保存</button>
                    <button id="dgut-sign-uid-clear" class="dgut-btn">清除覆盖</button>
                </div>
            </div>
            <div class="dgut-card">
                <div class="dgut-section-title">监测设置</div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label">轮询间隔(秒) <input type="number" id="dgut-sign-interval" class="dgut-input" value="${cfg.pollInterval}" min="2" max="3600" style="width:64px;padding:4px 6px;"></label>
                    <label class="dgut-label">纬度 <input type="number" id="dgut-sign-lat" class="dgut-input" value="${cfg.lat}" step="0.0001" style="width:110px;padding:4px 6px;"></label>
                    <label class="dgut-label">经度 <input type="number" id="dgut-sign-lng" class="dgut-input" value="${cfg.lng}" step="0.0001" style="width:110px;padding:4px 6px;"></label>
                    <label class="dgut-label">地址 <input type="text" id="dgut-sign-addr" class="dgut-input" value="${escapeHtml(cfg.address)}" style="width:150px;padding:4px 6px;"></label>
                </div>
                <label class="dgut-label" style="display:block;cursor:pointer;margin-bottom:10px;">
                    <input type="checkbox" id="dgut-sign-savelog" ${cfg.saveLog ? 'checked' : ''}> 保存签到记录（可导出 Markdown）
                </label>
                <div id="dgut-sign-status" style="font-size:12px;margin-bottom:10px;color:var(--dgut-on-surface-variant);"></div>
                <div class="dgut-row dgut-row--end">
                    <button id="dgut-sign-save" class="dgut-btn">${icons.settings} 保存设置</button>
                    <button id="dgut-sign-start" class="dgut-btn dgut-btn-primary">${icons.sign} 开始监测</button>
                    <button id="dgut-sign-stop" class="dgut-btn">停止</button>
                    <button id="dgut-sign-export" class="dgut-btn">${icons.export} 导出记录</button>
                </div>
            </div>
            <div class="dgut-card dgut-card--tight">
                <div class="dgut-section-title">运行日志</div>
                <div id="dgut-sign-log" class="dgut-log"></div>
            </div>
            <div class="dgut-hint">
                <b>关于 userid 置信度</b>：脚本优先从 JWT / 手动覆盖获取（高），其次 cookie / localStorage / 全局变量（中），最后从课程成员列表兜底（低）。<br>
                <b>低置信度时禁止自动签到</b>，请手动填入 userid 后再启动。<br>
                <b>关于二维码签到</b>：本脚本不会识别教室现场展示的二维码图片。数字码签到、一键签到可直接完成；二维码签到仅当活动数据本身已包含签到码时才会自动处理。
            </div>`;
        const box = ac.querySelector('#dgut-sign-courses');
        const infoEl = ac.querySelector('#dgut-sign-uid-info');
        const refreshUidInfo = () => {
            const uid = gSignUserId;
            if (!uid) {
                infoEl.innerHTML = `<span style="color:var(--dgut-on-surface-variant);">尚未解析 userid。</span> ${signUserIdBadge()}`;
                return;
            }
            infoEl.innerHTML = `当前 userid：<b>${uid}</b> · 来源：<b>${escapeHtml(gSignUserIdSource || '未知')}</b> · ${signUserIdBadge()}`;
            if (gSignUserIdConfidence === 'low') {
                infoEl.innerHTML += `<br><span style="color:var(--dgut-error);">? 低置信度：可能取到老师/其他学生，请手动覆盖。</span>`;
            }
        };
        refreshUidInfo();
        renderSignCourseList(box);
        ac.querySelector('#dgut-sign-search').addEventListener('input', () => renderSignCourseList(box));
        ac.querySelector('#dgut-sign-load').onclick = async () => { await signLoadCourses(true); renderSignCourseList(box); refreshUidInfo(); };
        ac.querySelector('#dgut-sign-uid-save').onclick = () => {
            const v = Number(ac.querySelector('#dgut-sign-uid').value);
            if (Number.isFinite(v) && v > 0) {
                GM_setValue(MANUAL_USERID_KEY, v);
                gSignUserId = null; gSignUserIdSource = null; gSignUserIdConfidence = null;
                signResolveUserId().then(() => { refreshUidInfo(); showStatus('已保存手动 userid：' + v); });
            } else showStatus('请输入有效的 userid', true);
        };
        ac.querySelector('#dgut-sign-uid-clear').onclick = () => {
            GM_setValue(MANUAL_USERID_KEY, 0);
            gSignUserId = null; gSignUserIdSource = null; gSignUserIdConfidence = null;
            ac.querySelector('#dgut-sign-uid').value = '';
            signResolveUserId().then(() => { refreshUidInfo(); showStatus('已清除手动 userid'); });
        };
        const readSettings = () => ({
            pollInterval: Math.max(2, Number(ac.querySelector('#dgut-sign-interval').value) || 5),
            lat: Number(ac.querySelector('#dgut-sign-lat').value) || DEFAULT_SIGN_CONFIG.lat,
            lng: Number(ac.querySelector('#dgut-sign-lng').value) || DEFAULT_SIGN_CONFIG.lng,
            address: ac.querySelector('#dgut-sign-addr').value.trim() || DEFAULT_SIGN_CONFIG.address,
            saveLog: ac.querySelector('#dgut-sign-savelog').checked
        });
        ac.querySelector('#dgut-sign-save').onclick = () => { saveSignConfig(readSettings()); showStatus('签到设置已保存'); };
        ac.querySelector('#dgut-sign-start').onclick = async () => {
            saveSignConfig(readSettings());
            if (gSignUserIdConfidence === 'low' || !gSignUserId) await signResolveUserId();
            refreshUidInfo();
            if (!gSignCourses.length) signLoadCourses(true).then(() => startSignMonitor());
            else startSignMonitor();
        };
        ac.querySelector('#dgut-sign-stop').onclick = () => stopSignMonitor();
        ac.querySelector('#dgut-sign-export').onclick = exportSignLog;
        renderSignViewStatus();
        const logEl = ac.querySelector('#dgut-sign-log');
        if (logEl) {
            GM_getValue(SIGN_LOG_KEY, []).slice(-30).forEach(r => {
                const d = new Date(r.time);
                const div = document.createElement('div');
                div.className = 'dgut-log-line log-muted';
                div.textContent = `[${d.toLocaleString('zh-CN')}] ${r.course} | ${r.kind} | ${r.status || ''} ${r.message || ''}`;
                logEl.appendChild(div);
            });
        }
        if (gSignCourses.length) renderSignCourseList(box);
        else signLoadCourses(false).then(() => { renderSignCourseList(box); refreshUidInfo(); });
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
    const PG_MAX_NO_ANSWER_ROUNDS = 6;       // 取不到答案的重试轮次上限
    const PG_SKIP_TTL_MS = 30 * 60 * 1000;   // 跳过页面的记忆时长
    const PG_ANSWER_TTL_MS = 5 * 60 * 1000;  // 答案缓存时长

    function isCoursePage() { return /learnCourse/i.test(location.pathname) || /learnCourse/i.test(location.href); }
    function getCourseHelperConfig() { return Object.assign({}, DEFAULT_COURSE_HELPER, GM_getValue(COURSE_HELPER_KEY, {}) || {}); }
    function saveCourseHelperConfig(patch) { GM_setValue(COURSE_HELPER_KEY, Object.assign(getCourseHelperConfig(), patch)); }
    function pgVisible(el) { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
    function pgReText(text) { return String(text || '').replace(/<\/?.+?\/?>/g, '').replace(/[\t\n\r]/g, '').replace(/&.*?;/g, '').trim(); }
    function pgTriggerMouseSequence(el) { if (!el) return; ['mousedown', 'mouseup', 'click'].forEach(n => { try { el.dispatchEvent(new Event(n, { bubbles: true, cancelable: true })); } catch (e) {} }); try { if (typeof el.click === 'function') el.click(); } catch (e) {} }
    function pgLog(tag, message, detail) { try { if (typeof debugLog === 'function') debugLog(tag, message, detail); } catch (e) {} }
    function chLog(text, level = 'info') {
        const el = document.getElementById('dgut-ch-log');
        if (el) {
            const div = document.createElement('div');
            div.className = `dgut-log-line log-${level || 'info'}`;
            div.textContent = `[${new Date().toLocaleTimeString('zh-CN')}] ${text}`;
            el.appendChild(div);
            while (el.childElementCount > 400) el.removeChild(el.firstChild);
            el.scrollTop = el.scrollHeight;
        }
        log('[刷课]', text);
    }
    function pgRequestJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: 15000,
                onload: (res) => {
                    if (res.status === 401 || res.status === 403) return reject(new Error(errFull(ERR.SIGN_AUTH_FAIL, 'HTTP ' + res.status)));
                    try { resolve(JSON.parse(res.responseText)); }
                    catch (e) { reject(new Error(errFull(ERR.SIGN_PARSE_FAIL))); }
                },
                onerror: () => reject(new Error(errFull(ERR.SIGN_NET_FAIL))),
                ontimeout: () => reject(new Error(errFull(ERR.SIGN_TIMEOUT)))
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

    const pgRateGuard = {
        target: 6, active: false, hooked: new WeakSet(), nativeDescriptor: null,
        resetHistory: [], learnedInterval: 600, timer: null,
        init() {
            this.target = Math.max(1, Math.min(16, Number(getCourseHelperConfig().rate) || 6));
            try {
                this.nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate')
                    || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(document.createElement('video')), 'playbackRate');
            } catch (e) { this.nativeDescriptor = null; }
        },
        refresh() { this.target = Math.max(1, Math.min(16, Number(getCourseHelperConfig().rate) || 6)); },
        start() { this.init(); this.active = true; this.resetHistory = []; this.hookAll(); if (this.timer) clearTimeout(this.timer); this.scheduleNext(); },
        stop() { this.active = false; if (this.timer) { clearTimeout(this.timer); this.timer = null; } },
        get(v) { return this.nativeDescriptor && this.nativeDescriptor.get ? this.nativeDescriptor.get.call(v) : v.playbackRate; },
        set(v, r) { if (this.nativeDescriptor && this.nativeDescriptor.set) this.nativeDescriptor.set.call(v, r); else v.playbackRate = r; },
        hookAll() { document.querySelectorAll('video').forEach(v => this.hook(v)); },
        hook(v) {
            if (this.hooked.has(v)) return; this.hooked.add(v);
            const self = this;
            try {
                if (this.nativeDescriptor && this.nativeDescriptor.set) {
                    Object.defineProperty(v, 'playbackRate', {
                        get() { return self.nativeDescriptor.get.call(this); },
                        set(val) {
                            if (self.active && Math.abs(val - self.target) > 0.01) {
                                self.recordReset();
                                self.nativeDescriptor.set.call(this, val);
                                Promise.resolve().then(() => { try { self.nativeDescriptor.set.call(this, self.target); } catch (e) {} });
                            } else self.nativeDescriptor.set.call(this, val);
                        },
                        configurable: true, enumerable: true
                    });
                }
            } catch (e) {}
            v.addEventListener('ratechange', () => { if (!this.active) return; try { const cur = this.get(v); if (Math.abs(cur - this.target) > 0.01) { this.recordReset(); this.set(v, this.target); } } catch (e) {} });
        },
        recordReset() {
            this.resetHistory.push(Date.now()); if (this.resetHistory.length > 20) this.resetHistory.shift();
            if (this.resetHistory.length >= 3) {
                const intervals = []; for (let i = 1; i < this.resetHistory.length; i++) intervals.push(this.resetHistory[i] - this.resetHistory[i - 1]);
                intervals.sort((a, b) => a - b); const median = intervals[Math.floor(intervals.length / 2)];
                if (median > 100 && median < 30000) this.learnedInterval = Math.min(800, Math.max(200, median - 50));
            }
        },
        scheduleNext() { if (!this.active) return; this.timer = setTimeout(() => { this.enforce(); this.scheduleNext(); }, this.learnedInterval); },
        enforce() {
            if (!this.active) return;
            this.refresh(); this.hookAll();
            document.querySelectorAll('video').forEach((v, i) => {
                if (Math.abs(this.get(v) - this.target) > 0.01) {
                    this.set(v, this.target);
                    const speedBtn = document.querySelectorAll('.mejs__button.mejs__speed-button button')[i];
                    if (speedBtn && speedBtn.textContent !== this.target + 'x') speedBtn.textContent = this.target + 'x';
                }
            });
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
        if (node.querySelector('.blank-input')) return '填空题';
        if (node.querySelector('.cloze-input')) return '选词填空';
        if (node.querySelector('.answer-blank')) return '排序题';
        if (node.querySelector('.choice-btn.right-btn')) return '判断题';
        if (node.querySelector('.choice-list .choice-item')) {
            if (Number(answerLen) > 1 || /多选/.test(String(tag || ''))) return '多选题';
            return '单选题';
        }
        if (node.querySelector('.form-control')) return '简答题';
        return tag || '未知';
    }
    function pgApplyAnswer(node, type, answers) {
        if (!answers || !answers.length) return false;
        const w = node.querySelector('.question-wrapper') || node;
        if (type === '判断题') {
            const val = String(answers[0]).toLowerCase();
            const isTrue = val === 'true' || val === '正确' || val === '对' || val === '1' || val === 'a';
            const btn = w.querySelector(isTrue ? '.choice-btn.right-btn' : '.choice-btn.wrong-btn');
            if (btn) { pgTriggerMouseSequence(btn); return true; }
            return false;
        }
        if (type === '单选题' || type === '多选题') {
            const items = Array.from(w.querySelectorAll('.choice-list .choice-item'));
            const idxs = answers.map(a => { const m = String(a).toUpperCase().match(/[A-Z]/); return m ? m[0].charCodeAt(0) - 65 : -1; }).filter(i => i >= 0 && i < items.length);
            const target = type === '多选题' ? idxs : (idxs.length ? [idxs[0]] : []);
            if (!target.length) return false;
            target.forEach(i => { try { const cb = items[i].querySelector('.checkbox'); if (cb) cb.classList.add('selected'); } catch (e) {} pgTriggerMouseSequence(items[i]); });
            return true;
        }
        if (type === '填空题' || type === '选词填空') {
            const inputs = Array.from(w.querySelectorAll('.blank-input, .cloze-input, .answer-width input, .answer-width'));
            answers.forEach((a, i) => {
                const el = inputs[i]; if (!el) return;
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    el.value = a;
                    try { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
                } else { el.textContent = a; try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
            });
            return inputs.length > 0;
        }
        if (type === '简答题') {
            const inputs = Array.from(w.querySelectorAll('.form-control, textarea'));
            answers.forEach((a, i) => { if (inputs[i]) { inputs[i].value = a; try { inputs[i].dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} } });
            return inputs.length > 0;
        }
        if (type === '排序题') {
            const blanks = Array.from(w.querySelectorAll('.answer-blank'));
            answers.forEach((a, i) => { if (blanks[i]) { blanks[i].innerHTML = a; try { blanks[i].dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} } });
            return blanks.length > 0;
        }
        return false;
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
    let gPgPageChangeAt = Date.now();
    let gPgLastPageId = '';
    let gPgEpoch = 0;
    let gPgEndWarned = false;
    let gPgNextWarned = false;
    let gPgAnswerOffWarned = false;
    const gPgSkippedPages = new Map();     // 页面 key -> 跳过时间
    const gPgNoAnswerRounds = new Map();   // 页面 key -> 连续取不到答案的轮次

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
    function pgTouchPageDwell() {
        const pid = pgPageId();
        if (pid !== gPgLastPageId) {
            gPgLastPageId = pid; gPgPageChangeAt = Date.now();
            gPgEpoch++;                 // 页面已切换：作废上一页遗留的异步计划
            gPgQuestionUntil = 0;
            gPgEndWarned = false;
            gPgNextWarned = false;
            gPgNoAnswerRounds.delete(pid);
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
        if (!cfg.autoNext) {
            if (!gPgNextWarned) { gPgNextWarned = true; chLog('「自动翻页」已关闭：停留当前页，仅播放与答题。', 'muted'); }
            return false;
        }
        gPgNextWarned = false;
        if (now - gPgPageChangeAt < PG_PAGE_DWELL_MS) return false;
        if (now - gPgLastAdvanceAt < PG_ADVANCE_COOLDOWN_MS) return false;
        const pid = pgPageId();
        if (pid && pid === gPgAdvancePageId && now - gPgLastAdvanceAt < PG_SAME_PAGE_GUARD_MS) return false;
        let btn = document.querySelector('.next-page-btn.cursor');
        if (!btn) {
            const all = Array.from(document.querySelectorAll('.next-page-btn'));
            btn = all.find(b => !b.disabled && !b.classList.contains('disabled')) || null;
        }
        if (btn) { pgTriggerMouseSequence(btn); gPgLastAdvanceAt = now; gPgAdvancePageId = pid; return true; }
        const nextPage = pgNextCatalogPage();
        if (nextPage) {
            chLog('本专题已无「下一页」，从目录跳转到：' + (pgReText(nextPage.textContent) || '下一节'), 'info');
            pgTriggerMouseSequence(nextPage);
            gPgLastAdvanceAt = now; gPgAdvancePageId = pid;
            return true;
        }
        if (!gPgEndWarned) { gPgEndWarned = true; chLog('已是最后一页，未找到下一个未完成页面（' + (reason || '') + '）。', 'warn'); }
        return false;
    }
    function pgDismissModal() {
        const modal = document.querySelector('.modal.fade.in');
        if (!modal || !pgVisible(modal)) return false;
        const id = modal.id;
        if (id === 'statModal') { const b = modal.querySelectorAll('.btn-hollow'); if (b.length) b[b.length - 1].click(); return true; }
        if (id === 'alertModal') { const h = modal.querySelectorAll('.btn-hollow'); (h.length ? h[h.length - 1] : modal.querySelector('.btn-submit'))?.click(); return true; }
        return false;
    }

    /* ---------------- 视频卡死 / 加载失败检测与分级恢复 ---------------- */
    const pgVideoStates = new WeakMap();
    function pgVideoState(v) {
        let s = pgVideoStates.get(v);
        if (!s) { s = { ct: -1, progressAt: Date.now(), attempts: 0, lastActAt: 0, reloads: 0 }; pgVideoStates.set(v, s); }
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
        if (Math.abs(ct - s.ct) > 0.25) { s.ct = ct; s.progressAt = now; s.attempts = 0; return; }   // 有进度，健康
        let dur = 0; try { dur = Number(v.duration) || 0; } catch (e) {}
        if (dur > 0 && ct >= dur - 0.3) { s.progressAt = now; s.attempts = 0; return; }             // 已播完
        if (v.seeking) { s.progressAt = now; return; }
        const stallFor = now - s.progressAt;
        const broken = pgVideoBroken(v) || ((typeof v.readyState === 'number' && v.readyState === 0) && stallFor > 8000);
        if (!broken && stallFor < PG_STALL_MS) return;
        if (now - s.lastActAt < 5000) return;                       // 恢复动作节流，避免抖动
        s.lastActAt = now; s.attempts++;
        const why = broken ? '媒体加载失败 / 无可用源' : ('播放停滞 ' + Math.round(stallFor / 1000) + 's');
        chLog('视频异常（' + why + '），执行第 ' + s.attempts + ' 次恢复…', 'warn');
        try {
            const rate = pgRateGuard.target;
            if (s.attempts === 1) {
                v.muted = true;
                try { if (Math.abs(pgRateGuard.get(v) - rate) > 0.01) pgRateGuard.set(v, rate); } catch (e) {}
                const p = v.play(); if (p && p.catch) p.catch(() => {});
                try { v.currentTime = ct + 0.5; } catch (e) {}
            } else if (s.attempts === 2) {
                const idx = Array.from(document.querySelectorAll('video')).indexOf(v);
                const playBtn = document.querySelectorAll('.mejs__button.mejs__playpause-button button')[idx];
                if (playBtn) pgTriggerMouseSequence(playBtn);
                else { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
            } else if (s.attempts === 3) {
                try { v.load(); } catch (e) {}
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

    /* ---------------- 自动答题（异步、幂等、取不到答案不提交） ---------------- */
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
        gPgQuestionUntil = Date.now() + 8000;     // 答题期间不再重复进入
        let total = 0, answered = 0, pending = 0;
        try {
            const nodes = Array.from(document.querySelectorAll('.question-element-node'));
            if (cfg.collectBank) pgCollectBank();
            for (const node of nodes) {
                if (epoch !== gPgEpoch) return;                        // 页面已切换：丢弃本页剩余计划
                const w = node.querySelector('.question-wrapper');
                if (!w || w.classList.contains('finished')) continue;
                const lastSubmit = Number((w.dataset && w.dataset.dgutSubmittedAt) || 0);
                if (lastSubmit && Date.now() - lastSubmit < 20000) continue;   // 已提交过：避免重复计划提交
                total++;
                const tag = pgReText((w.querySelector('.question-type-tag') || {}).textContent || '');
                let answers = pgVmAnswer(node) || pgBankAnswer(node);
                if (!answers) answers = await pgRemoteAnswer(node);     // 真异步等待，不再"同步取异步"
                if (epoch !== gPgEpoch) return;
                if (!answers || !answers.length) { pending++; continue; }   // 取不到答案：绝不提交
                const type = pgResolveType(w, tag, answers.length);
                if (!pgApplyAnswer(w, type, answers)) { pending++; continue; }
                await pgSleep(180);
                if (epoch !== gPgEpoch) return;
                pgSubmitQuestion(node);                                 // 只有确认已填答案才提交
                try { w.dataset.dgutSubmittedAt = String(Date.now()); } catch (e) {}
                if (cfg.collectBank) pgRememberAnswer(node, answers);
                answered++;
                await pgSleep(120);
            }
            if (epoch !== gPgEpoch) return;
            if (total > 0 && answered > 0 && pending === 0) {
                const gb = document.querySelector('.question-operation-area button');
                if (gb && pgReText(gb.textContent) !== '重做') { pgTriggerMouseSequence(gb); await pgSleep(300); }
            }
            if (pending > 0) {
                const key = pgPageId();
                const rounds = (gPgNoAnswerRounds.get(key) || 0) + 1;
                gPgNoAnswerRounds.set(key, rounds);
                chLog(`有 ${pending}/${total} 题未取到答案，已跳过提交（第 ${rounds}/${PG_MAX_NO_ANSWER_ROUNDS} 轮重试）。`, 'warn');
                if (rounds >= PG_MAX_NO_ANSWER_ROUNDS) {
                    gPgSkippedPages.set(key, Date.now());
                    chLog('本轮仍未取到答案：为不空交，本页不提交；已记录该页并继续后续页面。', 'warn');
                    gPgNoAnswerRounds.set(key, 0);
                    gPgQuestionUntil = Date.now() + 2500;
                    await pgSleep(500);
                    if (epoch !== gPgEpoch) return;
                    pgClickNext('跳过无法作答的页面');
                    return;
                }
                gPgQuestionUntil = Date.now() + 2600;
                return;                                                // 未取到答案：不翻页，稍后重试
            }
            gPgNoAnswerRounds.delete(pgPageId());
            gPgQuestionUntil = Date.now() + 1500;
            await pgSleep(600);
            if (epoch !== gPgEpoch) return;
            pgClickNext('答题完成');
        } finally { gPgAnswering = false; }
    }

    function pgLogic() {
        if (!gCourseHelper || !gCourseHelper.running) return;
        if (pgDismissModal()) return;
        pgTouchPageDwell();
        if (document.querySelector('.question-setting-panel')) {
            if (Date.now() < gPgQuestionUntil) { chUpdateStatus(); return; }
            pgAnswerAll();
            return;
        }
        const videos = Array.from(document.querySelectorAll('video'));
        if (videos.length) {
            gPgMediaWaitSince = 0;
            let i = 0;
            for (; i < videos.length; i++) {
                const v = videos[i];
                if (pgVideoFinished(v)) continue;
                pgRateGuard.hook(v);
                pgRateGuard.refresh();
                const rate = pgRateGuard.target;
                if (Math.abs(pgRateGuard.get(v) - rate) > 0.01) pgRateGuard.set(v, rate);
                const speedBtn = document.querySelectorAll('.mejs__button.mejs__speed-button button')[i];
                if (speedBtn && speedBtn.textContent !== rate + 'x') speedBtn.textContent = rate + 'x';
                pgVideoWatchdog(v);                       // 卡死检测
                if (v.paused) {
                    v.muted = true;
                    v.play().catch(() => {
                        const playBtn = document.querySelectorAll('.mejs__button.mejs__playpause-button button')[i];
                        if (playBtn) playBtn.click();
                    });
                }
                break;
            }
            if (i === videos.length) pgClickNext('视频已全部完成');
            else chUpdateStatus();
            return;
        }
        if (pgHasMediaContainer()) {
            if (!gPgMediaWaitSince) gPgMediaWaitSince = Date.now();
            chUpdateStatus();
            if (Date.now() - gPgMediaWaitSince < 10000) return;
        }
        gPgMediaWaitSince = 0;
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
            showToastCard('⚠ 未检测到课件元素', ifr.isTop ? '本帧未找到 video / 课件视图模型，刷课助手启动后会空转。' : '当前在 iframe 中，请到顶层页面打开面板。', '', 10000);
        }
        gPgEpoch++;
        gPgSkippedPages.clear();
        gPgNoAnswerRounds.clear();
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
                ${onPage ? '✓ 当前已在课件页，可直接启动。' : '当前不在课件页。请先在优学院打开具体课件（地址含 <b>ua.dgut.edu.cn/learnCourse</b>），再回到此处启动。'}
                ${(!ifr.isTop) ? '<br><span style="color:var(--dgut-error);">⚠ 当前运行在 iframe 中，刷课逻辑只在顶层查找 video/视图模型，可能空转。</span>' : ''}
            </div>
            <div class="dgut-card">
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label">视频倍速 <input type="number" id="dgut-ch-rate" class="dgut-input" value="${cfg.rate}" min="1" max="16" step="0.5" style="width:60px;padding:4px 6px;"></label>
                </div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label"><input type="checkbox" id="dgut-ch-answer" ${cfg.autoAnswer ? 'checked' : ''}> 自动答题（答案源：视图模型/题库/接口）</label>
                    <label class="dgut-label"><input type="checkbox" id="dgut-ch-next" ${cfg.autoNext ? 'checked' : ''}> 自动翻页</label>
                    <label class="dgut-label"><input type="checkbox" id="dgut-ch-bank" ${cfg.collectBank ? 'checked' : ''}> 收集题库</label>
                </div>
                <div class="dgut-hint" style="margin-bottom:10px;">取不到答案时<b>不会提交</b>，会重试 <b>${PG_MAX_NO_ANSWER_ROUNDS}</b> 轮；视频停滞超过 <b>${Math.round(PG_STALL_MS / 1000)}s</b> 会自动尝试恢复。</div>
                <div id="dgut-ch-status" style="font-size:12px;margin-bottom:10px;color:var(--dgut-on-surface-variant);"></div>
                <div class="dgut-row dgut-row--end">
                    <button id="dgut-ch-save" class="dgut-btn">${icons.settings} 保存设置</button>
                    <button id="dgut-ch-start" class="dgut-btn dgut-btn-primary">${icons.course} 启动</button>
                    <button id="dgut-ch-stop" class="dgut-btn">停止</button>
                    <button id="dgut-ch-export" class="dgut-btn">${icons.export} 导出题库</button>
                    <button id="dgut-ch-clear" class="dgut-btn">清空题库</button>
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
                    if (res.status === 401 || res.status === 403) return reject(new Error(errFull(ERR.SIGN_AUTH_FAIL, 'HTTP ' + res.status)));
                    try { resolve(JSON.parse(res.responseText)); } catch (e) { reject(new Error(errFull(ERR.PEER_PARSE_FAIL))); }
                },
                onerror: () => reject(new Error(errFull(ERR.PEER_NET_FAIL))),
                ontimeout: () => reject(new Error(errFull(ERR.SIGN_TIMEOUT)))
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
    let gRead = null;
    function rdCfg() { const c = GM_getValue(READ_CFG_KEY, {}) || {}; const s = parseInt(c.readerSec, 10); return { readerSec: s > 0 ? s : 30, autoStart: c.readerAutoStart !== false }; }
    function rdSaveCfg(patch) { GM_setValue(READ_CFG_KEY, Object.assign({ readerSec: 30, readerAutoStart: true }, GM_getValue(READ_CFG_KEY, {}), patch)); }
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
        if (gRead.total < READ_MIN_SEC) { btns[0].click(); gRead.pageStart = Date.now(); }
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
        if (key !== gRead.bookKey) { rdSetBookTime(gRead.bookKey, gRead.total); gRead.bookKey = key; gRead.accumulated = rdBookTime(key); gRead.sessionStart = Date.now(); gRead.lastSave = gRead.accumulated; }
        if (vm && vm.currentPage) {
            const list = rdFlatList(vm);
            const pid = rdPageId(vm.currentPage());
            if (pid && pid !== gRead.curPageId) { gRead.curPageId = pid; gRead.pageStart = Date.now(); }
            if (gRead.total >= READ_MIN_SEC) {
                if (gRead.curPageId && Date.now() - gRead.pageStart >= READ_NAV_SEC * 1000) {
                    try { if (typeof vm.goNextPage === 'function') vm.goNextPage(); } catch (e) {}
                    gRead.pageStart = Date.now();
                    const idx = rdFindIndex(list, gRead.curPageId);
                    if (idx >= list.length - 1) { const res = rdAdvanceSection(vm, gRead.curPageId); if (!res.ok && res.atEnd) { rdStop(); showToastCard(`${KAO.ok} 求是读书`, '全部书目已读完', '', 8000); } }
                }
            }
        }
        if (!gRead) return;
        gRead.total = gRead.accumulated + Math.floor((Date.now() - gRead.sessionStart) / 1000);
        if (gRead.total - gRead.lastSave >= READ_SAVE_INTERVAL) { rdSetBookTime(gRead.bookKey, gRead.total); gRead.lastSave = gRead.total; }
        const tEl = document.getElementById('dgut-rd-timer');
        if (tEl) tEl.textContent = rdFmt(gRead.total);
        const sEl = document.getElementById('dgut-rd-server');
        if (sEl) { const st = rdServerTimes(); sEl.textContent = st && st[gRead.bookKey] ? '服务端: ' + rdFmt(st[gRead.bookKey]) : (st ? '服务端: 暂无记录' : '服务端: 获取失败'); }
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
        gRead = { running: true, timer: null, bookKey: key, accumulated: rdBookTime(key), sessionStart: Date.now(), lastSave: rdBookTime(key), total: rdBookTime(key), curPageId: null, pageStart: Date.now() };
        if (vm.currentPage) gRead.curPageId = rdPageId(vm.currentPage());
        gRead.timer = setInterval(rdTick, 1000);
        rdSaveCfg({ readerAutoStart: true });
        rdSyncReader();
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
        showStatus('求是读书：已暂停');
    }
    function renderReadView(ac) {
        const cfg = rdCfg();
        const vm = rdVm();
        const onPage = /\/learnCourse\//i.test(location.href) || (vm && vm.currentPage);
        const hasVm = !!vm;
        ac.innerHTML = actionHeader(ACTION_TITLES.read, '课件阅读时长统计与自动翻页') + `
            <div class="dgut-hint ${onPage ? 'dgut-hint--success' : 'dgut-hint--warn'}">
                ${onPage ? '? 当前在课件页，可开始求是阅读。' : '请先在优学院打开求是读书课件页（地址含 <b>ua.dgut.edu.cn/learnCourse/learnCourse.html</b>）。'}
                ${!hasVm ? '<br><span style="color:var(--dgut-error);">? 未检测到 koLearnCourseViewModel，启动后会空转。</span>' : ''}
            </div>
            <div class="dgut-card">
                <div style="text-align:center;font-size:30px;font-weight:700;color:var(--dgut-primary);font-family:Consolas,monospace;" id="dgut-rd-timer">${rdFmt(rdBookTime(rdBookKey()))}</div>
                <div style="text-align:center;font-size:12px;color:var(--dgut-on-surface-variant);margin:4px 0 12px;" id="dgut-rd-server">服务端: --</div>
                <div class="dgut-row dgut-row--mb">
                    <label class="dgut-label">翻页间隔 <input type="number" id="dgut-rd-sec" class="dgut-input" value="${cfg.readerSec}" min="1" style="width:64px;padding:4px 6px;"> 秒/页</label>
                    <span style="color:var(--dgut-on-surface-variant);font-size:12px;">目标 4h10m 后自动切书</span>
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
            const key = rdBookKey(); const st = rdServerTimes();
            if (st && st[key] && st[key] > rdBookTime(key)) { rdSetBookTime(key, st[key]); showStatus('已同步服务端时长'); }
            else showStatus('服务端无更新');
        };
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
function blackwhite(data, width, height, threshold) {
    const t = Math.max(0, Math.min(255, Number(threshold) || 128));
    const out = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const v = lum >= t ? 255 : 0;
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
        if (params.bw)      data = blackwhite(data, width, height, params.bwThreshold);
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
                    bw: cfg.bw, bwThreshold: cfg.bwThreshold,
                    eq: cfg.eq
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
        if (cfg.bw) d = imgApplyBlackWhite(d, cfg.bwThreshold);
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
    function imgApplyBlackWhite(imageData, threshold = 128) {
        const t = Math.max(0, Math.min(255, Number(threshold) || 128));
        const { width, height, data } = imageData;
        const out = new Uint8ClampedArray(data.length);
        for (let i = 0; i < data.length; i += 4) {
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const v = lum >= t ? 255 : 0;
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
            sharpen: false, sharpenAmount: 1, bw: false, bwThreshold: 128, eq: false, smooth: 'high'
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
            bwThreshold: num('#dgut-img-bw-thresh', 128),
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
        if (cfg.targetSizeKB > 0) {
            targetBytes = cfg.targetSizeKB * 1024;
            const r = await imgCompressToTargetSize(canvas, targetBytes, mime, cfg.allowResize, cfg.smooth);
            blob = r.blob; achieved = r.achieved;
        } else {
            blob = await imgCanvasToBlob(canvas, mime, cfg.quality);
        }
        if (!blob) throw new Error(errFull(ERR.IMG_ENCODE_FAIL));
        let inflated = false;
        if (cfg.inflateKB > 0 && blob.size < cfg.inflateKB * 1024) {
            blob = await imgInflateToSize(blob, cfg.inflateKB * 1024, cfg.inflateMode);
            inflated = true;
        }
        return { canvas, blob, mime, inflated, achieved, targetBytes };
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
        ac.innerHTML = actionHeader(ACTION_TITLES.imagetool, '缩放 · 压缩到指定大小 · 增大文件 · 高质量平滑 / 锐化 / 黑白 / 亮度均匀（像素处理多线程）') + `
            <div class="dgut-hint">
                <b>说明</b><br>
                · 所有处理均在浏览器本地完成，图片不上传服务器。<br>
                · <b>像素滤镜（锐化/黑白/亮度均匀）默认在 Web Worker 中执行</b>，不阻塞主线程；不可用时自动回退主线程。<br>
                · <b>平滑</b>除极限情况下建议保持「高质量」。<br>
                · 压缩：填了「目标大小」时，脚本自动调节质量逼近该大小；未填时，使用「输出质量」。<br>
                · 目标大小过小时，默认不降低分辨率；勾选「允许降低分辨率」可进一步压缩。<br>
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
                    <label class="dgut-label"><input type="checkbox" id="dgut-img-bw" ${saved.bw ? 'checked' : ''}> 黑白</label>
                    <label class="dgut-label">阈值
                        <input type="number" id="dgut-img-bw-thresh" class="dgut-input" value="${saved.bwThreshold}" min="0" max="255" style="width:60px;padding:4px 6px;">
                    </label>
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
                const { canvas, blob, inflated, achieved, targetBytes } = await imgRunPipeline(ac);
                canvasEl.width = canvas.width; canvasEl.height = canvas.height;
                const c = canvasEl.getContext('2d');
                c.clearRect(0, 0, canvas.width, canvas.height);
                c.drawImage(canvas, 0, 0);
                let msg;
                if (targetBytes > 0 && !achieved) {
                    msg = `? 已用最低质量，无法压缩到目标大小 ${imgFmtSize(targetBytes)} · 实际 ${imgFmtSize(blob.size)}。如需更小请勾选"允许降低分辨率"。`;
                } else if (inflated) {
                    msg = `? 输出尺寸 ${canvas.width} × ${canvas.height} px · ${imgFmtSize(blob.size)}（已填充至目标大小）`;
                } else {
                    msg = `? 输出尺寸 ${canvas.width} × ${canvas.height} px · ${imgFmtSize(blob.size)}`;
                }
                setStatus(msg);
﻿                return { canvas, blob };
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
                setStatus(`✓ 已下载 ${fname} · ${imgFmtSize(r.blob.size)}`);
            } catch (e) { setStatus('下载失败：' + e.message, true); }
        };
    }

    /* ============================================================
     * 视图路由
     * ============================================================ */
    let gActionName = null;
    const ACTION_TITLES = {
        sign: '优学院课程签到',
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
        const mode = name || GM_getValue(VIEW_MODE_KEY, 'sign');
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
        switch (name) {
            case 'sign': renderSignView(ac); break;
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
                        <a class="dgut-gh-stat dgut-gh-stat--star" href="${escapeHtml(r.html_url)}/stargazers" target="_blank" rel="noopener noreferrer" title="去 GitHub 点个 Star ⭐">${GH_ICONS.star}<span>${ghFmtNum(r.stars)}</span><span class="dgut-gh-stat-label">Stars</span></a>
                        <a class="dgut-gh-stat" href="${escapeHtml(r.html_url)}/forks" target="_blank" rel="noopener noreferrer" title="Fork 数">${GH_ICONS.fork}<span>${ghFmtNum(r.forks)}</span><span class="dgut-gh-stat-label">Forks</span></a>
                        <a class="dgut-gh-stat" href="${escapeHtml(r.html_url)}/watchers" target="_blank" rel="noopener noreferrer" title="Watch 数">${GH_ICONS.eye}<span>${ghFmtNum(r.watchers)}</span><span class="dgut-gh-stat-label">Watch</span></a>
                    </span>
                </div>
                ${r.description ? '<div class="dgut-gh-desc">' + escapeHtml(r.description) + '</div>' : ''}
                <div class="dgut-gh-people">
                    <div class="dgut-gh-people-title">${GH_ICONS.person} 作者</div>
                    <div class="dgut-gh-avatars">
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
                ${result.warn ? '<div class="dgut-gh-warnline">⚠ ' + escapeHtml(result.warn) + '（当前展示过期缓存数据）</div>' : ''}
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
    const ABOUT_VERSION = 'v5.7.0';
    const GITHUB_URL = 'https://github.com/BrocadeHutHost/DGUT-ULearningTakeQuizzesAssistant';

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
                </div>
                <div class="dgut-card">
                    <div class="dgut-section-title">功能一览</div>
                    <div style="font-size:13px;line-height:2;">
                        · <b>课程签到</b>：轮询当日课堂，自动处理数字码 / 一键签到；userid 多源解析带置信度<br>
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
        };

        const renderErrors = () => {
            const sc = window.__dgutSelfCheckResults || [];
            const scRows = sc.length ? sc.map(r => `
                <div class="dgut-err-row">
                    <span class="dgut-err-code" style="color:${r.ok ? 'var(--dgut-success)' : 'var(--dgut-error)'};">${r.ok ? '✓' : 'E' + r.errDef.code}</span>
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
                    · <b>M（千位）</b> 模块：1=签到 2=刷课 3=互评 4=读书 5=文档 6=Word转PDF 7=图片 8=通用/框架<br>
                    · <b>T（百位）</b> 类型：0=未知 1=请求 2=处理 3=认证 4=依赖缺失 5=参数 6=用户操作<br>
                    · <b>NN（十/个位）</b> 具体编号
                </div>
                <div class="dgut-card">
                    <div class="dgut-section-title">本次自检（同步阶段）</div>
                    <div style="background:var(--dgut-surface-2);border:1px solid var(--dgut-outline-variant);border-radius:10px;overflow:hidden;">${scRows}</div>
                    <div style="font-size:11px;color:var(--dgut-on-surface-variant);margin-top:8px;">异步阶段（Token 与 userid）会输出到控制台。可打开 F12 查看。</div>
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
                    <button class="dgut-nav" data-action="sign">${icons.sign} 课程签到</button>
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
        const mode = GM_getValue(VIEW_MODE_KEY, 'sign');
        gActionName = mode;
        panel.querySelectorAll('.dgut-nav').forEach(x => x.classList.toggle('dgut-tab-active', x.dataset.action === mode));
        renderActionView(mode);
    }

    const MINI_ICON_SVG = `<svg viewBox="0 0 24 24" width="44" height="44" fill="none">
        <circle class="mini-ring" cx="12" cy="12" r="9" stroke-width="1.8" fill="none"/>
        <path class="mini-check" d="M7 12.5l3.2 3.2L17 9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`;

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
        mini.innerHTML = MINI_ICON_SVG;
        document.body.appendChild(mini);
        let drag = null, moved = false;
        mini.addEventListener('mousedown', (e) => {
            const rect = mini.getBoundingClientRect();
            drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, ox: rect.left, oy: rect.top };
            moved = false;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!drag) return;
            const nx = e.clientX - drag.dx, ny = e.clientY - drag.dy;
            if (Math.abs(nx - drag.ox) > 4 || Math.abs(ny - drag.oy) > 4) moved = true;
            mini.style.right = 'auto'; mini.style.bottom = 'auto';
            mini.style.left = Math.max(0, Math.min(window.innerWidth - 80, nx)) + 'px';
            mini.style.top = Math.max(0, Math.min(window.innerHeight - 80, ny)) + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (!drag) return;
            drag = null;
            if (moved) {
                const rect = mini.getBoundingClientRect();
                GM_setValue(FAB_POS_KEY, { left: rect.left, top: rect.top });
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
        GM_registerMenuCommand('优学院课程签到', () => openActionView('sign'));
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
