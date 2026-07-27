// ==UserScript==
// @name         DGUT 优学院自动学习与题库助手
// @namespace    https://github.com/BrocadeHutHost/DGUT-ULearningTakeQuizzesAssistant
// @version      0.2.4
// @description  Ulearning/DGUT 自动化学习助手：支持视频倍速、自动答题、题库查询与 Word 导出。
// @author       锦廑主人
// @match        https://utest.ulearning.cn/*
// @match        https://*.ulearning.cn/*/homework.do*
// @match        https://homework.ulearning.cn/*
// @match        *://*.dgut.edu.cn/learnCourse/*
// @match        *://*.ulearning.cn/learnCourse/*
// @require      https://code.jquery.com/jquery-1.12.4.min.js
// @grant        unsafeWindow
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      tk.fm90.cn
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";
    
    if (window.top !== window.self) return;

    const $w = unsafeWindow;
    const $ = unsafeWindow.jQuery;
    const jquery = jQuery.noConflict();
    const $version = GM_info.script.version.replaceAll('.','');
    const set = {
        get_answer: "https://tk.fm90.cn/fuck/cha.php",
        upload_data: "https://tk.fm90.cn/fuck/upload.php",
        heartbeat: "https://tk.fm90.cn/fuck/server.php",
        Dealagging: false,
        left: 0,
        top: 0,
        token: "",
        timestamp: -1,
    };
    
    var answer_table2 = generateRandomString(6);
    var debug_box_id = generateRandomString(6);
    const BANK_STORAGE_KEY = "ulearn_question_bank_auto_v1";
    const THEME_KEY = 'dgut_m3_theme';
    const DEBUG = { enabled: true, lines: [], maxLines: 200 };

    function generateRandomString(length) {
        let str = '';
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        for (let i = 0; i < length; i++) str += chars.charAt(Math.floor(Math.random() * chars.length));
        return str;
    }

    const originalQuerySelectorAll = document.querySelectorAll;
    Object.defineProperty(document, 'querySelectorAll', {
        get() { return originalQuerySelectorAll; },
        set() { throw new Error('Security Error: Overriding native querySelectorAll is prohibited.'); }
    });

    function debugLog(tag, message, detail) {
        if (!DEBUG.enabled) return;
        const ts = new Date().toLocaleTimeString();
        let line = `[${ts}][${tag}] ${message}`;
        if (detail !== undefined) {
            try { line += " | " + (typeof detail === "string" ? detail : JSON.stringify(detail)); } 
            catch (e) { line += " | [detail stringify failed]"; }
        }
        DEBUG.lines.push(line);
        if (DEBUG.lines.length > DEBUG.maxLines) DEBUG.lines.shift();
        console.log("[UlearnDebug]", line);
        
        const box = document.querySelector("#" + debug_box_id);
        if (box) {
            const l = document.createElement('div');
            l.className = 'md-log-line';
            l.innerHTML = `<span style="opacity:0.5">[${ts}][${tag}]</span> ${message} ${detail ? JSON.stringify(detail) : ''}`;
            box.appendChild(l);
            box.scrollTop = box.scrollHeight;
            while(box.children.length > 100) box.removeChild(box.firstChild);
        }
    }

    window.addEventListener("error", function (e) { debugLog("GlobalError", e.message || "unknown error", { source: e.filename, line: e.lineno }); });
    window.addEventListener("unhandledrejection", function (e) { debugLog("UnhandledRejection", "promise rejected", e && e.reason ? e.reason : "unknown"); });

    class Deal {
        constructor() { this.text = ""; this.data = []; }
        append(k, v) { this.data.push(encodeURIComponent(k) + "=" + encodeURIComponent(v)); this.text = this.data.join("&").replace(/%20/g, "+"); }
    }

    const Util = {
        post_form: function (url, data, onload, onerror) { Util.post(url, data, onload, onerror, { "Content-Type": "application/x-www-form-urlencoded" }); },
        post: function (url, data, onload, onerror, headers) {
            let data_form = new Deal(); for (let value in data) data_form.append(value, data[value]);
            GM_xmlhttpRequest({ method: "POST", url, headers, data: data_form.text, onload, onerror });
        },
        get: function (url, data, onload, onerror) {
            let data_form = new Deal(); for (let value in data) data_form.append(value, data[value]);
            GM_xmlhttpRequest({ method: "GET", url: url + "?" + data_form.text, onload, onerror });
        },
        upload_api: function (data, send) {
            if (set.token == -1) { setTimeout(Util.upload_api, 1000, data, true); if (send === true) return; }
            Util.post_form(set.upload_data, { token: "" + set.token, data: JSON.stringify(data) });
        },
        upload_paper: function (paper, pid, eid) { Util.upload_api({ op: 4, eid, pid, paper }); },
        upload_answer: function (answer, pid, eid) { Util.upload_api({ op: 5, eid, pid, answer }); },
        upload_title: function (title, quetype, quetxt) { Util.upload_api({ op: 6, type: quetype, title, cont: quetxt }); },
        get_answer: function (question, quetype, td, $ans, kinds) {
            return new Promise((resolve) => {
                debugLog("QueryStart", "开始查询答案", { type: quetype, title: String(question).slice(0, 80), kind: kinds });
                let data_form = new Deal(); let datas = { question, type: quetype };
                for (let value in datas) data_form.append(value, datas[value]);
                GM_xmlhttpRequest({
                    method: "GET",
                    url: set.get_answer + "?" + data_form.text + "&token=" + set.token,
                    onload: function (r) {
                        if (r.status == 200) {
                            try {
                                let data = JSON.parse(r.responseText);
                                if (data.code == 1) {
                                    debugLog("QueryOK", "命中答案", { type: quetype, kind: kinds });
                                    td.innerText = data.data[0].answer;
                                    td.addEventListener("click", function () { GM_setClipboard(data.data[0].answer); });
                                    if($ans && kinds=="exam") respondentExam._answer(data.data[0].answer,$ans);
                                    if($ans && kinds=="homework") respondentHomeWork._answer(data.data[0].answer,$ans);
                                    resolve(1); return;
                                } else if (data.code == 0) {
                                    debugLog("QueryMiss", "题库未命中，等待回传", { type: quetype, kind: kinds });
                                    td.innerText = "未命中(已回传)";
                                    resolve(0); return;
                                }
                                debugLog("QueryBadCode", "返回码异常", data);
                                td.innerText = "查询异常(E1002)";
                                resolve(-1); return;
                            } catch (e) {
                                debugLog("QueryParseError", "响应解析失败", e && e.message ? e.message : e);
                                td.innerText = "解析失败(E1003)";
                                resolve(-1); return;
                            }
                        }
                        debugLog("QueryHttpError", "HTTP状态异常", { status: r.status });
                        td.innerText = "服务器错误(E500)";
                        resolve(-1);
                    },
                    onerror: function (e) {
                        debugLog("QueryNetworkError", "网络异常", e && e.error ? e.error : "unknown");
                        td.innerText = "网络\n(っ °Д °;)っ\n异常(E403)";
                        resolve(-1);
                    }
                });
            })
        },
    };

    // 倍速守卫模块
    const rateGuard = {
        targetRate: 6.0,
        active: false,
        resetHistory: [],          // 页面尝试重置倍速的时间戳记录
        learnedInterval: 600,      // 学习到的页面重置周期
        enforcementTimer: null,    // 自学习强制刷新定时器
        hookedVideos: new WeakSet(),
        nativeDescriptor: null,

        init() {
            const rateInput = document.getElementById("rate");
            this.targetRate = rateInput ? (parseFloat(rateInput.value) || 6.0) : 6.0;
            try {
                this.nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate')
                    || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(document.createElement('video')), 'playbackRate');
            } catch (e) { this.nativeDescriptor = null; }
        },

        start() {
            this.init();
            this.active = true;
            this.resetHistory = [];
            this.hookAllVideos();
            this.scheduleNextEnforcement();
            debugLog("RateGuard", "倍速守卫已启动", { target: this.targetRate, interval: this.learnedInterval });
        },

        stop() {
            this.active = false;
            if (this.enforcementTimer) { clearTimeout(this.enforcementTimer); this.enforcementTimer = null; }
            debugLog("RateGuard", "倍速守卫已停止");
        },

        refreshTarget() {
            const rateInput = document.getElementById("rate");
            if (rateInput) this.targetRate = parseFloat(rateInput.value) || 6.0;
        },

        getNativeRate(v) {
            if (this.nativeDescriptor && this.nativeDescriptor.get) return this.nativeDescriptor.get.call(v);
            return v.playbackRate;
        },

        setNativeRate(v, rate) {
            if (this.nativeDescriptor && this.nativeDescriptor.set) this.nativeDescriptor.set.call(v, rate);
            else v.playbackRate = rate;
        },

        hookAllVideos() {
            document.querySelectorAll("video").forEach(v => this.hookVideo(v));
        },

        hookVideo(v) {
            if (this.hookedVideos.has(v)) return;
            this.hookedVideos.add(v);

            try {
                if (!this.nativeDescriptor) return;
                const self = this;
                Object.defineProperty(v, 'playbackRate', {
                    get() { return self.nativeDescriptor.get.call(this); },
                    set(val) {
                        if (self.active && Math.abs(val - self.targetRate) > 0.01) {
                            // 页面尝试重置倍速 —— 先让它重置（放行），然后立刻在之后重置回来
                            self.recordReset(Date.now(), val);
                            self.nativeDescriptor.set.call(this, val);
                            // 异步立即重置（在他重置之后重置）
                            Promise.resolve().then(() => {
                                self.nativeDescriptor.set.call(this, self.targetRate);
                                self.updateSpeedButton(v);
                            });
                        } else {
                            self.nativeDescriptor.set.call(this, val);
                        }
                    },
                    configurable: true,
                    enumerable: true
                });
            } catch (e) { debugLog("RateGuard", "setter 重写失败", e.message); }

            // 兜底事件
            v.addEventListener('ratechange', () => {
                if (!this.active) return;
                const cur = this.getNativeRate(v);
                if (Math.abs(cur - this.targetRate) > 0.01) {
                    this.recordReset(Date.now(), cur);
                    this.setNativeRate(v, this.targetRate);
                    this.updateSpeedButton(v);
                }
            });
        },

        recordReset(timestamp, fromVal) {
            this.resetHistory.push(timestamp);
            if (this.resetHistory.length > 20) this.resetHistory.shift();
            if (this.resetHistory.length >= 3) {
                const intervals = [];
                for (let i = 1; i < this.resetHistory.length; i++) {
                    intervals.push(this.resetHistory[i] - this.resetHistory[i - 1]);
                }
                intervals.sort((a, b) => a - b);
                const median = intervals[Math.floor(intervals.length / 2)];
                if (median > 100 && median < 30000) {
                    this.learnedInterval = Math.min(800, Math.max(200, median - 50));
                }
            }
        },

        updateSpeedButton(v) {
            const videos = document.querySelectorAll("video");
            const idx = Array.from(videos).indexOf(v);
            if (idx === -1) return;
            const speedBtn = $('.mejs__button.mejs__speed-button button').eq(idx);
            if (speedBtn.length > 0 && speedBtn.text() !== this.targetRate + 'x') {
                speedBtn.text(this.targetRate + 'x');
            }
        },

        scheduleNextEnforcement() {
            if (!this.active) return;
            const delay = this.learnedInterval;
            this.enforcementTimer = setTimeout(() => {
                this.enforce();
                this.scheduleNextEnforcement();
            }, delay);
        },

        enforce() {
            if (!this.active) return;
            this.refreshTarget();
            this.hookAllVideos();
            document.querySelectorAll("video").forEach(v => {
                const cur = this.getNativeRate(v);
                if (Math.abs(cur - this.targetRate) > 0.01) {
                    this.setNativeRate(v, this.targetRate);
                    this.updateSpeedButton(v);
                }
            });
        }
    };

    const youxueyuan = {
        $startBtn: null, $stopBtn: null, $rateText: null, timer: null, 
        questionTaskUntil: 0, pendingTimeouts: [],
        _schedule(fn, delay) { const id = setTimeout(() => { try { fn(); } finally { this.pendingTimeouts = this.pendingTimeouts.filter(x => x !== id); } }, delay); this.pendingTimeouts.push(id); return id; },
        _clearPending() { this.pendingTimeouts.forEach(clearTimeout); this.pendingTimeouts = []; },
        init() {
            $('#video_controls_section').show();
            this.$startBtn = $('#btn-video-start'); this.$stopBtn = $('#btn-video-stop'); this.$rateText = $('#rate');
            this.$stopBtn.hide(); this.bindEvent();
        },
        bindEvent() {
            this.$startBtn.click(() => {
                if (this.timer) clearInterval(this.timer); this._clearPending();
                rateGuard.start();
                try { this.logic(); } catch (e) { debugLog("VideoError", "启动时执行失败", e.message); }
                this.timer = setInterval(() => { try { this.logic(); } catch (e) { debugLog("VideoError", "循环执行失败", e.message); } }, 1500);
                this.$startBtn.hide(); this.$stopBtn.show();
            });
            this.$stopBtn.click(() => {
                rateGuard.stop();
                clearInterval(this.timer); this._clearPending(); this.$stopBtn.hide(); this.$startBtn.show();
                if ($("video").length > 0) {
                    let $allVideos = $("video");
                    for (let i = 0; i < $allVideos.length; i++) {
                        $allVideos.get(i).pause();
                    }
                }
            });
            document.getElementById("rate")?.addEventListener("input", () => {
                rateGuard.refreshTarget();
                if (rateGuard.active) rateGuard.enforce();
            });
        },
        logic() {
            if ($('.modal.fade.in').length > 0) {
                switch ($('.modal.fade.in').attr('id')) {
                    case 'statModal': $("#statModal .btn-hollow").eq(-1).click(); break;
                    case 'alertModal': $("#alertModal .btn-hollow").length > 0 ? $("#alertModal .btn-hollow").eq(-1).click() : $("#alertModal .btn-submit").click(); break;
                }
                return;
            }
            if ($('.question-setting-panel').length > 0) {
                if (Date.now() < this.questionTaskUntil) return;
                this._clearPending();
                let parentIdAttr = $('.page-name.active').parent().attr('id');
                if (!parentIdAttr || parentIdAttr.length < 5) return;
                let parentId = parentIdAttr.substring(4);
                let $questions = $('.question-element-node');
                collectCurrentPageToBank();
                let totalDelay = 0, hasModelSubmitPlan = false;
                for (let i = 0; i < $questions.length; i++) {
                    let $q = $questions.eq(i);
                    let qDelay = respondent._answer(parentId, $q) || 0;
                    totalDelay += qDelay + 180;
                    let $btn = $q.find('.question-operation-wrapper .btn-submit').first();
                    let qidAttr = $q.find('.question-wrapper').attr('id') || "";
                    let qid = qidAttr.startsWith("question") ? qidAttr.substring(8) : qidAttr;
                    const compVmNow = getQuestionComponentVM($q);
                    const qModelNow = findQuestionModelByIdFromGlobal(qid);
                    if ((compVmNow && typeof compVmNow.submitQuestion === "function") || (qModelNow && qModelNow.koModel && typeof qModelNow.koModel.submitQuestion === "function")) hasModelSubmitPlan = true;
                    if ($btn.length > 0) {
                        this._schedule(() => {
                            const compVm = getQuestionComponentVM($q);
                            if (compVm && typeof compVm.submitQuestion === "function") { compVm.submitQuestion(); return; }
                            const qModel = findQuestionModelByIdFromGlobal(qid);
                            if (qModel && qModel.koModel && typeof qModel.koModel.submitQuestion === "function") {
                                try { if (typeof qModel.type === "function" && typeof qModel.answer === "function" && typeof qModel.choices === "function") {
                                    const qType = qModel.type();
                                    if ((qType === 1 || qType === 2) && Array.isArray(qModel.choices())) {
                                        const ans = [], cs = qModel.choices();
                                        for (let k = 0; k < cs.length; k++) if (cs[k] && typeof cs[k].isSelected === "function" && cs[k].isSelected() && typeof cs[k].option === "function") ans.push(cs[k].option());
                                        if (ans.length > 0) qModel.answer(ans);
                                    }
                                }} catch (e) {}
                                qModel.koModel.submitQuestion();
                            } else { triggerMouseSequence($btn.get(0)); }
                        }, totalDelay);
                    }
                }
                let $globalSubmitBtn = $('.question-operation-area button').eq(0);
                if (!hasModelSubmitPlan && $globalSubmitBtn.length > 0 && $globalSubmitBtn.text() != '重做') {
                    this._schedule(() => triggerMouseSequence($globalSubmitBtn.get(0)), totalDelay + 300);
                }
                this.questionTaskUntil = Date.now() + totalDelay + 1200;
                this._schedule(() => $('.next-page-btn.cursor').click(), totalDelay + 900);
                return;
            }

            if ($("video").length > 0) {
                let $videos = $("video");
                let i = 0;
                for (; i < $videos.length; i++) {
                    let v = $videos.get(i);
                    let isFinished = v.ended || v.currentTime >= v.duration;
                    if (!isFinished) {
                        let $finishedNode = $("[data-bind='text: $root.i18nMessageText().finished']").get(i);
                        if ($finishedNode && $($finishedNode).is(':visible')) isFinished = true;
                    }
                    if (isFinished) continue;

                    rateGuard.hookVideo(v);
                    rateGuard.refreshTarget();

                    let _rate = rateGuard.targetRate;
                    if (rateGuard.getNativeRate(v) !== _rate) {
                        rateGuard.setNativeRate(v, _rate);
                    }
                    let speedBtn = $('.mejs__button.mejs__speed-button button').eq(i);
                    if (speedBtn.length > 0 && speedBtn.text() !== _rate + 'x') speedBtn.text(_rate + 'x');
                    if (v.paused) {
                        v.muted = true;
                        v.play().catch(() => {
                            let playBtn = $('.mejs__button.mejs__playpause-button button').eq(i);
                            if (playBtn.length > 0) playBtn.click();
                        });
                    }
                    break; 
                }
                if (i === $videos.length) $('.next-page-btn.cursor').click();
                return;
            }
            $('.next-page-btn.cursor').click();
        },
    }

    const respondent = {
        parentId: null, questionId: null, $questionNode: null, questionModel: null, answerDataCache: null,
        _answer(parentId, $questionNode, callback) {
            this.parentId = parentId; this.$questionNode = $questionNode;
            this.questionModel = getKoQuestionModel($questionNode); this.answerDataCache = null;
            let qidAttr = this.$questionNode.find('.question-wrapper').attr('id');
            if (this.questionModel && typeof this.questionModel.id === "function") this.questionId = this.questionModel.id();
            else if (!qidAttr || qidAttr.length <= 8) return;
            else this.questionId = qidAttr.substring(8);
            if (this.questionModel && this.questionModel.pageId) this.parentId = this.questionModel.pageId;
            if (!this.questionModel) { this.questionModel = findQuestionModelByIdFromGlobal(this.questionId); if (this.questionModel && this.questionModel.pageId) this.parentId = this.questionModel.pageId; }
            
            let questionType = $questionNode.find('.question-type-tag').text().trim();
            this.answerDataCache = this._getAnswerData();
            let answerLen = this.answerDataCache && Array.isArray(this.answerDataCache.correctAnswerList) ? this.answerDataCache.correctAnswerList.length : 0;
            let resolvedType = this._resolveType(questionType, answerLen);
            collectQuestionNodeToBank(this.$questionNode, this.answerDataCache, "auto-answer");
            
            let waitMs = 120;
            switch (resolvedType) {
                case '多选题': waitMs = this._answerMultiSelect(); break;
                case 'Multiple Choice': case '单选题': waitMs = this._answerSelect(); break;
                case 'True/False': case '判断题': waitMs = this._answerJudge(); break;
                case 'Fill in the Blank': case '填空题': waitMs = this._answerInput(); break;
                case 'Short Answer': case '简答题': waitMs = this._answerSimpleQuestion(); break;
                case 'Word Bank': case '选词填空': waitMs = this._answerChoicesQuestion(); break;
                case 'Sequence': case '排序题': waitMs = this._answerRankQuestion(); break;
                case '综合题': console.error("Unsupported question type: 综合题"); break;
            }
            if (callback && typeof callback == 'function') callback();
            return waitMs;
        },
        _resolveType(questionType, answerLen) {
            if (this.$questionNode.find('.blank-input').length > 0) return '填空题';
            if (this.$questionNode.find('.cloze-input').length > 0) return '选词填空';
            if (this.$questionNode.find('.answer-blank').length > 0) return '排序题';
            if (this.$questionNode.find('.choice-btn.right-btn').length > 0) return '判断题';
            if (this.$questionNode.find('.choice-list .choice-item').length > 0) return answerLen > 1 ? '多选题' : '单选题';
            return questionType;
        },
        _answerMultiSelect() {
            let answerData = this.answerDataCache || this._getAnswerData(); if (!answerData) return 120;
            let $choiceItems = this.$questionNode.find('.choice-list .choice-item');
            let answerArray = splitAnswerOptions(answerData.correctAnswerList);
            if ($choiceItems.length === 0) return 120;
            const pickedIdx = [];
            for (let i = 0; i < answerArray.length; i++) { let index = optionToIndex(answerArray[i]); if (index >= 0 && index < $choiceItems.length) pickedIdx.push(index); }
            if (!this.questionModel) {
                let $selectedItems = this.$questionNode.find('.choice-list .choice-item .checkbox.selected').closest('.choice-item');
                for (let i = 0; i < $selectedItems.length; i++) triggerMouseSequence($selectedItems[i]);
                for (let i = 0; i < pickedIdx.length; i++) triggerMouseSequence($choiceItems[pickedIdx[i]]);
            }
            setChoiceSelectedByDataFor($choiceItems, pickedIdx, false);
            setKoChoiceSelected(this.questionModel, pickedIdx, false);
            if (this.questionModel && typeof this.questionModel.answer === "function") {
                const normalized = answerArray.map(x => String(x).toUpperCase().match(/[A-Z]/)).filter(Boolean).map(m => m[0]);
                this.questionModel.answer(normalized);
            }
            return this.questionModel ? 160 : Math.max(220, answerArray.length * 180 + 120);
        },
        _answerSelect() {
            let answerData = this.answerDataCache || this._getAnswerData(); if (!answerData) return 120;
            let $choiceItems = this.$questionNode.find('.choice-list .choice-item');
            let answerArray = splitAnswerOptions(answerData.correctAnswerList);
            if ($choiceItems.length === 0 || answerArray.length === 0) return 120;
            let index = optionToIndex(answerArray[0]); if (index < 0 || index >= $choiceItems.length) return 120;
            setChoiceSelectedByDataFor($choiceItems, [index], true);
            setKoChoiceSelected(this.questionModel, [index], true);
            if (!this.questionModel) triggerMouseSequence($choiceItems[index]);
            if (this.questionModel && typeof this.questionModel.answer === "function") {
                const opt = String(answerArray[0]).toUpperCase().match(/[A-Z]/);
                this.questionModel.answer(opt ? [opt[0]] : []);
            }
            return this.questionModel ? 120 : 160;
        },
        _answerJudge() {
            let answerData = this.answerDataCache || this._getAnswerData(); if (!answerData || answerData.correctAnswerList.length === 0) return 120;
            let questionAnswer = answerData.correctAnswerList[0];
            if (questionAnswer=="true") triggerMouseSequence(this.$questionNode.find('.choice-btn.right-btn').get(0));
            else triggerMouseSequence(this.$questionNode.find('.choice-btn.wrong-btn').get(0));
            if (this.questionModel && typeof this.questionModel.answer === "function") this.questionModel.answer(questionAnswer=="true");
            return 160;
        },
        _answerInput() {
            let answerData = this.answerDataCache || this._getAnswerData(); if (!answerData) return 120;
            let $emptyInput = this.$questionNode.find('.blank-input');
            let inputAnswers = answerData.correctAnswerList, normalized = [];
            for (let i = 0; i < inputAnswers.length; i++) {
                let answerText = String(inputAnswers[i] || ""); normalized.push(answerText);
                let el = $emptyInput.eq(i).get(0); if (!el) continue;
                el.value = answerText;
                try { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
            }
            if (this.questionModel && typeof this.questionModel.answer === "function") this.questionModel.answer(normalized);
            return Math.max(180, normalized.length * 120 + 80);
        },
        _answerSimpleQuestion() {
            let answerData = this.answerDataCache || this._getAnswerData(); if (!answerData) return 120;
            let $emptyInput = this.$questionNode.find('.form-control');
            let inputAnswers = answerData.correctAnswerList, normalized = [];
            for (let i = 0; i < inputAnswers.length; i++) {
                let answerText = re_text(inputAnswers[i].replace(/【答案要点】/g, ''));
                $emptyInput.eq(i).val(answerText); $emptyInput.change(); normalized.push(answerText);
            }
            if (this.questionModel && typeof this.questionModel.answer === "function") this.questionModel.answer(normalized.length > 0 ? normalized[0] : "");
            return 220;
        },
        _answerChoicesQuestion() {
            let answerData = this.answerDataCache || this._getAnswerData(); if (!answerData) return 120;
            let $emptyInput = this.$questionNode.find('.cloze-input');
            let inputAnswers = answerData.subQuestionAnswerDTOList, normalized = [];
            for (let i = 0; i < inputAnswers.length; i++) {
                let answerText = inputAnswers[i] && inputAnswers[i].correctAnswerList ? inputAnswers[i].correctAnswerList[0] : "";
                $emptyInput.eq(i).val(answerText); $emptyInput.change();
                let el = $emptyInput.eq(i).get(0);
                if (el) { try { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {} }
                normalized.push(answerText);
            }
            if (this.questionModel && typeof this.questionModel.answer === "function") this.questionModel.answer(normalized);
            return Math.max(220, normalized.length * 120 + 80);
        },
        _answerRankQuestion() {
            let answerData = this.answerDataCache || this._getAnswerData(); if (!answerData) return 120;
            let $emptyInput = this.$questionNode.find('.answer-blank'), inputAnswers = answerData.correctAnswerList;
            for (let i = 0; i < inputAnswers.length; i++) { $emptyInput.eq(i).html(inputAnswers[i]); $emptyInput.change(); }
            return 220;
        },
        _getAnswerData() {
            let data = this._syncGetAnswer(); if (!data || typeof data !== "object") data = {};
            if (!Array.isArray(data.correctAnswerList)) data.correctAnswerList = [];
            if (!Array.isArray(data.subQuestionAnswerDTOList)) data.subQuestionAnswerDTOList = [];
            if (data.correctAnswerList.length === 0 && this.questionModel && typeof this.questionModel.correctAnswer === "function") {
                let koAns = this.questionModel.correctAnswer();
                if (Array.isArray(koAns) && koAns.length > 0) data.correctAnswerList = koAns.map(x => String(x));
                else if (typeof koAns === "string" && koAns.trim()) data.correctAnswerList = parseAnswerTextToArray(koAns);
                else if (typeof koAns === "boolean") data.correctAnswerList = [koAns ? "true" : "false"];
            }
            if (data.correctAnswerList.length === 0) {
                let domAnswerText = this.$questionNode.find('.correct-answer-area span:last-child').first().text().trim();
                if (domAnswerText) {
                    if (domAnswerText === "正确") data.correctAnswerList = ["true"];
                    else if (domAnswerText === "错误") data.correctAnswerList = ["false"];
                    else data.correctAnswerList = parseAnswerTextToArray(domAnswerText);
                }
            }
            if (data.correctAnswerList.length === 0) return null;
            return data;
        },
        _syncGetAnswer() {
            let res_answer;
            try {
                let apiHost = (typeof CONFIG_API_HOST !== "undefined" && CONFIG_API_HOST) ? CONFIG_API_HOST : "https://api.ulearning.cn";
                let reqUrl = apiHost + '/questionAnswer/' + this.questionId;
                $.ajax({ url: reqUrl, type: "GET", async: false, data: { parentId: this.parentId }, success: function (xhr) { res_answer = xhr; }, error: function () { debugLog("RespondentSyncError", "同步答案接口请求失败", { questionId: this.questionId }); }.bind(this) });
            } catch (e) { debugLog("RespondentSyncError", "同步答案接口异常", e.message); }
            return res_answer;
        }
    };

    const respondentHomeWork = {
        answerText: null, $questionNode: null,
        _answer(answerText, $questionNode, callback) {
            this.answerText = answerText; this.$questionNode = $questionNode;
            let questionType = getQuestionTypeText($questionNode);
            switch (questionType) {
                case '多选题': this._answerMultiSelect(); break;
                case '单选题': this._answerSelect(); break;
                case '判断题': this._answerJudge(); break;
            }
            if (callback && typeof callback == 'function') callback();
        },
        _answerMultiSelect() {
            let $emptySelected = getChoiceTextNodes(this.$questionNode), answerArray = this.answerText;
            for (let i = 0; i < $emptySelected.length; i++) {
                (function(j) { setTimeout(function() {
                    let tm = String($emptySelected.eq(j).text()).replace(/\"/g, "").replace(/\”/g, "").replace(/\“/g, "");
                    if(answerArray.indexOf(re_text(tm)) != -1) clickChoiceNode($emptySelected.eq(j));
                }, j*1000); })(i);
            }
        },
        _answerSelect() {
            let $emptySelected = getChoiceTextNodes(this.$questionNode), answerArray = this.answerText;
            for (let i = 0; i < $emptySelected.length; i++) {
                let tm = String($emptySelected.eq(i).text()).replace(/\"/g, "").replace(/\”/g, "").replace(/\“/g, "");
                if(similar(tm,answerArray)>95) clickChoiceNode($emptySelected.eq(i));
            }
        },
        _answerJudge() {
            let questionAnswer = this.answerText, $judgeInputs = this.$questionNode.find('.ul-radio__input');
            if ($judgeInputs.length >= 2) { questionAnswer=="true" ? $judgeInputs.eq(0).click() : $judgeInputs.eq(1).click(); return; }
            if (questionAnswer=="true") this.$questionNode.find('.choice-btn.right-btn').click();
            else this.$questionNode.find('.choice-btn.wrong-btn').click();
        }
    }

    const respondentExam = {
        answerText: null, $questionNode: null,
        _answer(answerText, $questionNode, callback) {
            this.answerText = answerText; this.$questionNode = $questionNode;
            let questionType = getQuestionTypeText($questionNode);
            switch (questionType) {
                case '多选题': this._answerMultiSelect(); break;
                case '单选题': this._answerSelect(); break;
                case '判断题': this._answerJudge(); break;
                case '填空题': this._answerInput(); break;
                case '简答题': if (typeof this._answerSimpleQuestion === "function") this._answerSimpleQuestion(); break;
            }
            if (callback && typeof callback == 'function') callback();
        },
        _answerMultiSelect() {
            let $emptySelected = getChoiceTextNodes(this.$questionNode), answerArray = this.answerText;
            for (let i = 0; i < $emptySelected.length; i++) {
                (function(j) { setTimeout(function() {
                    let tm = String($emptySelected.eq(j).text()).replace(/\"/g, "").replace(/\”/g, "").replace(/\“/g, "");
                    if(answerArray.indexOf(re_text(tm)) != -1) clickChoiceNode($emptySelected.eq(j));
                }, j*1000); })(i);
            }
        },
        _answerSelect() {
            let $emptySelected = getChoiceTextNodes(this.$questionNode), answerArray = this.answerText;
            for (let i = 0; i < $emptySelected.length; i++) {
                let tm = String($emptySelected.eq(i).text()).replace(/\"/g, "").replace(/\”/g, "").replace(/\“/g, "");
                if(similar(tm,answerArray)>95) clickChoiceNode($emptySelected.eq(i));
            }
        },
        _answerJudge() {
            let questionAnswer = this.answerText, $judgeInputs = this.$questionNode.find('.ul-radio__input');
            if ($judgeInputs.length >= 2) { questionAnswer=="true" ? $judgeInputs.eq(0).click() : $judgeInputs.eq(1).click(); return; }
            if (questionAnswer=="true") this.$questionNode.find('.choice-btn.right-btn').click();
            else this.$questionNode.find('.choice-btn.wrong-btn').click();
        },
        _answerInput() {
            let $emptyInput = this.$questionNode.find('.blank-question input, .blank-input, .cloze-input');
            let answerArray = this.answerText.replace(/\s*/g,"").split('||');
            for (let i = 0; i < $emptyInput.length; i++) {
                let num_input = $emptyInput[i]; num_input.value = answerArray[i];
                var event = document.createEvent('HTMLEvents'); event.initEvent("input", true, true); event.eventType = 'message';
                num_input.dispatchEvent(event);
            }
        }
    }

    function Re_Write() {
        const open = unsafeWindow.XMLHttpRequest.prototype.open;
        unsafeWindow.XMLHttpRequest.prototype.open = function () {
            let url = arguments[1];
            if (url) {
                if (url.match(/getPaperForStudent/) && url.match(/examId=(\d+)/) && url.match(/paperId=(\d+)/)) {
                    let examID = url.match(/examId=(\d+)/)[1], paperID = url.match(/paperId=(\d+)/)[1];
                    this.addEventListener('load', () => { let data = JSON.parse(this.responseText); Util.upload_paper(data, paperID, examID); });
                } else if (url.match(/getCorrectAnswer/) && url.match(/examId=(\d+)/) && url.match(/paperId=(\d+)/)) {
                    let examID = url.match(/examId=(\d+)/)[1], paperID = url.match(/paperId=(\d+)/)[1];
                    this.addEventListener('load', () => { let data = JSON.parse(this.responseText); Util.upload_answer(data, paperID, examID); });
                }
            }
            return open.apply(this, arguments);
        };
    }

    function Init() {
        if (!document.body) { setTimeout(Init, 100); return; }
        if (document.getElementById('dgut-m3-panel')) return;

        let style = document.createElement("style");
        style.innerHTML = `
            @import url('https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wght@8..144,400;8..144,500;8..144,700&family=Roboto+Mono:wght@400;500;700&display=swap');
            #dgut-m3-panel { position: fixed; z-index: 100000; font-family: 'Roboto Flex', -apple-system, "Microsoft YaHei", sans-serif; border-radius: 28px; overflow: hidden; transition: box-shadow 0.2s, transform 0.2s, width 0.3s, height 0.3s; user-select: none; }
            #dgut-m3-panel.theme-light { --m3-surface: #FEF7FF; --m3-surface-container: #F3EDF7; --m3-on-surface: #1D1B20; --m3-on-surface-variant: #49454F; --m3-primary: #6750A4; --m3-on-primary: #FFFFFF; --m3-primary-container: #EADDFF; --m3-on-primary-container: #21005D; --m3-secondary-container: #E8DEF8; --m3-on-secondary-container: #1D192B; --m3-outline: #79747E; --m3-shadow: rgba(0,0,0,0.15); --m3-ripple: rgba(0,0,0,0.08); --m3-error: #B3261E; }
            #dgut-m3-panel.theme-dark { --m3-surface: #141218; --m3-surface-container: #211F26; --m3-on-surface: #E6E0E9; --m3-on-surface-variant: #CAC4D0; --m3-primary: #D0BCFF; --m3-on-primary: #381E72; --m3-primary-container: #4F378B; --m3-on-primary-container: #EADDFF; --m3-secondary-container: #4A4458; --m3-on-secondary-container: #E8DEF8; --m3-outline: #938F99; --m3-shadow: rgba(0,0,0,0.4); --m3-ripple: rgba(255,255,255,0.12); --m3-error: #F2B8B5; }
            #dgut-m3-panel { background: var(--m3-surface-container); box-shadow: 0px 1px 3px var(--m3-shadow); width: 300px; }
            #dgut-m3-panel.dragging { box-shadow: 0px 8px 12px var(--m3-shadow); }
            .md-ripple { position: relative; overflow: hidden; }
            .md-ripple-effect { position: absolute; border-radius: 50%; pointer-events: none; background: var(--m3-ripple); transform: scale(0); animation: md-ripple-anim 0.6s linear; }
            @keyframes md-ripple-anim { to { transform: scale(4); opacity: 0; } }
            .md-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px 8px; cursor: move; }
            .md-title-group { display: flex; align-items: center; gap: 8px; }
            .md-status-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--m3-outline); flex-shrink: 0; }
            .md-status-dot.active { background: var(--m3-primary); animation: md-pulse 2s infinite; }
            @keyframes md-pulse { 0% { box-shadow: 0 0 0 0 var(--m3-primary); opacity: 1; } 50% { box-shadow: 0 0 0 6px transparent; opacity: 0.5; } 100% { box-shadow: 0 0 0 0 transparent; opacity: 1; } }
            .md-title { font-size: 14px; font-weight: 500; color: var(--m3-on-surface); }
            .md-action-group { display: flex; gap: 4px; }
            .md-icon-btn { width: 32px; height: 32px; border: none; background: transparent; color: var(--m3-on-surface-variant); border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.2s; }
            .md-icon-btn:hover { background: var(--m3-surface); }
            .md-icon-btn svg { width: 18px; height: 18px; fill: currentColor; }
            .md-body { padding: 8px 20px 20px; }
            .md-hero { background: var(--m3-primary-container); color: var(--m3-on-primary-container); border-radius: 24px; padding: 20px; margin-bottom: 16px; position: relative; overflow: hidden; }
            .md-hero-decor { position: absolute; width: 120px; height: 120px; border-radius: 50%; background: var(--m3-on-primary-container); opacity: 0.05; top: -40px; right: -20px; }
            .md-timer { font-family: 'Roboto Mono', monospace; font-size: 24px; font-weight: 500; text-align: center; letter-spacing: -1px; margin-bottom: 4px; position: relative; z-index: 1; }
            .md-book-name { font-size: 12px; text-align: center; opacity: 0.8; position: relative; z-index: 1; }
            .md-btn { width: 100%; height: 40px; border: none; border-radius: 20px; font-family: inherit; font-size: 14px; font-weight: 500; cursor: pointer; transition: filter 0.2s, background 0.2s; position: relative; overflow: hidden; }
            .md-btn-filled { background: var(--m3-primary); color: var(--m3-on-primary); }
            .md-btn-tonal { background: var(--m3-secondary-container); color: var(--m3-on-secondary-container); }
            .md-btn-text { background: transparent; color: var(--m3-primary); width: auto; height: 32px; padding: 0 12px; }
            .md-btn:hover { filter: brightness(1.1); }
            .md-btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
            .md-btn-grid .md-btn { width: 100%; height: 36px; font-size: 12px; border-radius: 18px; }
            .md-row { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; gap: 8px; }
            .md-input-group { display: flex; align-items: center; gap: 8px; flex: 1; }
            .md-label { font-size: 12px; color: var(--m3-on-surface-variant); }
            .md-text-field { width: 50px; background: transparent; border: 1px solid var(--m3-outline); border-radius: 4px; color: var(--m3-on-surface); padding: 4px 8px; font-family: 'Roboto Mono'; text-align: center; outline: none; transition: border 0.2s; }
            .md-text-field:focus { border: 2px solid var(--m3-primary); padding: 3px 7px; }
            .md-video-controls { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--m3-outline); }
            .md-answer-list { max-height: 300px; overflow-y: auto; margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
            .md-answer-item { background: var(--m3-surface); border-radius: 12px; padding: 8px 12px; border: 1px solid var(--m3-outline); }
            .md-q { font-size: 12px; color: var(--m3-on-surface-variant); cursor: pointer; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .md-a { font-size: 14px; color: var(--m3-primary); font-weight: 500; cursor: pointer; }
            .md-log-container { max-height: 150px; overflow-y: auto; margin-top: 8px; background: var(--m3-surface); border-radius: 12px; padding: 8px; font-family: 'Roboto Mono', monospace; font-size: 11px; color: var(--m3-on-surface-variant); transition: max-height 0.3s; }
            .md-log-container.collapsed { max-height: 0; padding: 0; overflow: hidden; margin: 0; border: 0; }
            .md-log-line { padding: 2px 0; border-bottom: 1px solid var(--m3-surface-container); }
            .md-log-line:last-child { border-bottom: none; }
            #dgut-snackbar { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(100px); background: var(--m3-on-surface); color: var(--m3-surface); padding: 14px 16px; border-radius: 8px; font-size: 14px; font-family: 'Roboto Flex'; box-shadow: 0px 4px 12px var(--m3-shadow); opacity: 0; transition: transform 0.3s, opacity 0.3s; z-index: 100001; pointer-events: none; }
            #dgut-snackbar.show { transform: translateX(-50%) translateY(0); opacity: 1; }
            @keyframes md-shake { 0% { transform: translateX(0); } 25% { transform: translateX(-4px); } 50% { transform: translateX(4px); } 75% { transform: translateX(-4px); } 100% { transform: translateX(0); } }
            #dgut-m3-panel.shake { animation: md-shake 0.4s ease-in-out; }
            /* 弹窗样式修正：使用固定颜色避免变量继承失效，并优化排版 */
            .md-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 100005; display: flex; align-items: center; justify-content: center; }
            .md-modal-box { background: #ffffff; color: #333333; padding: 28px; border-radius: 16px; max-width: 420px; font-family: 'Roboto Flex', sans-serif; box-shadow: 0 4px 20px rgba(0,0,0,0.3); line-height: 1.6; }
            .md-modal-box h3 { margin: 0 0 16px 0; color: #6750A4; display: flex; justify-content: space-between; align-items: center; font-size: 18px; }
            .md-modal-box p { margin: 8px 0; font-size: 14px; }
            .md-modal-close { background: #6750A4; color: #ffffff; border: none; padding: 10px 16px; border-radius: 20px; cursor: pointer; font-family: inherit; font-weight: 500; margin-top: 20px; width: 100%; font-size: 14px; }
            .md-modal-close:hover { filter: brightness(1.1); }
        `;
        document.head.appendChild(style);

        let p = document.createElement("div");
        p.id = 'dgut-m3-panel';
        p.className = GM_getValue(THEME_KEY, 'light') === 'dark' ? 'theme-dark' : 'theme-light';
        
        let pageurl = window.location.href.split("?")[0];
        if(pageurl=="https://utest.ulearning.cn/"){ p.style.top = '54px'; p.style.left = (window.innerWidth - 320) + 'px'; }
        else { p.style.top = '54px'; p.style.left = '50px'; }

        p.innerHTML = `
            <div class="md-header" id="md-drag-handle">
                <div class="md-title-group">
                    <span class="md-status-dot" id="md-status-dot"></span>
                    <span class="md-title">DGUT 优学院助手</span>
                </div>
                <div class="md-action-group">
                    <button id="md-btn-info" class="md-icon-btn" title="详情与许可"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg></button>
                    <button id="md-btn-theme" class="md-icon-btn" title="切换主题"><svg viewBox="0 0 24 24"><path d="M12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm0-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11 1h2v3h-2V1zm0 19h2v3h-2v-3zM3.515 4.929l1.414-1.414L7.05 5.636 5.636 7.05 3.515 4.93zM16.95 18.364l1.414-1.414 2.121 2.121-1.414 1.414-2.121-2.121zm2.121-14.85l1.414 1.415-2.121 2.121-1.414-1.414 2.121-2.121zM5.636 16.95l1.414 1.414-2.121 2.121-1.414-1.414 2.121-2.121zM23 11v2h-3v-2h3zM4 11v2H1v-2h3z"/></svg></button>
                </div>
            </div>
            <div class="md-body">
                <div class="md-hero">
                    <div class="md-hero-decor"></div>
                    <div class="md-timer" id="server_status">正常[]~(￣▽￣)~*</div>
                    <div class="md-book-name">服务器状态 / Token</div>
                </div>
                
                <div class="md-video-controls" id="video_controls_section" style="display:none;">
                    <button id="btn-video-start" class="md-btn md-btn-filled md-ripple">开始视频</button>
                    <button id="btn-video-stop" class="md-btn md-btn-tonal md-ripple" style="display:none; margin-top:8px;">暂停视频</button>
                    <div class="md-row">
                        <div class="md-input-group">
                            <span class="md-label">倍速</span>
                            <input type="text" id="rate" class="md-text-field" value="6.00" style="width: 60px;">
                            <span class="md-label">x</span>
                        </div>
                    </div>
                </div>

                <button id="btn-get-answer" class="md-btn md-btn-filled md-ripple" style="margin-top:12px;">查询答案</button>
                
                <div class="md-btn-grid">
                    <button id="btn-toggle-answer" class="md-btn md-btn-tonal md-ripple">隐藏答案</button>
                    <button id="btn-debug-toggle" class="md-btn md-btn-tonal md-ripple">显示日志</button>
                    <button id="btn-export-word" class="md-btn md-btn-text md-ripple">导出当前页</button>
                    <button id="btn-export-all" class="md-btn md-btn-text md-ripple">导出累计</button>
                    <button id="btn-clear-bank" class="md-btn md-btn-text md-ripple" style="color:var(--m3-error);">清空题库</button>
                    <button id="btn-debug-copy" class="md-btn md-btn-text md-ripple">复制日志</button>
                </div>

                <div class="md-answer-list" id="${answer_table2}"></div>
                <div class="md-log-container collapsed" id="${debug_box_id}"></div>
            </div>
        `;
        document.body.appendChild(p);

        const snackbar = Object.assign(document.createElement('div'), { id: 'dgut-snackbar' });
        document.body.appendChild(snackbar);

        document.addEventListener('pointerdown', function(e) {
            const target = e.target.closest('.md-ripple');
            if (!target) return;
            const circle = document.createElement('span');
            const diameter = Math.max(target.clientWidth, target.clientHeight);
            const radius = diameter / 2;
            circle.style.width = circle.style.height = `${diameter}px`;
            circle.style.left = `${e.clientX - target.getBoundingClientRect().left - radius}px`;
            circle.style.top = `${e.clientY - target.getBoundingClientRect().top - radius}px`;
            circle.classList.add('md-ripple-effect');
            target.appendChild(circle);
            setTimeout(() => { if(circle.parentNode) circle.parentNode.removeChild(circle); }, 600);
        });

        let drag = false, dx, dy;
        document.getElementById('md-drag-handle').addEventListener('mousedown', e => {
            if(e.target.closest('button')) return;
            drag = true; dx = e.clientX - p.offsetLeft; dy = e.clientY - p.offsetTop;
            p.classList.add('dragging');
            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup', onDragUp);
        });
        function onDragMove(e) { p.style.left = (e.clientX-dx)+'px'; p.style.top = (e.clientY-dy)+'px'; p.style.right = 'auto'; }
        function onDragUp() { drag = false; p.classList.remove('dragging'); document.removeEventListener('mousemove', onDragMove); document.removeEventListener('mouseup', onDragUp); }

        document.getElementById('md-btn-theme').addEventListener('click', () => {
            let isDark = p.classList.contains('theme-dark');
            p.className = isDark ? 'theme-light' : 'theme-dark';
            GM_setValue(THEME_KEY, isDark ? 'light' : 'dark');
            showSnackbar('主题已切换 (●ˇ∀ˇ●)');
        });

        document.getElementById('md-btn-info').addEventListener('click', showInfoModal);

        let titleClickCount = 0;
        let titleClickTimer = null;
        const panelTitle = document.querySelector('#md-drag-handle .md-title');
        if (panelTitle) {
            panelTitle.style.cursor = 'pointer';
            panelTitle.addEventListener('click', (e) => {
                if (drag) return;
                titleClickCount++;
                clearTimeout(titleClickTimer);
                titleClickTimer = setTimeout(() => { titleClickCount = 0; }, 1000);
                if (titleClickCount >= 5) {
                    titleClickCount = 0;
                    showSnackbar('你触发了隐藏开关 (≧∇≦)/');
                    p.classList.add('shake');
                    setTimeout(() => p.classList.remove('shake'), 400);
                }
            });
        }

        Bind();

        let new_uri= window.location.href.split("?")[0];
        if(/learnCourse/i.test(new_uri)){
            debugLog("Init", "识别为 learnCourse 页面，启用视频模式");
            youxueyuan.init();
        } else {
            set.token == "" ? Judge():Heart();
        }
    }

    function showInfoModal() {
        if (document.getElementById('md-info-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'md-info-overlay';
        overlay.className = 'md-modal-overlay';
        overlay.innerHTML = `
            <div class="md-modal-box">
                <h3>脚本详情 <span style="font-size:12px; font-weight:400; opacity:0.7">v${GM_info.script.version}</span></h3>
                <p><b>作者:</b> 锦廑主人 \\(￣︶￣*\\))</p>
                <p><b>开源许可:</b> GPL-3.0</p>
                <div style="opacity: 0.9; font-size: 14px; line-height: 1.8; margin-top: 12px; padding: 12px; background: #f8f9fa; border-radius: 8px; color: #444;">
                    本脚本仅供学习交流与自动化测试使用，请勿用于任何违规用途。使用本脚本产生的一切后果由使用者自行承担。<br>
                    用户必须遵守以下规则：
                    <ol style="margin: 8px 0 0 20px; padding: 0;">
                        <li style="margin-bottom: 6px;"><b>源码开放：</b>分发时必须提供源代码，确保接收者能够自由修改和使用。</li>
                        <li style="margin-bottom: 6px;"><b>许可证传递性：</b>任何基于 GPL 软件的修改版本也必须遵守 GPL 协议，确保自由的延续。</li>
                        <li style="margin-bottom: 6px;"><b>专利保护：</b>贡献者自动授予专利许可，防止专利诉讼破坏开源生态。</li>
                        <li style="margin-bottom: 6px;"><b>破解允许：</b>用户可以自由破解软件的技术限制，例如在消费类硬件上运行修改后的代码。</li>
                    </ol>
                </div>
                <p style="font-size: 14px; line-height: 1.8; margin-top: 16px; color: #555;">
                    本协议属于合同性质的<b>著作权协议</b>。若用户违反协议（如未提供源码或添加额外限制），<b>授权将自动终止</b>，用户的行为可能构成侵权。协议允许初犯者在 <b>30</b> 天内纠正错误以恢复权利。
                </p>
                <button id="md-btn-close-info" class="md-modal-close">了解了 (´∀｀)</button>
            </div>
        `;
        document.body.appendChild(overlay);
        const closeModal = () => { if(overlay.parentNode) overlay.parentNode.removeChild(overlay); };
        document.getElementById('md-btn-close-info').onclick = closeModal;
        overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
    }

    function showSnackbar(msg) {
        const snackbar = document.getElementById('dgut-snackbar');
        snackbar.textContent = msg;
        snackbar.classList.add('show');
        clearTimeout(snackbar.timeoutId);
        snackbar.timeoutId = setTimeout(() => snackbar.classList.remove('show'), 3000);
    }

    function getToken(info) {
        return new Promise(function(success){
            let pass = prompt(info || '请输入 Token 以获取题库答案:')
            if (pass !== null && pass.trim() !== '') {
                GM_setValue('yToken', pass); set.token = pass;
                Heart().then(([value, ttimes]) => {
                    if(!value) getToken("Token 验证失败(E401)，请重新输入");
                });
            }
            success();
        });
    }

    function Bind() {
        let get_answer = document.querySelector("#btn-get-answer");
        get_answer && get_answer.addEventListener("click", Get_Answer, false);
        
        let hide_show = document.querySelector("#btn-toggle-answer");
        hide_show && hide_show.addEventListener("click", function () {
            let answer_key = document.querySelector("#" + answer_table2);
            if (!answer_key) return;
            if (answer_key.style.display !== "none") { answer_key.style.display = "none"; hide_show.textContent = "显示答案"; }
            else { answer_key.style.display = "flex"; hide_show.textContent = "隐藏答案"; }
        }, false);

        let debug_toggle = document.querySelector("#btn-debug-toggle");
        debug_toggle && debug_toggle.addEventListener("click", function () {
            let box = document.querySelector("#" + debug_box_id);
            if (!box) return;
            box.classList.toggle("collapsed");
            debug_toggle.textContent = box.classList.contains("collapsed") ? "显示日志" : "隐藏日志";
        }, false);

        let debug_copy = document.querySelector("#btn-debug-copy");
        debug_copy && debug_copy.addEventListener("click", function () {
            GM_setClipboard(DEBUG.lines.join("\n") || "暂无日志");
            showSnackbar("调试日志已复制");
        }, false);

        let export_word = document.querySelector("#btn-export-word");
        export_word && export_word.addEventListener("click", function () { collectCurrentPageToBank(); downloadWordQuestionBank(getQuestionBankRecords(), "ulearning_当前页题库"); }, false);
        
        let export_all_word = document.querySelector("#btn-export-all");
        export_all_word && export_all_word.addEventListener("click", downloadAllWordQuestionBank, false);

        let clear_bank = document.querySelector("#btn-clear-bank");
        clear_bank && clear_bank.addEventListener("click", clearAllWordQuestionBank, false);
    }

    function Set_Heart() { }

    function Heart() {
        return new Promise((resolve) => {
            let server_status = document.querySelector("#server_status");
            if (server_status) {
                set.timestamp = new Date().getTime();
                Util.get(set.heartbeat, { token: "" + set.token, timestamp: "" + set.timestamp }, function (xhr) {
                    try {
                        let xhr_json = JSON.parse(xhr.responseText);
                        if (xhr_json.data.status) {
                            server_status.innerText = "正常 · 剩余: " + xhr_json.data.times;
                            resolve([xhr_json.data.status, xhr_json.data.times]);
                        } else {
                            server_status.innerText = "正常 · Token未知";
                            resolve([xhr_json.data.status, 0]);
                        }
                    } catch (e) { server_status.innerText = "(っ °Д °;)っ\n异常(E703)"; resolve([false, 0]); }
                }, function () { server_status.innerText = "(っ °Д °;)っ\n异常(E503)"; resolve([false, 0]); });
            }
        })
    }

    function Judge() {
        let server_status = document.querySelector("#server_status");
        if (server_status && (set.token=="")) {
            set.timestamp = new Date().getTime();
            Util.get("https://tk.fm90.cn/fuck/judge.php?version="+$version, {}, function (xhr) {
                try {
                    let xhr_json = JSON.parse(xhr.responseText);
                    if (xhr_json.code == 0) { server_status.innerText = "IP受限(E403)"; getToken("本机IP不可用，请输入Token"); }
                    else { server_status.innerText = "免费可用"; getToken("当前使用免费次数，可输入Token以提升稳定性"); }
                } catch (e) { server_status.innerText = "(っ °Д °;)っ\n异常(E603)"; }
            }, function () { server_status.innerText = "(っ °Д °;)っ\n异常(E503)"; });
        }
    }

    function Clear_Table() { let answer_table = document.querySelector("#"+answer_table2); answer_table && (answer_table.innerHTML = ''); }

    function escapeHtml(text) { return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

    let BANK_CACHE = null;
    function loadBankCache() { if (BANK_CACHE) return BANK_CACHE; try { BANK_CACHE = JSON.parse(localStorage.getItem(BANK_STORAGE_KEY)) || []; } catch (e) { BANK_CACHE = []; } return BANK_CACHE; }
    function saveBankCache() { localStorage.setItem(BANK_STORAGE_KEY, JSON.stringify(BANK_CACHE || [])); }

    function normalizeAnswerTextByType(qType, answerArray) {
        const arr = Array.isArray(answerArray) ? answerArray : []; if (arr.length === 0) return "";
        if (qType.indexOf("判断") !== -1) { const raw = String(arr[0]).toLowerCase(); if (raw === "true") return "正确"; if (raw === "false") return "错误"; }
        return arr.map(x => String(x)).join(",");
    }

    function buildRecordFromWrapper(w, answerList, answerExplain, sourceTag) {
        const idAttr = w.getAttribute("id") || "", qid = idAttr.startsWith("question") ? idAttr.substring(8) : idAttr;
        const sort = re_text((w.querySelector(".question-sort") || {}).textContent || "");
        const qType = re_text((w.querySelector(".question-type-tag") || {}).textContent || "");
        const title = re_text((w.querySelector(".question-title-html") || {}).textContent || "");
        const optionEls = w.querySelectorAll(".choice-list .choice-item"), options = [];
        for (let j = 0; j < optionEls.length; j++) { const opt = re_text((optionEls[j].querySelector(".option") || {}).textContent || "").replace(/\.$/, ""); const txt = re_text((optionEls[j].querySelector(".text") || {}).textContent || ""); if (opt || txt) options.push((opt ? opt + "." : "") + (txt ? " " + txt : "")); }
        let answer = Array.isArray(answerList) && answerList.length > 0 ? normalizeAnswerTextByType(qType, answerList) : re_text((w.querySelector(".correct-answer-area span:last-child") || {}).textContent || "");
        return { qid, sort, qType, title, options, answer, explain: answerExplain || re_text((w.querySelector(".correct-reply-area span:last-child") || {}).textContent || ""), source: sourceTag || "dom", updatedAt: new Date().toISOString() };
    }

    function mergeRecordIntoBank(record) {
        if (!record || !record.title) return;
        const bank = loadBankCache(), key = record.qid ? "id:" + record.qid : "title:" + record.title;
        let idx = bank.findIndex(item => (item.qid ? "id:" + item.qid : "title:" + item.title) === key);
        if (idx === -1) bank.push(record);
        else bank[idx] = { ...bank[idx], ...record, options: (record.options && record.options.length > 0) ? record.options : (bank[idx].options || []), answer: record.answer || bank[idx].answer || "", explain: record.explain || bank[idx].explain || "", updatedAt: new Date().toISOString() };
        saveBankCache();
    }

    function getQuestionBankRecords() {
        const records = [], nodes = document.querySelectorAll(".question-element-node .question-wrapper");
        nodes.forEach((w, i) => { const record = buildRecordFromWrapper(w, null, "", "dom"); if (!record.title) return; if (!record.sort) record.sort = String(i + 1); records.push(record); });
        return records;
    }

    function collectCurrentPageToBank() { getQuestionBankRecords().forEach(mergeRecordIntoBank); }

    function buildAnswerListForBank(answerData) {
        if (!answerData || typeof answerData !== "object") return [];
        if (Array.isArray(answerData.correctAnswerList) && answerData.correctAnswerList.length > 0) return answerData.correctAnswerList.map(x => String(x));
        if (Array.isArray(answerData.subQuestionAnswerDTOList) && answerData.subQuestionAnswerDTOList.length > 0) {
            const ans = []; answerData.subQuestionAnswerDTOList.forEach(item => { if (item && Array.isArray(item.correctAnswerList) && item.correctAnswerList.length > 0) ans.push(String(item.correctAnswerList[0])); });
            return ans;
        }
        return [];
    }

    function collectQuestionNodeToBank($questionNode, answerData, sourceTag) {
        try {
            if (!$questionNode || $questionNode.length === 0) return;
            const w = $questionNode.find('.question-wrapper').get(0) || $questionNode.get(0); if (!w) return;
            const record = buildRecordFromWrapper(w, buildAnswerListForBank(answerData), String(answerData && (answerData.correctreply || answerData.correctReply) || ""), sourceTag || "auto");
            if (record.title) mergeRecordIntoBank(record);
        } catch (e) {}
    }

    function buildWordHtml(records) {
        const rows = records.map((r, idx) => `<div class="q"><h3>${escapeHtml((r.sort || (idx + 1)) + ". [" + (r.qType || "未知题型") + "] " + r.title)}</h3>${r.options.length > 0 ? '<ol type="A">' + r.options.map(o => "<li>" + escapeHtml(o.replace(/^[A-Z]\.\s*/, "")) + "</li>").join("") + "</ol>" : "<p>（无选项）</p>"}<p><b>正确答案：</b>${escapeHtml(r.answer || "（空）")}</p><p><b>答案解析：</b>${escapeHtml(r.explain || "（空）")}</p></div>`).join("");
        return `<html><head><meta charset="utf-8"><style>body{font-family:'Microsoft YaHei',sans-serif;line-height:1.6;color:#222;}h1{font-size:22px;} .meta{color:#666;font-size:12px;margin-bottom:12px;}.q{border:1px solid #ddd;padding:10px;margin:10px 0;border-radius:6px;}.q h3{margin:0 0 6px;font-size:16px;} .q p{margin:4px 0;}</style></head><body><h1>Ulearning 题库导出</h1><div class="meta">导出时间：${escapeHtml(new Date().toLocaleString())} | 共 ${records.length} 题</div>${rows || "<p>当前页面未采集到题目。</p>"}</body></html>`;
    }

    function downloadWordQuestionBank(recordsOverride, filenamePrefix) {
        const records = recordsOverride || getQuestionBankRecords();
        const blob = new Blob(["\uFEFF", buildWordHtml(records)], { type: "application/msword;charset=utf-8" });
        const url = URL.createObjectURL(blob), a = document.createElement("a"), ts = new Date(), pad = n => String(n).padStart(2, "0");
        a.href = url; a.download = (filenamePrefix || "ulearning_题库") + "_" + ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) + "_" + pad(ts.getHours()) + pad(ts.getMinutes()) + ".doc";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        showSnackbar("题库已导出");
    }

    function downloadAllWordQuestionBank() { collectCurrentPageToBank(); downloadWordQuestionBank(loadBankCache().slice(), "ulearning_累计题库"); }
    function clearAllWordQuestionBank() { BANK_CACHE = []; saveBankCache(); showSnackbar("累计题库已清空"); }

    function getQuestionTypeText($questionNode) {
        let typeText = $questionNode.find('.question-type-tag').first().text().trim(); if (typeText) return typeText;
        let grayText = $questionNode.find('.gray').clone().children().remove().end().text().replace(/\s/g, "");
        if (grayText.indexOf(".") !== -1) return grayText.split(".")[1] || "";
        let tipText = $questionNode.find('.base-question .title .tip').text().trim();
        let tipMatch = tipText.match(/\d+\.(.*?)\s+/); return tipMatch && tipMatch[1] ? tipMatch[1].trim() : "";
    }

    function mapQuestionTypeCode(typeText) { return { "单选题": 1, "多选题": 2, "填空题": 3, "判断题": 4 }[typeText] || typeText; }
    function getQuestionOptionText($questionNode) { let quetxt = ""; $questionNode.find('.choice-list .choice-item .text, .choice-list label .rich-text, ul label span:last-child').each(function() { quetxt += re_text(jquery(this).text()) + "||"; }); return re_text(quetxt); }
    function getChoiceTextNodes($questionNode) { return $questionNode.find('.choice-list .choice-item .text, .choice-list label .rich-text, ul label span:last-child'); }

    function triggerMouseSequence(el) {
        if (!el) return;
        ["mousedown", "mouseup", "click"].forEach(evtName => {
            try { el.dispatchEvent(new Event(evtName, { bubbles: true, cancelable: true })); } catch (e) { try { const evt = document.createEvent("Event"); evt.initEvent(evtName, true, true); el.dispatchEvent(evt); } catch (innerErr) {} }
        });
        try { if (typeof el.click === "function") el.click(); } catch (e) {}
    }

    function clickChoiceNode($node) {
        if (!$node || $node.length === 0) return false;
        let $clickTarget = $node.closest('.choice-item'); if ($clickTarget.length === 0) $clickTarget = $node.closest('label');
        if ($clickTarget.length > 0 && $clickTarget[0]) { $clickTarget[0].click(); return true; }
        if ($node[0]) { $node[0].click(); return true; }
        return false;
    }

    function splitAnswerOptions(answerArray) { let merged = []; answerArray.forEach(one => { String(one || "").split(/[,\s|，、]+/).filter(Boolean).forEach(part => merged.push(part)); }); return merged; }
    function optionToIndex(opt) { const m = String(opt || "").toUpperCase().match(/[A-Z]/); return m ? m[0].charCodeAt(0) - 'A'.charCodeAt(0) : -1; }
    function parseAnswerTextToArray(answerText) { return String(answerText || "").trim().split(/[,\s|，、]+/).map(s => s.trim()).filter(Boolean); }

    function getKoQuestionModel($questionNode) {
        try {
            if (!$w.ko || !$questionNode || $questionNode.length === 0) return null;
            let node = $questionNode.find('.question-wrapper').get(0) || $questionNode.get(0);
            while (node) {
                const ctx = $w.ko.contextFor ? $w.ko.contextFor(node) : null;
                if (ctx) {
                    if (ctx.$component && ctx.$component.question) return ctx.$component.question;
                    if (ctx.$data && ctx.$data.question) return ctx.$data.question;
                    if (Array.isArray(ctx.$parents)) for (let i = 0; i < ctx.$parents.length; i++) if (ctx.$parents[i] && ctx.$parents[i].question) return ctx.$parents[i].question;
                }
                node = node.parentElement;
            }
        } catch (e) {}
        return null;
    }

    function getQuestionComponentVM($questionNode) {
        try {
            if (!$w.ko || !$questionNode || $questionNode.length === 0) return null;
            let node = $questionNode.find('.question-wrapper').get(0) || $questionNode.get(0);
            while (node) {
                const ctx = $w.ko.contextFor ? $w.ko.contextFor(node) : null;
                if (ctx && ctx.$component && typeof ctx.$component.submitQuestion === "function") return ctx.$component;
                node = node.parentElement;
            }
        } catch (e) {}
        return null;
    }

    function setChoiceSelectedByDataFor($choiceItems, indexList, singleMode) {
        try {
            if (!$w.ko || !$choiceItems || $choiceItems.length === 0) return;
            for (let i = 0; i < $choiceItems.length; i++) { const d = $w.ko.dataFor($choiceItems.get(i)); if (d && typeof d.isSelected === "function") d.isSelected(false); }
            for (let i = 0; i < indexList.length; i++) { const idx = indexList[i]; if (idx < 0 || idx >= $choiceItems.length) continue; const d = $w.ko.dataFor($choiceItems.get(idx)); if (d && typeof d.isSelected === "function") d.isSelected(true); if (singleMode) break; }
        } catch (e) {}
    }

    function findQuestionModelByIdFromGlobal(questionId) {
        try {
            if (!$w.koLearnCourseViewModel || typeof $w.koLearnCourseViewModel.currentPage !== "function") return null;
            const page = $w.koLearnCourseViewModel.currentPage(); if (!page || typeof page.pageElements !== "function") return null;
            const pageElements = page.pageElements(); if (!Array.isArray(pageElements)) return null;
            for (let i = 0; i < pageElements.length; i++) {
                const pe = pageElements[i]; if (!pe || typeof pe.questions !== "function") continue;
                const qs = pe.questions(); if (!Array.isArray(qs)) continue;
                for (let j = 0; j < qs.length; j++) { const q = qs[j]; if (q && typeof q.id === "function" && String(q.id()) === String(questionId)) return q; }
            }
        } catch (e) {}
        return null;
    }

    function setKoChoiceSelected(questionModel, indexList, singleMode) {
        if (!questionModel || typeof questionModel.choices !== "function") return;
        const choices = questionModel.choices(); if (!Array.isArray(choices) || choices.length === 0) return;
        for (let i = 0; i < choices.length; i++) if (choices[i] && typeof choices[i].isSelected === "function") choices[i].isSelected(false);
        for (let i = 0; i < indexList.length; i++) { const idx = indexList[i]; if (idx >= 0 && idx < choices.length && choices[idx] && typeof choices[idx].isSelected === "function") { choices[idx].isSelected(true); if (singleMode) break; } }
    }

    function wayModern(div) {
        let $questionNode = jquery(div), $wrapper = $questionNode.find('.question-wrapper').first();
        if (!$wrapper.length) return;
        let title = re_text($wrapper.find('.question-title-html').text() || $wrapper.find('.question-title').text()); if (!title) return;
        let index = re_text($wrapper.find('.question-sort').first().text() || "");
        let questionTypeText = getQuestionTypeText($wrapper), quetype = mapQuestionTypeCode(questionTypeText), quetxt = (quetype == 1 || quetype == 2) ? getQuestionOptionText($wrapper) : "";
        let answer_table = document.querySelector("#" + answer_table2);
        answer_table && (async function () {
            let item = document.createElement('div'); item.className = 'md-answer-item';
            let qDiv = document.createElement('div'); qDiv.className = 'md-q'; qDiv.innerText = "【" + index + "】" + title; qDiv.addEventListener("click", function () { GM_setClipboard(this.innerText); }, false);
            let aDiv = document.createElement('div'); aDiv.className = 'md-a'; aDiv.innerText = "查询中..."; aDiv.addEventListener("click", function () { GM_setClipboard(this.innerText); }, false);
            item.appendChild(qDiv); item.appendChild(aDiv); answer_table.appendChild(item);
            let codeAnswer = await Util.get_answer(title, quetype, aDiv, $wrapper, "exam");
            if (codeAnswer == 0) { Util.upload_title(title, quetype, quetxt); }
        })();
    }

    function Get_Answer() {
        Clear_Table();
        let modernQuestions = document.querySelectorAll(".question-element-node");
        if (modernQuestions && modernQuestions.length > 0) { modernQuestions.forEach(wayModern); Heart(); return; }
        document.querySelectorAll(".question-area").forEach(item => { item.childNodes.forEach(div => { if (div.className.indexOf("next-part") != -1) return; if(div.className === "question-item") way1(div); }); });
        document.querySelectorAll(".questions").forEach(item => { item.childNodes.forEach(div => { if (div.className.indexOf("next-part") != -1) return; if(div.className === "question-item") way3(div); }); });
        Heart();
    }

    function way3(div) {
        let grayNode = div.querySelector(".gray"); if (!grayNode || !grayNode.firstChild) return;
        let [index, questionTypeText] = grayNode.firstChild.textContent.replace(/\s/g, "").split(".");
        let quetype = mapQuestionTypeCode(questionTypeText);
        let titleNode = div.querySelector('.richtext-container.question-title'), title_text = titleNode && titleNode.lastChild ? titleNode.lastChild.textContent : "";
        let answer_table = document.querySelector("#"+answer_table2);
        answer_table && (async function () {
            let item = document.createElement('div'); item.className = 'md-answer-item';
            let qDiv = document.createElement('div'); qDiv.className = 'md-q'; qDiv.innerText = "【" + index.split(".")[0] + "】" + title_text; qDiv.addEventListener("click", function () { GM_setClipboard(this.innerText); }, false);
            let aDiv = document.createElement('div'); aDiv.className = 'md-a'; aDiv.innerText = "查询中..."; aDiv.addEventListener("click", function () { GM_setClipboard(this.innerText); }, false);
            item.appendChild(qDiv); item.appendChild(aDiv); answer_table.appendChild(item);
            await Util.get_answer(title_text.replace(/\"/g, "").replace(/\”/g, "").replace(/\“/g, "").replace(/\n/g, ""), quetype, aDiv, jquery(div), "homework");
        })();
    }

    function way1(div) {
        if (!div.firstChild || !div.firstChild.__vue__ || !div.firstChild.__vue__.question) return;
        let qid = div.firstChild.__vue__.question.questionid; if (!qid) return;
        let index = div.firstChild.__vue__.question.index, title = re_text(div.firstChild.__vue__.question.title), quetype = div.firstChild.__vue__.question.type, quetxt = "";
        if(quetype==1||quetype==2){ div.firstChild.__vue__.question.choices.forEach(item => quetxt += item.text + "||"); quetxt = re_text(quetxt); }
        let answer_table = document.querySelector("#"+answer_table2);
        answer_table && (async function () {
            let item = document.createElement('div'); item.className = 'md-answer-item';
            let qDiv = document.createElement('div'); qDiv.className = 'md-q'; qDiv.innerText = "【" + index + "】" + title; qDiv.addEventListener("click", function () { GM_setClipboard(this.innerText); }, false);
            let aDiv = document.createElement('div'); aDiv.className = 'md-a'; aDiv.innerText = "查询中..."; aDiv.addEventListener("click", function () { GM_setClipboard(this.innerText); }, false);
            item.appendChild(qDiv); item.appendChild(aDiv); answer_table.appendChild(item);
            let codeAnswer = await Util.get_answer(title, quetype, aDiv, jquery(div), "exam");
            if(codeAnswer==0) Util.upload_title(title, quetype, quetxt);
        })();
    }

    function similar(s, t, f) {
        if (!s || !t) return 0; if (s === t) return 100;
        var l = s.length > t.length ? s.length : t.length, n = s.length, m = t.length, d = [];
        f = f || 2;
        var min = (a, b, c) => a < b ? (a < c ? a : c) : (b < c ? b : c);
        if (n === 0) return m; if (m === 0) return n;
        for (let i = 0; i <= n; i++) { d[i] = []; d[i][0] = i; }
        for (let j = 0; j <= m; j++) { d[0][j] = j; }
        for (let i = 1; i <= n; i++) { let si = s.charAt(i - 1); for (let j = 1; j <= m; j++) { let tj = t.charAt(j - 1); d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (si === tj ? 0 : 1)); } }
        return ((1 - d[n][m] / l) * 100).toFixed(f);
    }

    function re_text(text) { text = text.replace(/<\/?.+?\/?>/g,'').replace(/\t/g, "").replace(/\n/g, "").replace(/\r/g, "").replace(/&.*?;/g, ""); return jquery.trim(text); }

    setInterval(() => { Element.prototype.remove = function() { return true; }; }, 1000);

    function bootstrap() {
        if (!document.body) {
            setTimeout(bootstrap, 100);
            return;
        }
        
        try {
            jquery('head').find('link').each(function() {
                if (this.href == 'https://www.ulearning.cn/static/css/reset2.css') jquery(this).remove();
            });
        } catch(e) {}

        Re_Write();
        Init();
        Set_Heart();
        
        window.onhashchange = function() {
            Re_Write();
            Init();
            Set_Heart();
        };

        console.log("%c哈哈哈~ (=^･ω･^=)", "color: #6750A4; font-size: 20px; font-weight: bold; text-shadow: 1px 1px 2px #EADDFF;");
        console.log("%c感谢使用优学院助手！发现这个彩蛋的你，今天一定会有好运哦~ (*^▽^*)", "color: #6750A4; font-size: 12px;");
    }
    
    bootstrap();
})();