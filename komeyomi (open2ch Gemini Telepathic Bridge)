// ==UserScript==
// @name         komeyomi (open2ch Gemini Telepathic Bridge)
// @namespace    http://tampermonkey.net/
// @version      2.92
// @description  Gemini送信ON/OFF切替、棒読みちゃん常時送信、Gemini入力前クリア、UIドラッグ移動、ダブルクリック拡縮、UI位置保存(ドラッグ終了時のみ)。Gemini側初期位置を左上に変更。
// @author       うさぎ
// @match        https://*.open2ch.net/test/read.cgi/*
// @match        https://gemini.google.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        prefix: "【リスナー】",
        busyKeywords: ["思考中...", "発話中..."],
        uiFont: '"UD デジタル 教科書体 NK", "UD Digital Kyokasho-tai NK", sans-serif',
        uiBgColor: '#1a1a1a', // おーぷん2ch側のパネル用背景色
        bouyomiPort: 50080,
        wakeWord: "うさぎちゃん" // 反応するキーワード
    };

    // =====================================================================
    // 送信側：おーぷん2ch監視モジュール
    // =====================================================================
    class Open2chSender {
        constructor() {
            this.lastBouyomiText = ""; // 棒読みちゃん用の重複チェック
            this.lastGeminiText = "";  // Gemini用の重複チェック
            this.ngWords = [];
            this.isActive = false; // 初期状態はOFF
            this.buildFilterUI();
            this.startObserver();
        }

        buildFilterUI() {
            const panel = document.createElement('div');
            Object.assign(panel.style, {
                position: 'fixed', bottom: '10px', left: '10px', width: '260px', // 横幅を固定
                backgroundColor: CONFIG.uiBgColor, color: '#fff', border: '2px solid #555',
                borderRadius: '8px', zIndex: '2147483647', fontFamily: 'sans-serif',
                boxShadow: '0 4px 15px rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column'
            });

            ['mousedown', 'click', 'keydown', 'wheel'].forEach(evt => panel.addEventListener(evt, (e) => e.stopPropagation()));

            const header = document.createElement('div');
            Object.assign(header.style, {
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '5px 8px', backgroundColor: '#333', borderBottom: '1px solid #555', cursor: 'pointer',
                borderTopLeftRadius: '6px', borderTopRightRadius: '6px'
            });

            // 左側：ON/OFF スイッチ (Gemini送信の制御に変更)
            const activeBtn = document.createElement('button');
            activeBtn.textContent = "Gemini送信: OFF";
            Object.assign(activeBtn.style, {
                backgroundColor: '#cc3333', color: '#fff', border: 'none', borderRadius: '4px',
                padding: '2px 6px', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold',
                transition: 'background-color 0.2s'
            });
            activeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.isActive = !this.isActive;
                if (this.isActive) {
                    activeBtn.textContent = "Gemini送信: ON";
                    activeBtn.style.backgroundColor = '#33cc33';
                    console.log("🐰 [システム] Geminiへのコメント送信を開始しました。");
                } else {
                    activeBtn.textContent = "Gemini送信: OFF";
                    activeBtn.style.backgroundColor = '#cc3333';
                    console.log("🐰 [システム] Geminiへのコメント送信を停止しました。");
                }
            });

            // 右側：NG設定ラベルと開閉ボタン
            const rightWrap = document.createElement('div');
            Object.assign(rightWrap.style, { display: 'flex', alignItems: 'center', gap: '5px' });

            const title = document.createElement('span');
            title.textContent = "🛡️ NG (Gemini用)";
            title.style.fontSize = '12px';

            const toggleBtn = document.createElement('button');
            toggleBtn.textContent = "▲";
            Object.assign(toggleBtn.style, { background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '12px' });

            rightWrap.append(title, toggleBtn);
            header.append(activeBtn, rightWrap);
            panel.appendChild(header);

            const body = document.createElement('div');
            Object.assign(body.style, { padding: '10px', display: 'none', flexDirection: 'column', gap: '5px' });

            const inputField = document.createElement('textarea');
            Object.assign(inputField.style, {
                width: '100%', height: '150px', backgroundColor: '#000', color: '#fff', // 高さを150pxに拡大
                border: '1px solid #444', borderRadius: '4px', padding: '5px', fontSize: '11px', resize: 'none',
                boxSizing: 'border-box' // 余白を含めて100%に収める（右ズレ解消）
            });

            const savedWords = localStorage.getItem('kome_ng_words') || "";
            inputField.value = savedWords;
            this.updateNGWords(savedWords);

            inputField.addEventListener('input', (e) => {
                const val = e.target.value;
                localStorage.setItem('kome_ng_words', val);
                this.updateNGWords(val);
            });

            body.append(inputField);
            panel.appendChild(body);
            document.body.appendChild(panel);

            let isMinimized = true;
            header.addEventListener('click', () => {
                isMinimized = !isMinimized;
                body.style.display = isMinimized ? 'none' : 'flex';
                toggleBtn.textContent = isMinimized ? "▲" : "▼";
            });
        }

        updateNGWords(rawString) {
            this.ngWords = rawString.split(',').map(word => word.trim()).filter(word => word.length > 0);
        }

        sendToBouyomi(text) {
            GM_xmlhttpRequest({
                method: "GET",
                url: `http://localhost:${CONFIG.bouyomiPort}/talk?text=${encodeURIComponent(text)}`,
                onerror: () => console.log("🐰 棒読みちゃん通信エラー")
            });
        }

        sendComment(rawText) {
            if (!rawText) return;

            // --- 共通の下処理 ---
            const slicedText = rawText.length > 5 ? rawText.substring(5) : rawText;
            const cleanText = slicedText.replace(/>>\d+/g, '').replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, 'URL省略').trim();

            if (!cleanText || cleanText.includes("Room:スレ指定")) return;

            // --- ルート1：棒読みちゃんへの送信 ---
            if (cleanText !== this.lastBouyomiText) {
                this.sendToBouyomi(cleanText);
                this.lastBouyomiText = cleanText;
            }

            // --- ルート2：Geminiへの送信 ---
            if (!this.isActive) return;
            if (!cleanText.startsWith(CONFIG.wakeWord)) return;
            if (cleanText === this.lastGeminiText) return;
            if (this.ngWords.some(ngWord => cleanText.includes(ngWord))) return;

            this.lastGeminiText = cleanText;
            GM_setValue('telepathy_comment', { text: cleanText, timestamp: Date.now() });
        }

        startObserver() {
            const observer = new MutationObserver(() => {
                const klogs = document.querySelectorAll('klog');
                if (klogs.length === 0) return;
                const baseNode = klogs[klogs.length - 1].querySelector('.kcomm_base');
                if (baseNode) this.sendComment(baseNode.textContent.replace(/\s+/g, ' ').trim());
            });
            setInterval(() => {
                const targetBase = document.querySelector('.kcomm_base');
                if (targetBase) observer.observe(targetBase.closest('klog').parentNode, { childList: true, subtree: true });
            }, 1000);
        }
    }

    // =====================================================================
    // 受信側：Gemini制御モジュール
    // =====================================================================
    class GeminiReceiver {
        constructor() {
            this.buildMonitorUI();
            this.listenForTelepathy();
        }

        buildMonitorUI() {
            const panel = document.createElement('div');

            // 保存された位置情報を取得、なければデフォルト値を使用
            const savedLeft = localStorage.getItem('gemini_telepathy_left') || '1px';
            const savedTop = localStorage.getItem('gemini_telepathy_top') || '1px';

            Object.assign(panel.style, {
                position: 'fixed',
                top: savedTop,
                left: savedLeft,
                width: '50px', // 初期状態（縮小）
                height: '50px', // 初期状態（縮小）
                backgroundColor: 'rgb(0, 0, 50)',
                color: '#fff',
                border: '2px solid #555',
                borderRadius: '8px',
                zIndex: '2147483647',
                fontFamily: CONFIG.uiFont,
                boxShadow: '0 4px 15px rgba(0,0,0,0.8)',
                padding: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
                overflow: 'hidden',
                cursor: 'grab',
                userSelect: 'none',
                transition: 'width 0.2s cubic-bezier(0.25, 1, 0.5, 1), height 0.2s cubic-bezier(0.25, 1, 0.5, 1), padding 0.2s' // スムーズなアニメーション
            });

            // 縮小時用アイコン
            const iconDiv = document.createElement('div');
            iconDiv.textContent = '🐰';
            iconDiv.style.fontSize = '24px';
            iconDiv.style.display = 'block';

            // 拡大時用テキスト
            this.monitorText = document.createElement('div');
            this.monitorText.textContent = "待機中...";
            this.monitorText.style.fontSize = '22px';
            this.monitorText.style.fontWeight = 'bold';
            this.monitorText.style.lineHeight = '1.4';
            this.monitorText.style.wordBreak = 'break-all';
            this.monitorText.style.color = '#000000';
            this.monitorText.style.textAlign = 'center';
            this.monitorText.style.pointerEvents = 'none';
            this.monitorText.style.display = 'none'; // 初期は非表示

            const w = '#ffffff';
            const g = '#33cc33';
            const innerShadow = `2px 0 0 ${w}, -2px 0 0 ${w}, 0 2px 0 ${w}, 0 -2px 0 ${w}, 2px 2px 0 ${w}, -2px -2px 0 ${w}, 2px -2px 0 ${w}, -2px 2px 0 ${w}`;
            const outerShadow = `4px 0 0 ${g}, -4px 0 0 ${g}, 0 4px 0 ${g}, 0 -4px 0 ${g}, 4px 4px 0 ${g}, -4px -4px 0 ${g}, 4px -4px 0 ${g}, -4px 4px 0 ${g}, 4px 2px 0 ${g}, -4px 2px 0 ${g}, 4px -2px 0 ${g}, -4px -2px 0 ${g}, 2px 4px 0 ${g}, -2px 4px 0 ${g}, 2px -4px 0 ${g}, -2px -4px 0 ${g}`;
            this.monitorText.style.textShadow = `${innerShadow}, ${outerShadow}`;

            panel.append(iconDiv, this.monitorText);
            document.body.appendChild(panel);

            // === ダブルクリックによる拡縮処理 ===
            let isGeminiMinimized = true;
            panel.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                isGeminiMinimized = !isGeminiMinimized;
                if (isGeminiMinimized) {
                    panel.style.width = '50px';
                    panel.style.height = '50px';
                    panel.style.padding = '0';
                    iconDiv.style.display = 'block';
                    this.monitorText.style.display = 'none';
                } else {
                    // 17文字×3行が収まるサイズ (22px基準で余裕を持たせた設計)
                    panel.style.width = '400px';
                    panel.style.height = '125px';
                    panel.style.padding = '15px';
                    iconDiv.style.display = 'none';
                    this.monitorText.style.display = 'block';
                }
            });

            // === パネルのドラッグ移動処理 ===
            let isDragging = false;
            let dragOffsetX = 0;
            let dragOffsetY = 0;

            panel.addEventListener('mousedown', (e) => {
                isDragging = true;
                panel.style.cursor = 'grabbing';

                const rect = panel.getBoundingClientRect();
                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;

                panel.style.bottom = 'auto';
                panel.style.right = 'auto';
                panel.style.left = rect.left + 'px';
                panel.style.top = rect.top + 'px';
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;

                let newLeft = e.clientX - dragOffsetX;
                let newTop = e.clientY - dragOffsetY;

                const maxLeft = window.innerWidth - panel.offsetWidth;
                const maxTop = window.innerHeight - panel.offsetHeight;

                newLeft = Math.max(0, Math.min(newLeft, maxLeft));
                newTop = Math.max(0, Math.min(newTop, maxTop));

                panel.style.left = newLeft + 'px';
                panel.style.top = newTop + 'px';
            });

            // 【変更】マウスを離した瞬間にだけ、新しい位置を記憶（保存）する
            document.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    panel.style.cursor = 'grab';

                    // ドラッグが終わったタイミングで localStorage に保存
                    localStorage.setItem('gemini_telepathy_left', panel.style.left);
                    localStorage.setItem('gemini_telepathy_top', panel.style.top);
                }
            });

            window.addEventListener('resize', () => {
                if (panel.style.bottom !== 'auto' && panel.style.top === '') return;
                const rect = panel.getBoundingClientRect();
                const maxLeft = window.innerWidth - panel.offsetWidth;
                const maxTop = window.innerHeight - panel.offsetHeight;

                const newLeft = Math.max(0, Math.min(rect.left, maxLeft));
                const newTop = Math.max(0, Math.min(rect.top, maxTop));

                panel.style.left = newLeft + 'px';
                panel.style.top = newTop + 'px';
            });

            // （以前ここにあった setInterval による5秒ごとの自動保存処理は削除しました）
        }

        updateMonitor(text) {
            // 17文字×3行＝51文字。少し余裕を見て51文字で省略
            this.monitorText.textContent = text.length > 51 ? text.substring(0, 51) + "..." : text;
        }

        isBusy() {
            const stopButton = document.querySelector('button[aria-label*="停止"], .generating-text, [purpose="r-stop-button"]');
            if (stopButton) return true;
            const divs = document.querySelectorAll('div');
            for (let div of divs) if (CONFIG.busyKeywords.includes(div.textContent.trim())) return true;
            return false;
        }

        listenForTelepathy() {
            GM_addValueChangeListener('telepathy_comment', (name, oldValue, newValue, remote) => {
                if (remote && newValue && newValue.text) {
                    if (this.isBusy()) return;
                    this.updateMonitor(newValue.text);
                    const inputElem = document.querySelector('.input-area div[contenteditable="true"], rich-textarea > div');
                    const sendBtn = document.querySelector('button[aria-label*="送信"], .send-button, [purpose="r-send-button"]');
                    if (inputElem && sendBtn) {
                        inputElem.focus();
                        document.execCommand('selectAll', false, null);
                        document.execCommand('delete', false, null);

                        document.execCommand('insertText', false, `${CONFIG.prefix} ${newValue.text}`);
                        setTimeout(() => sendBtn.click(), 500);
                    }
                }
            });
        }
    }

    const currentUrl = window.location.href;
    if (currentUrl.includes('open2ch.net')) new Open2chSender();
    else if (currentUrl.includes('gemini.google.com')) new GeminiReceiver();

})();
