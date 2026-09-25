// ==UserScript==
// @name         优学院助手 + 文档工具（签到/刷课/互评/读书 + MD转Word·PDF + 电子签名）
// @namespace    https://github.com/BrocadeHutHost
// @version      5.0.1
// @description  优学院课程签到监测 + 刷课助手(倍速守卫/自动答题/题库) + 作业互评面板 + 求是读书 + 外观设置(主题/主体色) + Markdown 转 Word/PDF + 手绘电子签名。
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
// @connect      lms.dgut.edu.cn
// @connect      application.dgut.edu.cn
// @connect      courseapi.ulearning.cn
// @connect      ua.dgut.edu.cn
// @connect      api.ulearning.cn
// @connect      *.ulearning.cn
// @connect      *.dgut.edu.cn
// @license      AGPL-3.0-only
// ==/UserScript==

(function () {
    'use strict';

    /* ==================== 常量与全局状态 ==================== */
    const API_HOST = 'https://lms.dgut.edu.cn';
    const TAG = '[优学院助手]';
    const UI_POS_KEY = 'dgut_ui_positions';
    const FAB_POS_KEY = 'dgut_fab_pos';
    const PANEL_OPEN_KEY = 'dgut_panel_open_state';
    const VIEW_MODE_KEY = 'dgut_view_mode';
    const THEME_MODE_KEY = 'dgut_theme_mode';
    const ACCENT_KEY = 'dgut_theme_accent';
    const MANUAL_TOKEN_KEY = 'dgut_manual_token';
    // 优学院课程签到
    const SIGN_CONFIG_KEY = 'dgut_sign_config';
    const SIGN_LOG_KEY = 'dgut_sign_log';
    const SIGN_USERID_KEY = 'dgut_sign_userid';
    // 刷课（自动学习与题库助手）/ 互评 / 求是读书
    const COURSE_HELPER_KEY = 'dgut_course_helper_config';
    const BANK_KEY = 'dgut_quiz_bank';
    const PEER_KEY = 'dgut_peer_review_records';
    const READ_CFG_KEY = 'dgut_single_file_helper_config';
    const READ_RECORDS_KEY = 'dgut_reading_records';
    // 文档工具
    const DOC_DRAFT_KEY = 'dgut_doc_md_draft';
    const DOC_TITLE_KEY = 'dgut_doc_md_title';
    const DOC_SIGN_KEY  = 'dgut_doc_signatures';
    const DEBUG = true;

    /* ==================== 求是读书 子框架引导 ====================
       阅读器运行在子框架中，父窗口负责时长统计与调度；
       子框架只接收父窗口的 postMessage 并自动翻页（与主面板逻辑隔离）。 */
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

    // 页面（宿主）window：用于访问优学院 Knockout 视图模型 koLearnCourseViewModel
    const PAGE_WIN = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    const log = (...a) => { if (DEBUG) console.log(TAG, ...a); };
    if (typeof marked !== 'undefined') marked.setOptions({ breaks: true, gfm: true });

    /* ==================== 模块 0: 全局主题（亮/暗/跟随系统 + 主体色） ==================== */
    const ACCENTS = {
        purple: { name: '紫罗兰', primary: '#6750A4', container: '#E8DEF8', onContainer: '#21005D', dPrimary: '#D0BCFF', dContainer: '#4F378B', dOnContainer: '#EADDFF' },
        blue: { name: '蔚蓝', primary: '#0061A4', container: '#D1E4FF', onContainer: '#001D36', dPrimary: '#9ECAFF', dContainer: '#00497D', dOnContainer: '#D1E4FF' },
        teal: { name: '松石', primary: '#006874', container: '#97F0FF', onContainer: '#001F24', dPrimary: '#4FD8EB', dContainer: '#004F59', dOnContainer: '#97F0FF' },
        green: { name: '青绿', primary: '#00696D', container: '#CCE8E7', onContainer: '#002020', dPrimary: '#80D5D4', dContainer: '#004F51', dOnContainer: '#CCE8E7' },
        orange: { name: '琥珀', primary: '#8B5000', container: '#FFDDB8', onContainer: '#2D1600', dPrimary: '#FFB870', dContainer: '#6A3C00', dOnContainer: '#FFDDB8' },
        red: { name: '玫红', primary: '#A03253', container: '#FFD9E1', onContainer: '#3E001D', dPrimary: '#FFB1C6', dContainer: '#7D2948', dOnContainer: '#FFD9E1' }
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
            container: `color-mix(in srgb, ${hex} 18%, #ffffff)`, onContainer: '#21005D',
            dPrimary: hex, dContainer: `color-mix(in srgb, ${hex} 30%, #141218)`, dOnContainer: '#EADDFF'
        };
    }
    function themeTokens() {
        const dark = resolvedThemeMode() === 'dark';
        const a = accentOf(GM_getValue(ACCENT_KEY, 'purple'));
        const base = dark ? {
            surface: '#141218', surface2: '#211F26', onSurface: '#E6E0E9', onSurfaceVariant: '#CAC4D0',
            outline: '#938F99', outlineVariant: '#49454E', secondary: '#4A4458', onSecondary: '#E8DEF8',
            error: '#F2B8B5', success: '#A5D6A7', onPrimary: '#381E72'
        } : {
            surface: '#FEF7FF', surface2: '#F7F2FA', onSurface: '#1D1B20', onSurfaceVariant: '#49454E',
            outline: '#CAC4D0', outlineVariant: '#E7E0EC', secondary: '#F3EDF7', onSecondary: '#1D192B',
            error: '#B3261E', success: '#2E7D32', onPrimary: '#FFFFFF'
        };
        return Object.assign(base, {
            primary: dark ? a.dPrimary : a.primary,
            container: dark ? a.dContainer : a.container,
            onContainer: dark ? a.dOnContainer : a.onContainer
        });
    }
    function applyTheme() {
        const dark = resolvedThemeMode() === 'dark';
        const t = themeTokens();
        document.documentElement.classList.toggle('dgut-theme-dark', dark);
        let style = document.getElementById('dgut-theme-style');
        if (!style) { style = document.createElement('style'); style.id = 'dgut-theme-style'; document.head.appendChild(style); }
        const darkOverrides = dark ? `
            #dgut-main-panel, #dgut-mini-panel { color-scheme: dark; }
            #dgut-main-panel select option { background:${t.surface2}; color:${t.onSurface}; }
            #dgut-main-panel [style*="background:#fff"],
            #dgut-main-panel [style*="background:#FFF"],
            #dgut-main-panel [style*="background:#FEF7FF"],
            #dgut-main-panel [style*="background:#F7F2FA"],
            #dgut-main-panel [style*="background:#F6F1FB"],
            #dgut-main-panel [style*="background:#F3EDF7"]{background:${t.surface2} !important;}
            #dgut-main-panel [style*="background:#E7E0EC"]{background:${t.outlineVariant} !important;}
            #dgut-main-panel [style*="background:#E8DEF8"]{background:${t.container} !important;}
            #dgut-main-panel [style*="background:#FFEBEE"]{background:#5C1A16 !important;}
            #dgut-main-panel [style*="background:#E8F5E9"]{background:#1B3A1D !important;}
            #dgut-main-panel [style*="background:#FFF3E0"]{background:#3A2E16 !important;}
            #dgut-main-panel [style*="background:#FBEAF9"]{background:#3A2A38 !important;}
            #dgut-main-panel [style*="color:#1D1B20"]:not([style*="linear-gradient"]){color:${t.onSurface} !important;}
            #dgut-main-panel [style*="color:#49454E"]:not([style*="linear-gradient"]){color:${t.onSurfaceVariant} !important;}
            #dgut-main-panel [style*="color:#79747E"]:not([style*="linear-gradient"]){color:${t.outline} !important;}
            #dgut-main-panel [style*="color:#6750A4"]:not([style*="linear-gradient"]){color:${t.primary} !important;}
            #dgut-main-panel [style*="color:#721C24"]:not([style*="linear-gradient"]){color:#F2B8B5 !important;}
            #dgut-main-panel [style*="color:#2E7D32"]:not([style*="linear-gradient"]){color:#A5D6A7 !important;}
            #dgut-main-panel [style*="color:#B3261E"]:not([style*="linear-gradient"]){color:#F2B8B5 !important;}
            #dgut-main-panel [style*="border:1px solid #E7E0EC"]:not([style*="linear-gradient"]){border-color:${t.outlineVariant} !important;}
            #dgut-main-panel [style*="border:1px solid #CAC4D0"]:not([style*="linear-gradient"]){border-color:${t.outline} !important;}
            #dgut-main-panel input, #dgut-main-panel select, #dgut-main-panel textarea { color:${t.onSurface}; }
            #dgut-main-panel input::placeholder, #dgut-main-panel textarea::placeholder { color:${t.outline}; }
            #dgut-mini-panel { background:${t.surface2} !important; border-color:${t.primary} !important; }
        ` : '';
        style.textContent = `
            #dgut-main-panel, #dgut-mini-panel {
                --dgut-primary:${t.primary};--dgut-on-primary:${t.onPrimary};
                --dgut-primary-container:${t.container};--dgut-on-primary-container:${t.onContainer};
                --dgut-secondary-container:${t.secondary};--dgut-on-secondary-container:${t.onSecondary};
                --dgut-surface:${t.surface};--dgut-surface-2:${t.surface2};
                --dgut-on-surface:${t.onSurface};--dgut-on-surface-variant:${t.onSurfaceVariant};
                --dgut-outline:${t.outline};--dgut-outline-variant:${t.outlineVariant};
                --dgut-error:${t.error};--dgut-success:${t.success};
            }
            ${darkOverrides}
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

    /* ==================== 通用工具 ==================== */
    const KAO = { ok: '(｡•̀ᴗ-)✧', zen: '(－‿－)', sweat: '(；´д｀)' };

    function escapeHtml(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function dateKey(d = new Date()) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function formatDate(date) {
        const d = new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    function showStatus(msg, isError = false) {
        const el = document.getElementById('dgut-status-bar');
        if (!el) return;
        el.textContent = msg;
        el.style.color = isError ? '#B3261E' : '#49454E';
        el.style.background = isError ? '#FFEBEE' : '#F3EDF7';
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
            if (el) {
                el.textContent = msg;
                el.style.color = '#49454E';
                el.style.background = '#F3EDF7';
                el.style.display = 'block';
            }
        };
        tick();
        gStatusTicker = setInterval(tick, 1000);
    }
    function stopStatusTicker() {
        if (gStatusTicker) { clearInterval(gStatusTicker); gStatusTicker = null; }
    }

    const icons = {
        list: `<svg viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 8h14v-2H7v-2zM7 7v2h14V7H7z"/></svg>`,
        refresh: `<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
        export: `<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
        upload: `<svg viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>`,
        settings: `<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
        close: `<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
        left: `<svg viewBox="0 0 24 24"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`,
        add: `<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>`,
        sign: `<svg viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
        course: `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`,
        peer: `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>`,
        read: `<svg viewBox="0 0 24 24"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 18H6V4h2v8l2.5-1.5L13 12V4h5v16z"/></svg>`,
        theme: `<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>`,
        doc: `<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`,
        sign2: `<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`
    };

    GM_addStyle(`
        @keyframes dgutPulse {0%,100%{filter:brightness(1)}50%{filter:brightness(1.15)}}
        @keyframes dgutDown {from{transform:translate(-50%,-120%);opacity:0}to{transform:translate(-50%,0);opacity:1}}
        @keyframes dgutShrinkX {from{transform:scaleX(1)}to{transform:scaleX(0)}}

        #dgut-main-panel, #dgut-mini-panel {
            --dgut-primary: #6750A4; --dgut-on-primary: #fff;
            --dgut-primary-container: #E8DEF8; --dgut-on-primary-container: #21005D;
            --dgut-secondary-container: #F3EDF7; --dgut-on-secondary-container: #1D192B;
            --dgut-surface: #FEF7FF; --dgut-surface-2: #F7F2FA;
            --dgut-on-surface: #1D1B20; --dgut-on-surface-variant: #49454E;
            --dgut-outline: #CAC4D0; --dgut-outline-variant: #E7E0EC;
            --dgut-error: #B3261E; --dgut-success: #2E7D32;
            --dgut-font: "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .dgut-nav {
            display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;
            padding: 9px 10px; border: none; border-radius: 10px; background: transparent;
            font-size: 12px; font-weight: 500; color: var(--dgut-on-surface-variant);
            cursor: pointer; user-select: none; text-align: left; white-space: nowrap;
            transition: background .15s, color .15s;
        }
        .dgut-nav svg { width: 16px; height: 16px; fill: currentColor; flex: none; }
        .dgut-nav:hover { background: var(--dgut-primary-container); color: var(--dgut-on-primary-container); }
        .dgut-nav.dgut-tab-active { background: var(--dgut-primary-container); color: var(--dgut-primary); font-weight: 700; }
        .dgut-nav-label {
            font-size: 10px; font-weight: 700; color: var(--dgut-outline,#CAC4D0);
            letter-spacing: .6px; padding: 12px 10px 4px; user-select: none;
        }
        .dgut-btn {
            display: inline-flex; align-items: center; justify-content: center; gap: 5px;
            padding: 7px 13px; border: none; border-radius: 999px;
            background: var(--dgut-secondary-container); color: var(--dgut-on-surface-variant);
            font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
            transition: background .15s, color .15s, box-shadow .15s;
        }
        .dgut-btn:hover { background: var(--dgut-primary-container); color: var(--dgut-on-primary-container); }
        .dgut-btn-primary { background: var(--dgut-primary); color: var(--dgut-on-primary); }
        .dgut-btn-primary:hover { background: #58418E; color: #fff; }
        .dgut-btn svg, .dgut-ico svg { width: 15px; height: 15px; fill: currentColor; flex: none; }
    `);

    /* ==================== 模块 X1: 轻量通知 ==================== */
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
        card.style.cssText = `position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:2147483645;min-width:340px;max-width:92vw;background:#1D1B20;color:#fff;padding:16px 20px 20px;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.45);font-family:"Segoe UI",Roboto,sans-serif;cursor:pointer;border-left:6px solid #6750A4;animation:dgutDown .35s cubic-bezier(.2,.8,.2,1);overflow:hidden;`;
        card.innerHTML = `
            <div style="font-size:16px;font-weight:600;margin-bottom:4px;">${escapeHtml(title)}</div>
            <div style="font-size:14px;color:#E6E0E9;line-height:1.5;">${escapeHtml(body)}</div>
            ${subtext ? `<div style="font-size:12px;color:#CAC4D0;margin-top:6px;">${escapeHtml(subtext)}</div>` : ''}
            <div style="position:absolute;left:0;bottom:0;height:3px;background:#6750A4;width:100%;transform-origin:left;animation:dgutShrinkX ${durationMs}ms linear forwards;"></div>`;
        document.body.appendChild(card);
        card.onclick = () => card.remove();
        setTimeout(() => card.remove(), durationMs + 500);
    }

    /* ==================== 模块 2: 网络与鉴权 ==================== */
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
    // 与 gmFetch 共用鉴权，但允许指定 method 与 JSON body，供优学院签到接口使用
    async function gmFetchEx(url, opts = {}) {
        const token = await getAuthToken();
        if (!token) throw new Error('无法获取 Token，请先登录优学院');
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
                    if (res.status >= 400) return reject(new Error('HTTP ' + res.status));
                    try { resolve(JSON.parse(res.responseText)); }
                    catch (e) { reject(new Error('JSON 解析失败: ' + String(res.responseText).slice(0, 120))); }
                },
                onerror: () => reject(new Error('网络错误')),
                ontimeout: () => reject(new Error('请求超时'))
            });
        });
    }

    /* ==================== 模块 S1: 优学院课程签到 ====================
       读取课程 → 轮询当日课堂活动 → 命中进行中的签到 → 调用 signByStu 提交。
       签到类型：0=选人点名 1=二维码签到 2=数字码签到 3=一键签到。
       诚实边界：脚本不会识别教室现场展示的二维码图片；二维码签到仅当活动数据自带签到码时才处理。 */
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
    let gSignMonitor = null;

    function getSignConfig() { return Object.assign({}, DEFAULT_SIGN_CONFIG, GM_getValue(SIGN_CONFIG_KEY, {}) || {}); }
    function saveSignConfig(patch) { GM_setValue(SIGN_CONFIG_KEY, Object.assign(getSignConfig(), patch)); }
    function signKindText(t) { return SIGN_KINDS[t] || '未知签到'; }

    async function signResolveUserId() {
        if (gSignUserId) return gSignUserId;
        let uid = null;
        const isDgutHost = /(^|\.)dgut\.edu\.cn$/i.test(location.hostname) || /(^|\.)ulearning\.cn$/i.test(location.hostname);
        if (isDgutHost) {
            const m = document.cookie.match(/(?:^|;\s*)userid=([^;]+)/);
            if (m) uid = Number(m[1]) || null;
        }
        if (!uid && typeof GM_cookie !== 'undefined' && GM_cookie.list) {
            uid = await new Promise((resolve) => {
                try {
                    GM_cookie.list({ url: API_HOST, name: 'userid' }, (cookies, error) => {
                        resolve(error || !cookies || !cookies.length ? null : (Number(cookies[0].value) || null));
                    });
                } catch (e) { resolve(null); }
            });
        }
        if (!uid) uid = GM_getValue(SIGN_USERID_KEY, null);
        if (uid) { gSignUserId = uid; GM_setValue(SIGN_USERID_KEY, uid); }
        return gSignUserId;
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
        if (!uid) return { ok: false, kind, message: '未获取到用户ID（userid），无法签到' };
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
            const color = level === 'success' ? '#2E7D32' : level === 'warn' ? '#B3261E' : level === 'muted' ? '#79747E' : '#49454E';
            const div = document.createElement('div');
            div.style.cssText = `color:${color};line-height:1.7;word-break:break-all;`;
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
                    if (result.ok) { gSignMonitor.checked.add(key); signLog(`✓ [${course.name}] ${result.kind}：${result.already ? '已签到过' : '签到成功'}`, 'success'); }
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
        if (!course) { showStatus('请先选择一门课程', true); return; }
        stopSignMonitor(true);
        gSignMonitor = { timer: null, checked: new Set(), running: true, course, busy: false };
        const interval = Math.max(2, Number(cfg.pollInterval) || 5);
        signLog(`开始监测《${course.name}》，每 ${interval} 秒检查一次。`, 'success');
        signLog('提示：数字码/一键签到可直接完成；二维码签到仅当活动数据自带签到码时才处理。', 'muted');
        const run = async () => {
            if (!gSignMonitor || !gSignMonitor.running || gSignMonitor.busy) return;
            await signPollOnce(gSignMonitor.course);
        };
        run();
        gSignMonitor.timer = setInterval(run, interval * 1000);
        renderSignViewStatus();
        showToastCard(`${icons.sign} 签到监测已启动`, `《${course.name}》· 每 ${interval} 秒检查一次`, '数字码/一键签到自动完成；二维码需活动自带码', 8000);
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
        el.innerHTML = (gSignMonitor && gSignMonitor.running)
            ? `<span style="color:#2E7D32;font-weight:600;">● 监测中</span> · 《${escapeHtml(gSignMonitor.course.name)}》 · 已处理 ${gSignMonitor.checked.size} 项`
            : `<span style="color:#79747E;">○ 未运行</span>`;
    }
    function renderSignViewRefreshCourses() { const box = document.getElementById('dgut-sign-courses'); if (box) renderSignCourseList(box); }
    function renderSignCourseList(box) {
        if (!box) return;
        const cfg = getSignConfig();
        const kw = (document.getElementById('dgut-sign-search')?.value || '').trim().toLowerCase();
        const list = gSignCourses.filter(c => !kw || c.name.toLowerCase().includes(kw) || String(c.id).includes(kw) || (c.teacherName || '').toLowerCase().includes(kw));
        if (!list.length) { box.innerHTML = `<div style="font-size:12px;color:#79747E;padding:6px 0;">${gSignCourses.length ? '无匹配课程' : '尚未读取课程，点击上方"读取课程"'}</div>`; return; }
        box.innerHTML = list.slice(0, 60).map(c => {
            const active = String(c.id) === String(cfg.selectedCourseId);
            return `<button class="dgut-sign-course" data-id="${c.id}" data-name="${escapeHtml(c.name)}" style="display:block;width:100%;text-align:left;margin-bottom:4px;padding:8px 10px;border:1px solid ${active ? '#6750A4' : '#E7E0EC'};border-radius:10px;background:${active ? '#E8DEF8' : '#fff'};cursor:pointer;font-size:13px;color:#1D1B20;">
                <b>${escapeHtml(c.name)}</b><span style="color:#79747E;font-size:11px;margin-left:6px;">${escapeHtml(c.teacherName || '')} · #${c.id}</span></button>`;
        }).join('');
        box.querySelectorAll('.dgut-sign-course').forEach(btn => btn.onclick = () => {
            saveSignConfig({ selectedCourseId: Number(btn.dataset.id), selectedCourseName: btn.dataset.name });
            renderSignCourseList(box);
        });
    }
    function renderSignView(ac) {
        const cfg = getSignConfig();
        ac.innerHTML = actionHeader(ACTION_TITLES.sign, '轮询当日课堂活动并自动签到') + `
            <div style="background:#fff;border:1px solid #E7E0EC;border-radius:14px;padding:16px;margin-bottom:12px;">
                <div style="display:flex;gap:8px;margin-bottom:10px;">
                    <input id="dgut-sign-search" placeholder="搜索课程（名称/教师/ID）" style="flex:1;min-width:0;padding:9px 12px;border:1px solid #CAC4D0;border-radius:10px;background:#F3EDF7;font-size:13px;outline:none;">
                    <button id="dgut-sign-load" class="dgut-btn dgut-btn-primary" style="flex:none;">${icons.refresh} 读取课程</button>
                </div>
                <div id="dgut-sign-courses" style="max-height:200px;overflow-y:auto;"></div>
            </div>
            <div style="background:#fff;border:1px solid #E7E0EC;border-radius:14px;padding:16px;margin-bottom:12px;">
                <div style="font-size:13px;font-weight:700;margin-bottom:10px;">监测设置</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:13px;margin-bottom:10px;">
                    <label>轮询间隔(秒) <input type="number" id="dgut-sign-interval" value="${cfg.pollInterval}" min="2" max="3600" style="width:64px;padding:4px;border-radius:8px;border:1px solid #CAC4D0;"></label>
                    <label>纬度 <input type="number" id="dgut-sign-lat" value="${cfg.lat}" step="0.0001" style="width:110px;padding:4px;border-radius:8px;border:1px solid #CAC4D0;"></label>
                    <label>经度 <input type="number" id="dgut-sign-lng" value="${cfg.lng}" step="0.0001" style="width:110px;padding:4px;border-radius:8px;border:1px solid #CAC4D0;"></label>
                    <label>地址 <input type="text" id="dgut-sign-addr" value="${escapeHtml(cfg.address)}" style="width:150px;padding:4px;border-radius:8px;border:1px solid #CAC4D0;"></label>
                </div>
                <label style="display:block;font-size:13px;cursor:pointer;margin-bottom:10px;"><input type="checkbox" id="dgut-sign-savelog" ${cfg.saveLog ? 'checked' : ''}> 保存签到记录（可导出 Markdown）</label>
                <div id="dgut-sign-status" style="font-size:12px;margin-bottom:10px;"></div>
                <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
                    <button id="dgut-sign-save" class="dgut-btn">${icons.settings} 保存设置</button>
                    <button id="dgut-sign-start" class="dgut-btn dgut-btn-primary">${icons.sign} 开始监测</button>
                    <button id="dgut-sign-stop" class="dgut-btn">停止</button>
                    <button id="dgut-sign-export" class="dgut-btn">${icons.export} 导出记录</button>
                </div>
            </div>
            <div style="background:#fff;border:1px solid #E7E0EC;border-radius:14px;padding:12px;">
                <div style="font-size:13px;font-weight:700;margin-bottom:6px;">运行日志</div>
                <div id="dgut-sign-log" style="max-height:240px;overflow-y:auto;font-size:12px;background:#F7F2FA;border-radius:10px;padding:8px 10px;"></div>
            </div>
            <div style="background:#FBEAF9;border:1px solid #E7E0EC;border-radius:14px;padding:12px 14px;font-size:12px;color:#4A4458;line-height:1.8;margin-top:12px;">
                <b>关于二维码签到</b>：本脚本不会识别教室现场展示的二维码图片。数字码签到、一键签到可直接完成；二维码签到仅当活动数据本身已包含签到码时才会自动处理，否则会明确跳过并记录原因。
            </div>`;
        const box = ac.querySelector('#dgut-sign-courses');
        renderSignCourseList(box);
        ac.querySelector('#dgut-sign-search').addEventListener('input', () => renderSignCourseList(box));
        ac.querySelector('#dgut-sign-load').onclick = async () => { await signLoadCourses(true); renderSignCourseList(box); };
        const readSettings = () => ({
            pollInterval: Math.max(2, Number(ac.querySelector('#dgut-sign-interval').value) || 5),
            lat: Number(ac.querySelector('#dgut-sign-lat').value) || DEFAULT_SIGN_CONFIG.lat,
            lng: Number(ac.querySelector('#dgut-sign-lng').value) || DEFAULT_SIGN_CONFIG.lng,
            address: ac.querySelector('#dgut-sign-addr').value.trim() || DEFAULT_SIGN_CONFIG.address,
            saveLog: ac.querySelector('#dgut-sign-savelog').checked
        });
        ac.querySelector('#dgut-sign-save').onclick = () => { saveSignConfig(readSettings()); showStatus('签到设置已保存'); };
        ac.querySelector('#dgut-sign-start').onclick = () => { saveSignConfig(readSettings()); if (!gSignCourses.length) signLoadCourses(true).then(() => startSignMonitor()); else startSignMonitor(); };
        ac.querySelector('#dgut-sign-stop').onclick = () => stopSignMonitor();
        ac.querySelector('#dgut-sign-export').onclick = exportSignLog;
        renderSignViewStatus();
        const logEl = ac.querySelector('#dgut-sign-log');
        if (logEl) {
            GM_getValue(SIGN_LOG_KEY, []).slice(-30).forEach(r => {
                const d = new Date(r.time);
                const div = document.createElement('div');
                div.style.cssText = 'color:#79747E;line-height:1.7;';
                div.textContent = `[${d.toLocaleString('zh-CN')}] ${r.course} | ${r.kind} | ${r.status || ''} ${r.message || ''}`;
                logEl.appendChild(div);
            });
        }
        if (gSignCourses.length) renderSignCourseList(box);
        else signLoadCourses(false).then(() => renderSignCourseList(box));
    }

    /* ==================== 模块 S2: 优学院刷课助手 ====================
       运行在课件页（ua.dgut.edu.cn/learnCourse / *.ulearning.cn/learnCourse）：
       倍速守卫（重写 playbackRate setter 抗平台回退）、自动答题（答案源：KO 视图模型 correctAnswer() → 本地题库 → uaapi/questionAnswer 接口）、
       弹窗处理、自动翻页、题库收集与导出。自动答题默认开启，但未知题型一律跳过、绝不盲点。 */
    const DEFAULT_COURSE_HELPER = {
        enabled: false, rate: 6,
        autoAnswer: true, autoNext: true, collectBank: true
    };
    let gCourseHelper = null;
    const pgSleep = (ms) => new Promise(r => setTimeout(r, ms));
    const PG_TYPE_MAP = { 1: '单选题', 2: '多选题', 3: '填空题', 4: '判断题', 5: '简答题', 11: '完形填空', 12: '排序题', 17: '选词填空', 23: '下拉选择题', 24: '综合题' };

    function isCoursePage() { return /learnCourse/i.test(location.pathname) || /learnCourse/i.test(location.href); }
    function getCourseHelperConfig() { return Object.assign({}, DEFAULT_COURSE_HELPER, GM_getValue(COURSE_HELPER_KEY, {}) || {}); }
    function saveCourseHelperConfig(patch) { GM_setValue(COURSE_HELPER_KEY, Object.assign(getCourseHelperConfig(), patch)); }
    function pgVisible(el) { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
    function pgReText(text) { return String(text || '').replace(/<\/?.+?\/?>/g, '').replace(/[\t\n\r]/g, '').replace(/&.*?;/g, '').trim(); }
    function pgTriggerMouseSequence(el) { if (!el) return; ['mousedown', 'mouseup', 'click'].forEach(n => { try { el.dispatchEvent(new Event(n, { bubbles: true, cancelable: true })); } catch (e) {} }); try { if (typeof el.click === 'function') el.click(); } catch (e) {} }
    function chLog(text, level = 'info') {
        const el = document.getElementById('dgut-ch-log');
        if (el) {
            const color = level === 'success' ? '#2E7D32' : level === 'warn' ? '#B3261E' : level === 'muted' ? '#79747E' : '#49454E';
            const div = document.createElement('div');
            div.style.cssText = `color:${color};line-height:1.7;`;
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
                onload: (res) => { try { resolve(JSON.parse(res.responseText)); } catch (e) { reject(new Error('JSON 解析失败')); } },
                onerror: () => reject(new Error('网络错误')),
                ontimeout: () => reject(new Error('请求超时'))
            });
        });
    }

    // ---- 倍速守卫：重写实例 playbackRate setter + ratechange 监听，抗平台回退 ----
    const pgRateGuard = {
        target: 6, active: false, hooked: new WeakSet(), nativeDescriptor: null,
        init() {
            this.target = Math.max(1, Math.min(16, Number(getCourseHelperConfig().rate) || 6));
            try {
                this.nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate')
                    || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(document.createElement('video')), 'playbackRate');
            } catch (e) { this.nativeDescriptor = null; }
        },
        refresh() { this.target = Math.max(1, Math.min(16, Number(getCourseHelperConfig().rate) || 6)); },
        start() { this.init(); this.active = true; this.hookAll(); },
        stop() { this.active = false; },
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
                                self.nativeDescriptor.set.call(this, val);
                                Promise.resolve().then(() => { try { self.nativeDescriptor.set.call(this, self.target); } catch (e) {} });
                            } else self.nativeDescriptor.set.call(this, val);
                        },
                        configurable: true, enumerable: true
                    });
                }
            } catch (e) {}
            v.addEventListener('ratechange', () => { if (!this.active) return; try { const cur = this.get(v); if (Math.abs(cur - this.target) > 0.01) this.set(v, this.target); } catch (e) {} });
        }
    };

    // ---- Knockout 视图模型访问 ----
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

    // ---- 答案来源 ----
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
    function pgBankAnswer(node) {
        const idAttr = (node.querySelector('.question-wrapper') || node).getAttribute('id') || '';
        const qid = idAttr.startsWith('question') ? idAttr.substring(8) : idAttr;
        if (!qid) return null;
        const rec = pgBank().find(r => String(r.qid) === String(qid));
        return rec && rec.answer ? String(rec.answer).split(/[,\s|，、]+/).filter(Boolean) : null;
    }
    async function pgRemoteAnswer(node) {
        const idAttr = (node.querySelector('.question-wrapper') || node).getAttribute('id') || '';
        const qid = idAttr.startsWith('question') ? idAttr.substring(8) : idAttr;
        if (!qid) return null;
        const parentIdAttr = document.querySelector('.page-name.active')?.parentElement?.getAttribute('id') || '';
        const parentId = parentIdAttr.length > 4 ? parentIdAttr.substring(4) : '';
        const host = location.hostname.includes('dgut.edu.cn') ? 'https://ua.dgut.edu.cn' : 'https://api.ulearning.cn';
        try {
            const data = await pgRequestJson(`${host}/uaapi/questionAnswer/${qid}?parentId=${parentId}`);
            if (data && Array.isArray(data.correctAnswerList) && data.correctAnswerList.length) return data.correctAnswerList.map(String);
        } catch (e) {}
        return null;
    }
    function pgResolveType(node, tag) {
        if (node.querySelector('.blank-input')) return '填空题';
        if (node.querySelector('.cloze-input')) return '选词填空';
        if (node.querySelector('.answer-blank')) return '排序题';
        if (node.querySelector('.choice-btn.right-btn')) return '判断题';
        if (node.querySelector('.choice-list .choice-item')) return '单选题';
        if (node.querySelector('.form-control')) return '简答题';
        return tag || '未知';
    }
    function pgApplyAnswer(node, type, answers) {
        if (!answers || !answers.length) return false;
        const w = node.querySelector('.question-wrapper') || node;
        if (type === '判断题') {
            const val = String(answers[0]).toLowerCase();
            const isTrue = val === 'true' || val === '正确' || val === '对' || val === '1';
            const btn = w.querySelector(isTrue ? '.choice-btn.right-btn' : '.choice-btn.wrong-btn');
            if (btn) { pgTriggerMouseSequence(btn); return true; }
            return false;
        }
        if (type === '单选题' || type === '多选题') {
            const items = Array.from(w.querySelectorAll('.choice-list .choice-item'));
            const idxs = answers.map(a => { const m = String(a).toUpperCase().match(/[A-Z]/); return m ? m[0].charCodeAt(0) - 65 : -1; }).filter(i => i >= 0 && i < items.length);
            const target = type === '多选题' ? idxs : (idxs.length ? [idxs[0]] : []);
            target.forEach(i => { try { const cb = items[i].querySelector('.checkbox'); if (cb) cb.classList.add('selected'); } catch (e) {} pgTriggerMouseSequence(items[i]); });
            return target.length > 0;
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

    // ================= 主循环（本次修改重点） =================
    let gPgAnswering = false, gPgQuestionUntil = 0;
    let gPgLastFlipAt = 0;        // 上次翻页时间戳（冷却用）
    let gPgLastPageKey = '';       // 上次翻页时的页码指纹

    // 生成当前页面的指纹：section 名 + active page 名
    function pgPageKey() {
        const a = document.querySelector('.page-name.active');
        if (!a) return '';
        const sec = a.closest('.section-item');
        const secName = sec ? ((sec.querySelector('.section-name .text') || {}).textContent || '') : '';
        return secName.trim() + '|' + (a.textContent || '').trim();
    }

    // 页面上的"媒体容器"数量（视频骨架/播放器容器）。比 <video> 稳定得多。
    // 优学院课件页在切换小节时，.file-media 会先渲染；<video> 由 mejs 挂载才有。
    function pgMediaContainerCount() {
        return document.querySelectorAll(
            '.file-media, .video-element, .video-wrapper, .courseware-video, .video-box, .prism-player, .vjs-tech'
        ).length;
    }

    // 只取"可见"的 <video>，排除隐藏、残留、广告 video
    function pgVisibleVideos() {
        return Array.from(document.querySelectorAll('video')).filter(v => {
            if (!v.isConnected) return false;
            const r = v.getBoundingClientRect();
            return r.width >= 20 && r.height >= 20;
        });
    }

    // 带冷却 + 页码校验的翻页（唯一翻页入口）
    function pgClickNextOnce() {
        const now = Date.now();
        if (now - gPgLastFlipAt < 3000) return false;      // 3 秒冷却
        const key = pgPageKey();
        // 冷却期内页码没变，说明上次翻页未生效，二次点击也无效
        if (key && key === gPgLastPageKey && now - gPgLastFlipAt < 6000) return false;
        const b = document.querySelector('.next-page-btn.cursor');
        if (!b) return false;
        pgTriggerMouseSequence(b);
        gPgLastFlipAt = now;
        gPgLastPageKey = key;
        return true;
    }

    // 兼容旧调用（统一走带冷却的版本）
    function pgClickNext() { return pgClickNextOnce(); }

    function pgDismissModal() {
        const modal = document.querySelector('.modal.fade.in');
        if (!modal || !pgVisible(modal)) return false;
        const id = modal.id;
        if (id === 'statModal') { const b = modal.querySelectorAll('.btn-hollow'); if (b.length) b[b.length - 1].click(); return true; }
        if (id === 'alertModal') { const h = modal.querySelectorAll('.btn-hollow'); (h.length ? h[h.length - 1] : modal.querySelector('.btn-submit'))?.click(); return true; }
        return false;
    }
    async function pgAnswerAll() {
        if (gPgAnswering) return;
        gPgAnswering = true;
        const cfg = getCourseHelperConfig();
        try {
            const nodes = Array.from(document.querySelectorAll('.question-element-node'));
            if (cfg.collectBank) pgCollectBank();
            for (const node of nodes) {
                const w = node.querySelector('.question-wrapper');
                if (!w || w.classList.contains('finished')) continue;
                if (!cfg.autoAnswer) continue;
                const tag = pgReText((w.querySelector('.question-type-tag') || {}).textContent || '');
                const type = pgResolveType(w, tag);
                let answers = pgVmAnswer(node) || pgBankAnswer(node);
                if (!answers) answers = await pgRemoteAnswer(node);
                if (answers && answers.length) { pgApplyAnswer(w, answers.length > 1 && type === '单选题' ? '多选题' : type, answers); await pgSleep(180); }
                pgSubmitQuestion(node);
            }
            const gb = document.querySelector('.question-operation-area button');
            if (gb && pgReText(gb.textContent) !== '重做') { pgTriggerMouseSequence(gb); await pgSleep(300); }
            gPgQuestionUntil = Date.now() + 1500;
            await pgSleep(900);
            pgClickNextOnce();     // ★ 修改：与视频分支共用同一个翻页入口
        } finally {
            gPgAnswering = false;
        }
    }

    function pgLogic() {
        if (!gCourseHelper || !gCourseHelper.running) return;
        if (pgDismissModal()) return;

        // ① 题目面板优先级最高
        if (document.querySelector('.question-setting-panel')) {
            if (Date.now() < gPgQuestionUntil) return;
            pgAnswerAll();
            return;
        }

        // ② 只要存在"媒体容器"，就绝不走裸翻页分支。
        //    即便 <video> 还没挂载（切换小节的空窗期），也只是等待。
        if (pgMediaContainerCount() > 0) {
            const videos = pgVisibleVideos();
            if (videos.length === 0) {
                // 播放器骨架已渲染但 <video> 未挂载 → 等待下一轮
                chUpdateStatus();
                return;
            }
            let i = 0;
            for (; i < videos.length; i++) {
                const v = videos[i];
                const dur = Number(v.duration);
                let finished = v.ended || (Number.isFinite(dur) && dur > 0 && v.currentTime >= dur - 0.3);
                if (!finished) {
                    // "已完成" 标记按视频自身所属容器查，避免下标对齐错位
                    const container = v.closest('.page-item, .section-item, .question-element-node') || v.parentElement;
                    const finNode = container ? container.querySelector("[data-bind='text: $root.i18nMessageText().finished']") : null;
                    // 只有 duration 就绪且 currentTime 确实接近末尾，才采信"已完成"标记
                    if (finNode && pgVisible(finNode) && Number.isFinite(dur) && dur > 0 && v.currentTime >= dur - 1.5) {
                        finished = true;
                    }
                }
                if (finished) continue;

                pgRateGuard.hook(v);
                pgRateGuard.refresh();
                if (Math.abs(pgRateGuard.get(v) - pgRateGuard.target) > 0.01) pgRateGuard.set(v, pgRateGuard.target);
                if (v.paused) { v.muted = true; v.play().catch(() => {}); }
                break;
            }
            if (i === videos.length) pgClickNextOnce();
            return;
        }

        // ③ 页面上没有媒体容器：纯文本/图片/目录页 → 走翻页
        pgClickNextOnce();
    }

    function chUpdateStatus() {
        const el = document.getElementById('dgut-ch-status');
        if (!el) return;
        const cfg = getCourseHelperConfig();
        const page = pgReText((document.querySelector('.page-name.active') || {}).textContent || '');
        const qLeft = document.querySelectorAll('.question-wrapper:not(.finished)').length;
        el.innerHTML = (gCourseHelper && gCourseHelper.running)
            ? `<span style="color:#2E7D32;font-weight:600;">● 运行中</span> · 页面「${escapeHtml(page || '未知')}」 · 视频 ${document.querySelectorAll('video').length} · 未完成题 ${qLeft} · 倍速 ${cfg.rate}×`
            : `<span style="color:#79747E;">○ 未运行</span>`;
    }
    function startCourseHelper() {
        if (gCourseHelper && gCourseHelper.running) { showStatus('刷课助手已在运行'); return; }
        const cfg = getCourseHelperConfig();
        if (!isCoursePage()) showStatus('当前不在课件页（需 ua.dgut.edu.cn/learnCourse），仍会尝试运行', true);
        gCourseHelper = { running: true, timer: null, uiTimer: null };
        pgRateGuard.start();
        // 复位翻页冷却，避免切页残留状态干扰
        gPgLastFlipAt = 0;
        gPgLastPageKey = '';
        chLog(`刷课助手启动：倍速 ${cfg.rate}×，自动答题 ${cfg.autoAnswer ? '开' : '关'}，自动翻页 ${cfg.autoNext ? '开' : '关'}`, 'success');
        gCourseHelper.timer = setInterval(pgLogic, 1500);
        gCourseHelper.uiTimer = setInterval(() => { if (!gCourseHelper || !gCourseHelper.running) { clearInterval(gCourseHelper.uiTimer); return; } chUpdateStatus(); }, 2000);
        pgLogic();
        chUpdateStatus();
        showToastCard(`${icons.course} 刷课助手已启动`, `倍速 ${cfg.rate}× · 自动答题/翻页`, '答案源：视图模型 → 本地题库 → 接口', 8000);
        playAlarmBeep({ count: 1, volume: 0.3 });
    }
    function stopCourseHelper() {
        if (!gCourseHelper) return;
        gCourseHelper.running = false;
        if (gCourseHelper.timer) clearInterval(gCourseHelper.timer);
        if (gCourseHelper.uiTimer) clearInterval(gCourseHelper.uiTimer);
        gCourseHelper = null;
        pgRateGuard.stop();
        chLog('刷课助手已停止。', 'warn');
        chUpdateStatus();
        showStatus('已停止刷课助手');
    }
    function renderCourseView(ac) {
        const cfg = getCourseHelperConfig();
        const onPage = isCoursePage();
        ac.innerHTML = actionHeader(ACTION_TITLES.course, '课件视频倍速、自动答题、自动翻页与题库') + `
            <div style="background:${onPage ? '#E8F5E9' : '#FFF3E0'};border:1px solid #E7E0EC;border-radius:12px;padding:10px 14px;font-size:12px;line-height:1.7;margin-bottom:12px;color:#49454E;">
                ${onPage ? '✓ 当前已在课件页，可直接启动。' : '当前不在课件页。请先在优学院打开具体课件（地址含 <b>ua.dgut.edu.cn/learnCourse</b>），再回到此处启动。'}
            </div>
            <div style="background:#fff;border:1px solid #E7E0EC;border-radius:14px;padding:16px;margin-bottom:12px;">
                <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:13px;margin-bottom:12px;">
                    <label>视频倍速 <input type="number" id="dgut-ch-rate" value="${cfg.rate}" min="1" max="16" step="0.5" style="width:60px;padding:4px;border-radius:8px;border:1px solid #CAC4D0;"></label>
                </div>
                <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;margin-bottom:12px;">
                    <label style="cursor:pointer;color:${cfg.autoAnswer ? '#6750A4' : '#49454E'};"><input type="checkbox" id="dgut-ch-answer" ${cfg.autoAnswer ? 'checked' : ''}> 自动答题（答案源：视图模型/题库/接口）</label>
                    <label style="cursor:pointer;"><input type="checkbox" id="dgut-ch-next" ${cfg.autoNext ? 'checked' : ''}> 自动翻页</label>
                    <label style="cursor:pointer;"><input type="checkbox" id="dgut-ch-bank" ${cfg.collectBank ? 'checked' : ''}> 收集题库</label>
                </div>
                <div id="dgut-ch-status" style="font-size:12px;margin-bottom:10px;"></div>
                <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
                    <button id="dgut-ch-save" class="dgut-btn">${icons.settings} 保存设置</button>
                    <button id="dgut-ch-start" class="dgut-btn dgut-btn-primary">${icons.course} 启动</button>
                    <button id="dgut-ch-stop" class="dgut-btn">停止</button>
                    <button id="dgut-ch-export" class="dgut-btn">${icons.export} 导出题库</button>
                    <button id="dgut-ch-clear" class="dgut-btn">清空题库</button>
                </div>
            </div>
            <div style="background:#fff;border:1px solid #E7E0EC;border-radius:14px;padding:12px;margin-bottom:12px;">
                <div style="font-size:13px;font-weight:700;margin-bottom:6px;">运行日志</div>
                <div id="dgut-ch-log" style="max-height:220px;overflow-y:auto;font-size:12px;background:#F7F2FA;border-radius:10px;padding:8px 10px;"></div>
            </div>
            <div style="background:#FBEAF9;border:1px solid #E7E0EC;border-radius:14px;padding:12px 14px;font-size:12px;color:#4A4458;line-height:1.8;">
                <b>安全说明</b>：未知题型一律跳过、绝不盲点（平台测验多为"限答1次"）。答案优先取页面视图模型，其次本地题库，最后请求答案接口。本助手仅在课件页生效。
            </div>`;
        const readCfg = () => ({
            rate: Math.min(16, Math.max(1, Number(ac.querySelector('#dgut-ch-rate').value) || 6)),
            autoAnswer: ac.querySelector('#dgut-ch-answer').checked,
            autoNext: ac.querySelector('#dgut-ch-next').checked,
            collectBank: ac.querySelector('#dgut-ch-bank').checked
        });
        ac.querySelector('#dgut-ch-save').onclick = () => { saveCourseHelperConfig(readCfg()); showStatus('刷课设置已保存'); };
        ac.querySelector('#dgut-ch-start').onclick = () => { saveCourseHelperConfig(readCfg()); startCourseHelper(); };
        ac.querySelector('#dgut-ch-stop').onclick = stopCourseHelper;
        ac.querySelector('#dgut-ch-export').onclick = () => { if (getCourseHelperConfig().collectBank) pgCollectBank(); pgExportBank(); };
        ac.querySelector('#dgut-ch-clear').onclick = pgClearBank;
        chUpdateStatus();
    }

    /* ==================== 模块 S3: 作业互评增强 ====================
       在作业互评详情页（URL 含 stuDetail/{sid}/{hwid}）读取互评接口，去匿名化评价人，并把记录汇总到面板。 */
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
                onload: (res) => { try { resolve(JSON.parse(res.responseText)); } catch (e) { reject(new Error('JSON 解析失败')); } },
                onerror: () => reject(new Error('网络错误')),
                ontimeout: () => reject(new Error('请求超时'))
            });
        });
    }
    function peerCardClass(score) { const s = parseFloat(score); if (isNaN(s)) return ['#E7E0EC', '#1D1B20']; if (s < 90) return ['#AEAAE4', '#1D1B20']; if (s <= 95) return ['#CAC4D0', '#1D1B20']; return ['#E7E0EC', '#1D1B20']; }
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
        if (!list.length) { el.innerHTML = `<div style="text-align:center;color:#79747E;padding:20px;font-size:13px;">暂无互评记录。请打开作业互评详情页后点击"扫描当前作业"。</div>`; return; }
        el.innerHTML = list.map(r => {
            const [bg, fg] = peerCardClass(r.score);
            const t = new Date(peerToMs(r.time)).toLocaleString('zh-CN', { hour12: false });
            return `<div style="background:${bg};color:${fg};border-radius:12px;padding:10px 14px;margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:600;"><span>${escapeHtml(r.reviewerName || '?')}</span><span>${r.score}分</span></div>
                <div style="font-size:12px;opacity:.85;margin:4px 0 6px;">作业：${escapeHtml(r.hwName || '?')}</div>
                <div style="font-size:13px;line-height:1.4;margin-bottom:6px;">${escapeHtml(r.content || '无评语')}</div>
                <div style="font-size:11px;opacity:.7;border-top:1px solid rgba(0,0,0,.1);padding-top:5px;display:flex;justify-content:space-between;"><span>班级：${escapeHtml(r.reviewerClassName || '未知')}</span><span>${t}</span></div>
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
                    tag.style.cssText = 'font-size:13px;margin:6px 0;padding:4px 8px;border-left:2px solid #6750A4;background:rgba(103,80,164,.06);white-space:pre-line;';
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
        if (!p) { showStatus('当前不是作业互评详情页（URL 需含 stuDetail/学号/作业ID）', true); return; }
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
            // 回填已存记录的评价人信息
            const all = peerRecords().map(r => { const u = gPeerInfoMap[r.reviewerId]; return u ? Object.assign({}, r, { reviewerName: u.name, reviewerSid: u.studentid, reviewerClassName: u.className }) : r; });
            GM_setValue(PEER_KEY, all);
            peerRenderList();
            await pgSleep(400);
            peerInjectLabels();
            if (gPeerObserver) gPeerObserver.disconnect();
            gPeerObserver = new MutationObserver(() => { if (document.querySelector('.peermain:not([data-peerdone]), .peer_host:not([data-peerdone])')) peerInjectLabels(); });
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
            <div style="background:${onPage ? '#E8F5E9' : '#FFF3E0'};border:1px solid #E7E0EC;border-radius:12px;padding:10px 14px;font-size:12px;line-height:1.7;margin-bottom:12px;color:#49454E;">
                ${onPage ? '✓ 当前在作业互评详情页，可点击"扫描当前作业"。' : '请在作业互评详情页（URL 含 <b>stuDetail/学号/作业ID</b>）打开本面板，再扫描。'}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                <input id="dgut-peer-ftext" placeholder="按评价人姓名/学号筛选" style="flex:1;min-width:120px;padding:8px 10px;border:1px solid #CAC4D0;border-radius:10px;background:#F3EDF7;font-size:12px;outline:none;">
                <input id="dgut-peer-fscore" placeholder="分数 80-95 / >90" style="width:130px;padding:8px 10px;border:1px solid #CAC4D0;border-radius:10px;background:#F3EDF7;font-size:12px;outline:none;">
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-bottom:10px;flex-wrap:wrap;">
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

    /* ==================== 模块 S4: 求是读书 ====================
       在课件页按书目累计真实阅读时长（与服务端 KO 视图模型同步），满 4h10m 自动翻页/切书；阅读器子框架由父窗口 postMessage 驱动翻页。 */
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
    function rdIsComplete(page) { try { const rec = rdUnwrap(page.record); return rec ? !!rdUnwrap(rec.status) : false; } catch (e) { return false; } }
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
        let n = 0;
        Array.from(document.querySelectorAll('iframe')).forEach(f => { try { if (f.contentWindow) { f.contentWindow.postMessage(payload, '*'); n++; } } catch (e) {} });
        return n;
    }
    function rdTick() {
        if (!gRead || !gRead.running) return;
        const vm = rdVm();
        // 弹窗
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
        const key = rdBookKey();
        gRead = { running: true, timer: null, bookKey: key, accumulated: rdBookTime(key), sessionStart: Date.now(), lastSave: rdBookTime(key), total: rdBookTime(key), curPageId: null, pageStart: Date.now() };
        const vm = rdVm(); if (vm && vm.currentPage) gRead.curPageId = rdPageId(vm.currentPage());
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
        const onPage = /\/learnCourse\//i.test(location.href) || (rdVm() && rdVm().currentPage);
        ac.innerHTML = actionHeader(ACTION_TITLES.read, '课件阅读时长统计与自动翻页') + `
            <div style="background:${onPage ? '#E8F5E9' : '#FFF3E0'};border:1px solid #E7E0EC;border-radius:12px;padding:10px 14px;font-size:12px;line-height:1.7;margin-bottom:12px;color:#49454E;">
                ${onPage ? '✓ 当前在课件页，可开始求是阅读。' : '请先在优学院打开求是读书课件页（地址含 <b>ua.dgut.edu.cn/learnCourse/learnCourse.html</b>）。'}
            </div>
            <div style="background:#fff;border:1px solid #E7E0EC;border-radius:14px;padding:16px;margin-bottom:12px;">
                <div style="text-align:center;font-size:30px;font-weight:700;color:#6750A4;font-family:Consolas,monospace;" id="dgut-rd-timer">${rdFmt(rdBookTime(rdBookKey()))}</div>
                <div style="text-align:center;font-size:12px;color:#79747E;margin:4px 0 12px;" id="dgut-rd-server">服务端: --</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:13px;margin-bottom:12px;align-items:center;">
                    <label>翻页间隔 <input type="number" id="dgut-rd-sec" value="${cfg.readerSec}" min="1" style="width:64px;padding:4px;border-radius:8px;border:1px solid #CAC4D0;">秒/页</label>
                    <span style="color:#79747E;font-size:12px;">目标 4h10m 后自动切书</span>
                </div>
                <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
                    <button id="dgut-rd-save" class="dgut-btn">${icons.settings} 保存间隔</button>
                    <button id="dgut-rd-start" class="dgut-btn dgut-btn-primary">开始</button>
                    <button id="dgut-rd-stop" class="dgut-btn">暂停</button>
                    <button id="dgut-rd-sync" class="dgut-btn">同步服务端</button>
                </div>
            </div>
            <div style="background:#FBEAF9;border:1px solid #E7E0EC;border-radius:14px;padding:12px 14px;font-size:12px;color:#4A4458;line-height:1.8;">
                <b>说明</b>：时长以服务端 KO 视图模型为准并本地累计；满 4h10m 后自动翻页/切下一书。阅读器内页（iframe）由本模块 postMessage 驱动并自动翻页。
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

    /* ==================== 模块 S5: 文档工具（MD 转 Word/PDF + 手绘电子签名） ==================== */

    // ---- Markdown 草稿与签名存储 ----
    function getDocDraft() { return GM_getValue(DOC_DRAFT_KEY, ''); }
    function saveDocDraft(t) { GM_setValue(DOC_DRAFT_KEY, String(t || '')); }
    function getDocTitle() { return GM_getValue(DOC_TITLE_KEY, `文档_${dateKey()}`); }
    function saveDocTitle(t) { GM_setValue(DOC_TITLE_KEY, String(t || '').trim() || `文档_${dateKey()}`); }
    function getSignatures() { return GM_getValue(DOC_SIGN_KEY, []) || []; }
    function addSignature(sig) { const l = getSignatures(); l.push(sig); GM_setValue(DOC_SIGN_KEY, l.slice(-30)); }
    function deleteSignature(id) { GM_setValue(DOC_SIGN_KEY, getSignatures().filter(s => String(s.id) !== String(id))); }

    // ---- Markdown 渲染 ----
    function mdToHtml(md) {
        if (typeof marked === 'undefined') throw new Error('marked 库未加载');
        try { return marked.parse(String(md || '')); }
        catch (e) { throw new Error('Markdown 渲染失败：' + e.message); }
    }

    // ---- 把 HTML 包成 Word 兼容文档（内联样式 + Office XML 命名空间） ----
    function wrapForWord(html, title, signatures = []) {
        const sigImgs = signatures.map(s => `
            <div style="margin-top:14pt;text-align:right;font-size:10pt;color:#49454E;">
                <div>${escapeHtml(s.name || '签名')}</div>
                <img src="${s.dataUrl}" style="width:180px;height:auto;vertical-align:bottom;">
            </div>`).join('');
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
${sigImgs}
</body>
</html>`;
    }

    // ---- 导出 Word（.doc 以 HTML 内容承载，Word/WPS 均可打开） ----
    function exportMdToWord() {
        const md = document.getElementById('dgut-doc-md')?.value || '';
        if (!md.trim()) { showStatus('请先输入 Markdown 内容', true); return; }
        const title = (document.getElementById('dgut-doc-title')?.value || getDocTitle()).trim() || `文档_${dateKey()}`;
        saveDocDraft(md); saveDocTitle(title);
        const sigs = getPickedSignatures();
        let html;
        try { html = mdToHtml(md); }
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

    // ---- 导出 PDF（打开打印视图，用户在打印对话框选择"另存为 PDF"） ----
    function exportMdToPdf() {
        const md = document.getElementById('dgut-doc-md')?.value || '';
        if (!md.trim()) { showStatus('请先输入 Markdown 内容', true); return; }
        const title = (document.getElementById('dgut-doc-title')?.value || getDocTitle()).trim() || `文档_${dateKey()}`;
        saveDocDraft(md); saveDocTitle(title);
        const sigs = getPickedSignatures();
        let html;
        try { html = mdToHtml(md); }
        catch (e) { showStatus(e.message, true); return; }
        const fullHtml = wrapForWord(html, title, sigs);
        const win = window.open('', '_blank');
        if (!win) { showStatus('弹窗被拦截：请允许本站弹窗后重试', true); return; }
        win.document.open();
        win.document.write(fullHtml);
        win.document.close();
        // 等字体/图片就绪再触发打印
        setTimeout(() => { try { win.focus(); win.print(); } catch (e) {} }, 600);
        showStatus('已打开打印视图：在打印对话框中选择"另存为 PDF"');
    }

    // ---- 手绘签名画板 ----
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
        resize();
        // 保留已绘内容（resize 后重绘代价高，此处简单清空——首次调用时画布本来为空）
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
            // 单点也画一个小圆，避免轻点无痕
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

    // 取当前被勾选的签名
    function getPickedSignatures() {
        const picked = Array.from(document.querySelectorAll('.dgut-sig-pick:checked')).map(c => c.dataset.id);
        if (!picked.length) return [];
        const all = getSignatures();
        return all.filter(s => picked.includes(String(s.id)));
    }

    // 渲染签名缩略图列表
    function renderSignatureList() {
        const el = document.getElementById('dgut-sig-list');
        if (!el) return;
        const sigs = getSignatures();
        if (!sigs.length) {
            el.innerHTML = `<div style="font-size:12px;color:#79747E;padding:6px 0;">暂无保存的签名。画完后点「保存签名」。</div>`;
            return;
        }
        el.innerHTML = sigs.slice().reverse().map(s => `
            <div style="border:1px solid #E7E0EC;border-radius:10px;padding:6px;background:#F7F2FA;display:flex;flex-direction:column;gap:4px;width:150px;box-sizing:border-box;">
                <img src="${s.dataUrl}" alt="签名" style="width:100%;height:56px;object-fit:contain;background:#fff;border-radius:6px;">
                <div style="font-size:11px;color:#49454E;display:flex;align-items:center;gap:6px;">
                    <input type="checkbox" class="dgut-sig-pick" data-id="${escapeHtml(String(s.id))}" style="cursor:pointer;">
                    <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(s.name || '')}">${escapeHtml(s.name || '未命名')}</span>
                    <span class="dgut-sig-del" data-id="${escapeHtml(String(s.id))}" title="删除" style="cursor:pointer;color:#B3261E;font-weight:700;font-size:14px;line-height:1;">×</span>
                </div>
            </div>`).join('');
        el.querySelectorAll('.dgut-sig-del').forEach(b => b.onclick = (ev) => {
            ev.stopPropagation();
            if (!confirm('删除此签名？')) return;
            deleteSignature(b.dataset.id);
            renderSignatureList();
        });
    }

    // 渲染文档工具主视图
    function renderDocToolView(ac) {
        const draft = getDocDraft();
        const title = getDocTitle();
        ac.innerHTML = actionHeader(ACTION_TITLES.doc, 'Markdown 转 Word / PDF + 手绘电子签名') + `
            <div style="background:#fff;border:1px solid #E7E0EC;border-radius:14px;padding:16px;margin-bottom:12px;">
                <div style="font-size:13px;font-weight:700;margin-bottom:8px;">${icons.doc} Markdown 内容</div>
                <textarea id="dgut-doc-md" placeholder="在此输入 Markdown 内容…&#10;支持标准语法：# 标题、**粗体**、*斜体*、- 列表、\`代码\`、\`\`\`代码块\`\`\`、> 引用、| 表格 | 等。" style="width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid #CAC4D0;background:#F3EDF7;font-family:Consolas,monospace;font-size:12px;line-height:1.6;min-height:180px;resize:vertical;outline:none;">${escapeHtml(draft)}</textarea>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center;">
                    <input id="dgut-doc-title" placeholder="文件名" value="${escapeHtml(title)}" style="flex:1;min-width:140px;padding:8px 10px;border-radius:10px;border:1px solid #CAC4D0;background:#F3EDF7;font-size:12px;outline:none;">
                    <button id="dgut-doc-preview" class="dgut-btn">${icons.list} 预览</button>
                    <button id="dgut-doc-word" class="dgut-btn dgut-btn-primary">${icons.export} 导出 Word</button>
                    <button id="dgut-doc-pdf" class="dgut-btn dgut-btn-primary">导出 PDF</button>
                    <button id="dgut-doc-clear" class="dgut-btn">清空</button>
                </div>
                <div id="dgut-doc-preview-box" style="display:none;margin-top:10px;padding:12px 14px;background:#F7F2FA;border-radius:10px;font-size:13px;line-height:1.7;max-height:340px;overflow:auto;border:1px solid #E7E0EC;"></div>
            </div>
            <div style="background:#fff;border:1px solid #E7E0EC;border-radius:14px;padding:16px;margin-bottom:12px;">
                <div style="font-size:13px;font-weight:700;margin-bottom:6px;">${icons.sign2} 手绘电子签名</div>
                <div style="font-size:11px;color:#79747E;margin-bottom:8px;line-height:1.7;">在下方画板手写签名（支持鼠标/触屏/触控笔）。保存后勾选需要附加到导出文档末尾的签名。签名以透明 PNG 形式嵌入 Word/PDF。</div>
                <input id="dgut-sig-name" placeholder="签名标签（如：本人签名、导师签字）" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:10px;border:1px solid #CAC4D0;background:#F3EDF7;font-size:12px;margin-bottom:8px;outline:none;">
                <canvas id="dgut-sig-canvas" style="width:100%;height:180px;background:#fff;border:2px dashed #CAC4D0;border-radius:10px;touch-action:none;display:block;cursor:crosshair;box-sizing:border-box;"></canvas>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;justify-content:flex-end;">
                    <button id="dgut-sig-clear" class="dgut-btn">清除画布</button>
                    <button id="dgut-sig-save" class="dgut-btn dgut-btn-primary">${icons.add} 保存签名</button>
                </div>
                <div style="font-size:12px;color:#49454E;font-weight:600;margin:14px 0 6px;">已保存签名（勾选=附加到导出文档）</div>
                <div id="dgut-sig-list" style="display:flex;gap:10px;flex-wrap:wrap;"></div>
            </div>
            <div style="background:#FBEAF9;border:1px solid #E7E0EC;border-radius:14px;padding:12px 14px;font-size:12px;color:#4A4458;line-height:1.8;">
                <b>导出说明</b>：<br>
                · <b>Word</b>：生成 <code>.doc</code>（HTML 内容承载），Word / WPS 可直接打开与二次编辑；<br>
                · <b>PDF</b>：打开打印视图，在打印对话框中选择"另存为 PDF"即可；<br>
                · 所有处理均在浏览器本地完成，内容不上传任何服务器。
            </div>`;
        const mdEl = ac.querySelector('#dgut-doc-md');
        const titleEl = ac.querySelector('#dgut-doc-title');
        const previewBox = ac.querySelector('#dgut-doc-preview-box');
        const pad = createSignaturePad(ac.querySelector('#dgut-sig-canvas'));
        // 记录草稿
        mdEl.addEventListener('input', () => saveDocDraft(mdEl.value));
        titleEl.addEventListener('input', () => saveDocTitle(titleEl.value));
        // 预览
        ac.querySelector('#dgut-doc-preview').onclick = () => {
            const md = mdEl.value;
            if (!md.trim()) { showStatus('请先输入 Markdown 内容', true); return; }
            try {
                const html = mdToHtml(md);
                previewBox.style.display = 'block';
                previewBox.innerHTML = html;
            } catch (e) { showStatus(e.message, true); }
        };
        ac.querySelector('#dgut-doc-word').onclick = exportMdToWord;
        ac.querySelector('#dgut-doc-pdf').onclick = exportMdToPdf;
        ac.querySelector('#dgut-doc-clear').onclick = () => {
            if (!confirm('清空 Markdown 内容？此操作不可撤销。')) return;
            mdEl.value = '';
            saveDocDraft('');
            previewBox.style.display = 'none';
            previewBox.innerHTML = '';
        };
        // 签名
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

    /* ==================== 模块 8: 主面板 UI（PC 适配 + 悬浮迷你面板） ==================== */
    let gActionName = null;
    const ACTION_TITLES = {
        sign: '优学院课程签到',
        course: '优学院刷课助手',
        peer: '作业互评记录',
        read: '求是读书',
        doc: '文档工具（MD→Word/PDF + 电子签名）',
        appearance: '外观设置',
        about: '关于与帮助'
    };

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
    function actionHeader(title, hint) {
        return `<div style="margin-bottom:14px;">
            <div style="font-size:15px;font-weight:700;color:var(--dgut-on-surface,#1D1B20);line-height:1.3;">${title}</div>
            ${hint ? `<div style="font-size:11px;color:var(--dgut-on-surface-variant,#49454E);margin-top:2px;">${hint}</div>` : ''}
        </div>`;
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
            case 'appearance': renderAppearanceView(ac); break;
            case 'about': renderAboutView(ac); break;
            default: renderAboutView(ac);
        }
    }

    // ---------- 外观设置页 ----------
    function renderAppearanceView(ac) {
        const mode = GM_getValue(THEME_MODE_KEY, 'auto');
        const accent = GM_getValue(ACCENT_KEY, 'purple');
        const swatches = Object.entries(ACCENTS).map(([id, a]) => `
            <button class="dgut-accent" data-id="${id}" title="${a.name}" style="width:34px;height:34px;border-radius:50%;border:3px solid ${accent === id ? '#1D1B20' : 'transparent'};background:${a.primary};cursor:pointer;box-sizing:border-box;"></button>`).join('');
        ac.innerHTML = actionHeader(ACTION_TITLES.appearance, '亮/暗/跟随系统 + 主体色') + `
            <div style="background:#fff;border:1px solid #E7E0EC;border-radius:14px;padding:16px;margin-bottom:12px;">
                <div style="font-size:13px;font-weight:700;margin-bottom:10px;">主题模式</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${[['light', '亮色'], ['dark', '暗色'], ['auto', '跟随系统']].map(([v, label]) => `
                        <button class="dgut-mode" data-mode="${v}" style="padding:8px 16px;border-radius:999px;border:1px solid ${mode === v ? 'var(--dgut-primary,#6750A4)' : '#CAC4D0'};background:${mode === v ? 'var(--dgut-primary-container,#E8DEF8)' : '#F3EDF7'};color:#1D1B20;font-size:13px;font-weight:600;cursor:pointer;">${label}</button>`).join('')}
                </div>
            </div>
            <div style="background:#fff;border:1px solid #E7E0EC;border-radius:14px;padding:16px;margin-bottom:12px;">
                <div style="font-size:13px;font-weight:700;margin-bottom:10px;">主体色</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">${swatches}</div>
                <div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                    <span style="font-size:12px;color:#49454E;">自定义颜色</span>
                    <input type="color" id="dgut-accent-custom" value="${/^#([0-9a-f]{6})$/i.test(accent) ? accent : '#6750A4'}" style="width:46px;height:32px;border:1px solid #CAC4D0;border-radius:8px;background:#F3EDF7;cursor:pointer;">
                    <button id="dgut-accent-apply" class="dgut-btn">应用自定义色</button>
                    <span style="font-size:11px;color:#79747E;">当前：${escapeHtml(accentOf(accent).name)}</span>
                </div>
            </div>
            <div style="background:#FBEAF9;border:1px solid #E7E0EC;border-radius:14px;padding:12px 14px;font-size:12px;color:#4A4458;line-height:1.8;">
                主题作用于主面板与悬浮面板；选择「跟随系统」后会随操作系统的深色模式自动切换。
            </div>`;
        ac.querySelectorAll('.dgut-mode').forEach(b => b.onclick = () => { GM_setValue(THEME_MODE_KEY, b.dataset.mode); applyTheme(); renderAppearanceView(ac); showStatus('主题模式已更新'); });
        ac.querySelectorAll('.dgut-accent').forEach(b => b.onclick = () => { GM_setValue(ACCENT_KEY, b.dataset.id); applyTheme(); renderAppearanceView(ac); showStatus('主体色已更新'); });
        ac.querySelector('#dgut-accent-apply').onclick = () => {
            const v = ac.querySelector('#dgut-accent-custom').value;
            if (/^#[0-9a-f]{6}$/i.test(v)) { GM_setValue(ACCENT_KEY, v); applyTheme(); renderAppearanceView(ac); showStatus('已应用自定义主体色'); }
        };
    }

    // ---------- 关于与帮助页 ----------
    const ABOUT_VERSION = 'v5.0.1';
    function renderAboutView(ac) {
        const code = (s) => `<span style="font-family:Consolas,monospace;background:#F3EDF7;padding:1px 5px;border-radius:4px;font-size:11px;color:#6750A4;">${s}</span>`;
        ac.innerHTML = actionHeader(ACTION_TITLES.about) + `
            <div style="background:#fff;border:1px solid #E7E0EC;border-radius:14px;padding:16px;margin-bottom:12px;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <svg viewBox="0 0 24 24" width="40" height="40" style="fill:#6750A4;flex:none;"><path d="M12 3 1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/></svg>
                    <div>
                        <div style="font-size:16px;font-weight:700;">优学院助手 + 文档工具</div>
                        <div style="font-size:12px;color:#49454E;">课程签到 / 刷课助手 / 作业互评 / 求是读书 / MD 转 Word·PDF / 电子签名 &nbsp;·&nbsp; ${ABOUT_VERSION}</div>
                    </div>
                </div>
                <p style="margin:10px 0 0;font-size:12px;color:#49454E;line-height:1.7;">面向东莞理工学院优学院平台的浏览器增强脚本：读取课程、轮询当日课堂活动并自动签到；课件页倍速守卫与自动答题、题库收集；作业互评记录去匿名化汇总；求是读书时长统计与自动翻页。另附文档工具：Markdown 一键转 Word/PDF、手绘电子签名。作者 <b>BrocadeHutHost</b> · 开源许可 <b>AGPL-3.0-only</b>。</p>
            </div>
            <div style="background:#fff;border:1px solid #E7E0EC;border-radius:14px;padding:16px;margin-bottom:12px;">
                <div style="font-size:13px;font-weight:700;margin-bottom:8px;">开源许可 · AGPL-3.0-only（最严格的开源协议）</div>
                <div style="font-size:12px;color:#49454E;line-height:1.8;">
                    本脚本以 GNU Affero General Public License v3.0 发布。核心义务：<br>
                    ① 强传染性 copyleft：任何修改版/衍生版都必须以同样协议开源；<br>
                    ② 网络服务条款：即使仅通过网络向用户提供本脚本（含修改版），也必须向使用者提供完整源代码；<br>
                    ③ 专利授权：贡献者自动授予专利许可；<br>
                    ④ 无担保：软件按"原样"提供，作者不承担任何使用后果。<br>
                    违反上述条款将自动终止授权。完整条款见 https://www.gnu.org/licenses/agpl-3.0.html
                </div>
            </div>
            <div style="background:#fff;border:1px solid #E7E0EC;border-radius:14px;padding:16px;margin-bottom:12px;">
                <div style="font-size:13px;font-weight:700;margin-bottom:8px;">功能说明</div>
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <tr><td style="padding:5px 8px;border-bottom:1px solid #F0EBF5;white-space:nowrap;color:#6750A4;font-weight:600;">课程签到</td><td style="padding:5px 8px;border-bottom:1px solid #F0EBF5;color:#49454E;">读取课程、轮询当日课堂活动并自动签到（数字码/一键签到可直接完成；二维码签到仅当活动数据自带签到码时处理）</td></tr>
                    <tr><td style="padding:5px 8px;border-bottom:1px solid #F0EBF5;white-space:nowrap;color:#6750A4;font-weight:600;">刷课助手</td><td style="padding:5px 8px;border-bottom:1px solid #F0EBF5;color:#49454E;">倍速守卫、自动答题（视图模型/题库/接口三种答案源）、弹窗处理、自动翻页、题库收集导出</td></tr>
                    <tr><td style="padding:5px 8px;border-bottom:1px solid #F0EBF5;white-space:nowrap;color:#6750A4;font-weight:600;">作业互评</td><td style="padding:5px 8px;border-bottom:1px solid #F0EBF5;color:#49454E;">读取互评接口、去匿名化评价人、记录汇总与筛选</td></tr>
                    <tr><td style="padding:5px 8px;border-bottom:1px solid #F0EBF5;white-space:nowrap;color:#6750A4;font-weight:600;">求是读书</td><td style="padding:5px 8px;border-bottom:1px solid #F0EBF5;color:#49454E;">服务端时长同步、满 4h10m 自动翻页/切书、阅读器 iframe 自动翻页</td></tr>
                    <tr><td style="padding:5px 8px;border-bottom:1px solid #F0EBF5;white-space:nowrap;color:#6750A4;font-weight:600;">文档工具</td><td style="padding:5px 8px;border-bottom:1px solid #F0EBF5;color:#49454E;">Markdown 转 Word（.doc）/ PDF（打印视图）；手绘电子签名，可附加到导出文档末尾</td></tr>
                    <tr><td style="padding:5px 8px;border-bottom:1px solid #F0EBF5;white-space:nowrap;color:#6750A4;font-weight:600;">外观设置</td><td style="padding:5px 8px;border-bottom:1px solid #F0EBF5;color:#49454E;">主题模式（亮色/暗色/跟随系统）与主体色（预设 + 自定义）</td></tr>
                </table>
            </div>
            <div style="background:#FBEAF9;border:1px solid #E7E0EC;border-radius:14px;padding:14px 16px;font-size:12px;color:#4A4458;line-height:1.8;">
                <b>说明与提示</b>：本脚本会请求 ${code('lms.dgut.edu.cn')}、${code('application.dgut.edu.cn')}、${code('ua.dgut.edu.cn')} 等优学院域名下的接口。签到不识别教室现场二维码图片（二维码签到仅当活动数据自带签到码时才处理）；刷课自动答题的未知题型一律跳过，平台测验多为"限答1次"；脚本仅申请通知权限用于本地提醒，文档工具的全部处理均在浏览器本地完成。
            </div>`;
    }

    function createPanel() {
        if (document.getElementById('dgut-main-panel')) return;
        const pos = GM_getValue(UI_POS_KEY, null);
        const panel = document.createElement('div');
        panel.id = 'dgut-main-panel';
        panel.style.cssText = `position:fixed;z-index:2147483000;width:780px;max-width:98vw;background:var(--dgut-surface,#FEF7FF);color:var(--dgut-on-surface,#1D1B20);border-radius:16px;box-shadow:0 8px 30px rgba(29,27,32,.18);font-family:var(--dgut-font,"Segoe UI",Roboto,sans-serif);overflow:hidden;border:1px solid var(--dgut-outline-variant,#E7E0EC);`;
        if (pos && pos.left !== undefined) {
            const pw = panel.offsetWidth || 780, ph = panel.offsetHeight || 600;
            panel.style.left = Math.max(0, Math.min(Math.max(0, window.innerWidth - pw), pos.left)) + 'px';
            panel.style.top = Math.max(0, Math.min(Math.max(0, window.innerHeight - ph), pos.top)) + 'px';
        } else { panel.style.right = '16px'; panel.style.bottom = '16px'; }
        panel.innerHTML = `
            <div id="dgut-panel-header" style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--dgut-primary,#6750A4);cursor:move;user-select:none;">
                <svg viewBox="0 0 24 24" width="22" height="22" style="fill:#fff;flex:none;"><path d="M12 3 1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/></svg>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:14px;font-weight:700;color:#fff;line-height:1.25;">优学院助手 + 文档工具</div>
                </div>
                <button id="dgut-panel-close" title="收起为悬浮面板" style="border:none;background:rgba(255,255,255,.18);color:#fff;width:30px;height:30px;border-radius:50%;font-size:17px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;transition:background .15s;">×</button>
            </div>
            <div style="display:flex;flex:1;min-height:0;">
                <div id="dgut-sidebar" style="width:158px;flex:none;background:var(--dgut-surface-2,#F7F2FA);border-right:1px solid var(--dgut-outline-variant,#E7E0EC);padding:10px 8px;display:flex;flex-direction:column;gap:2px;overflow-y:auto;">
                    <div class="dgut-nav-label">优学院</div>
                    <button class="dgut-nav" data-action="sign">${icons.sign} 课程签到</button>
                    <button class="dgut-nav" data-action="course">${icons.course} 刷课助手</button>
                    <button class="dgut-nav" data-action="peer">${icons.peer} 作业互评</button>
                    <button class="dgut-nav" data-action="read">${icons.read} 求是读书</button>
                    <div class="dgut-nav-label">工具</div>
                    <button class="dgut-nav" data-action="doc">${icons.doc} 文档工具</button>
                    <button class="dgut-nav" data-action="appearance">${icons.theme} 外观设置</button>
                    <button class="dgut-nav" data-action="about">${icons.settings} 关于/帮助</button>
                    <div style="flex:1;"></div>
                    <div style="font-size:10px;color:var(--dgut-on-surface-variant,#49454E);text-align:center;padding:6px 0;opacity:.7;">${ABOUT_VERSION}</div>
                </div>
                <div style="flex:1;min-width:0;display:flex;flex-direction:column;background:var(--dgut-surface,#FEF7FF);">
                    <div id="dgut-panel-body" style="flex:1;overflow-y:auto;padding:10px 12px;max-height:72vh;">
                        <div id="dgut-action-container"></div>
                    </div>
                    <div id="dgut-status-bar" style="padding:6px 12px;font-size:11px;border-top:1px solid var(--dgut-outline-variant,#E7E0EC);background:var(--dgut-surface-2,#F7F2FA);color:var(--dgut-on-surface-variant,#49454E);"></div>
                </div>
            </div>`;
        document.body.appendChild(panel);
        const header = panel.querySelector('#dgut-panel-header');
        let drag = null;
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('#dgut-panel-close')) return;
            const rect = panel.getBoundingClientRect();
            drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
            panel.style.right = 'auto'; panel.style.bottom = 'auto';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!drag) return;
            const pw = panel.offsetWidth || 780, ph = panel.offsetHeight || 600;
            const maxX = Math.max(0, window.innerWidth - pw);
            const maxY = Math.max(0, window.innerHeight - Math.min(ph, 120));
            panel.style.left = Math.max(0, Math.min(maxX, e.clientX - drag.dx)) + 'px';
            panel.style.top = Math.max(0, Math.min(maxY, e.clientY - drag.dy)) + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (!drag) return;
            drag = null;
            const rect = panel.getBoundingClientRect();
            GM_setValue(UI_POS_KEY, { left: rect.left, top: rect.top });
        });
        panel.querySelector('#dgut-panel-close').onclick = () => togglePanel();
        panel.querySelectorAll('.dgut-nav[data-action]').forEach(t => t.onclick = () => {
            GM_setValue(VIEW_MODE_KEY, t.dataset.action);
            gActionName = t.dataset.action;
            panel.querySelectorAll('.dgut-nav').forEach(x => x.classList.remove('dgut-tab-active'));
            t.classList.add('dgut-tab-active');
            renderActionView(t.dataset.action);
        });
        // 初始视图
        const mode = GM_getValue(VIEW_MODE_KEY, 'sign');
        gActionName = mode;
        panel.querySelectorAll('.dgut-nav').forEach(x => x.classList.toggle('dgut-tab-active', x.dataset.action === mode));
        renderActionView(mode);
    }

    const MINI_ICON_SVG = `<svg viewBox="0 0 24 24" width="44" height="44" fill="none"><circle cx="12" cy="12" r="9" stroke="#6750A4" stroke-width="1.8" fill="none"/><path d="M7 12.5l3.2 3.2L17 9" stroke="#6750A4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;

    function createMiniPanel() {
        if (document.getElementById('dgut-mini-panel')) return;
        const pos = GM_getValue(FAB_POS_KEY, null);
        const mini = document.createElement('div');
        mini.id = 'dgut-mini-panel';
        mini.title = '打开优学院助手';
        mini.style.cssText = `position:fixed;z-index:2147483001;width:80px;height:80px;border-radius:18px;background:#FEF7FF;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 10px rgba(103,80,164,.2);user-select:none;border:2px solid #E8DEF8;transition:box-shadow .2s,transform .2s;`;
        if (pos && pos.left !== undefined) {
            mini.style.left = Math.max(0, Math.min(Math.max(0, window.innerWidth - 80), pos.left)) + 'px';
            mini.style.top = Math.max(0, Math.min(Math.max(0, window.innerHeight - 80), pos.top)) + 'px';
        } else { mini.style.right = '20px'; mini.style.bottom = '20px'; }
        mini.innerHTML = MINI_ICON_SVG;
        document.body.appendChild(mini);
        mini.addEventListener('mouseenter', () => { mini.style.boxShadow = '0 3px 14px rgba(103,80,164,.35)'; mini.style.transform = 'scale(1.06)'; });
        mini.addEventListener('mouseleave', () => { mini.style.boxShadow = '0 2px 10px rgba(103,80,164,.2)'; mini.style.transform = 'scale(1)'; });
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
        if (!existing) {
            GM_setValue(PANEL_OPEN_KEY, true);
            createPanel();
        }
    }

    function resetPanelPositions() {
        GM_setValue(UI_POS_KEY, null);
        GM_setValue(FAB_POS_KEY, null);
        document.getElementById('dgut-main-panel')?.remove();
        document.getElementById('dgut-mini-panel')?.remove();
        createMiniPanel();
        if (GM_getValue(PANEL_OPEN_KEY, false)) createPanel();
        showToastCard(`${KAO.ok} 位置已重置`, '面板与悬浮面板位置已恢复默认（右下角）。', '', 4000);
    }

    /* ==================== 初始化 ==================== */
    function init() {
        initThemeWatcher();
        GM_registerMenuCommand('打开/关闭主面板', () => togglePanel());
        GM_registerMenuCommand('重置面板/悬浮面板位置', resetPanelPositions);
        GM_registerMenuCommand('优学院课程签到', () => openActionView('sign'));
        GM_registerMenuCommand('优学院刷课助手', () => openActionView('course'));
        GM_registerMenuCommand('作业互评记录', () => openActionView('peer'));
        GM_registerMenuCommand('求是读书', () => openActionView('read'));
        GM_registerMenuCommand('文档工具（MD→Word/PDF + 电子签名）', () => openActionView('doc'));
        GM_registerMenuCommand('外观设置（主题/主体色）', () => openActionView('appearance'));

        // 全局常驻悬浮面板；若此前面板为展开状态则恢复，避免刷新后"不见"
        createMiniPanel();
        if (GM_getValue(PANEL_OPEN_KEY, false)) createPanel();
    }
    init();
})();
