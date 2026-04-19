// ==UserScript==
// @name         komeyomi (エンジン切替機能付き・超軽量版)
// @namespace    http://tampermonkey.net/
// @version      4.00
// @description  おーぷん2chのコメントを棒読みちゃん、VOICEVOX、COEIROINKで切り替えて読み上げるスクリプト。
// @author       うさぎ
// @match        https://*.open2ch.net/test/read.cgi/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(function() {
    'use strict';

    // 各エンジンの設定（ポート番号やデフォルトの話者ID）
    const CONFIG = {
        BOUYOMI_PORT: 50080,
        VOICEVOX_PORT: 50021,
        VOICEVOX_SPEAKER: 3,  // ずんだもん(ノーマル)
        COEIROINK_PORT: 50032, // COEIROINK v2のデフォルトポート (v1の場合は50031)
        COEIROINK_SPEAKER: 0   // デフォルト話者
    };

    const ENGINES = [
        { id: "bouyomi", name: "棒読みちゃん" },
        { id: "voicevox", name: "VOICEVOX" },
        { id: "coeiroink", name: "COEIROINK" }
    ];
    
    let currentEngineIndex = 0; // 初期状態は「棒読みちゃん」
    let lastBouyomiText = "";
    
    // 音声の重なりを防ぐためのキュー
    let audioQueue = Promise.resolve();

    /**
     * 左下に切り替えボタンを設置する関数
     */
    function createToggleButton() {
        const btn = document.createElement("button");
        btn.style.position = "fixed";
        btn.style.bottom = "20px";
        btn.style.left = "20px";
        btn.style.zIndex = "9999";
        btn.style.padding = "10px 15px";
        btn.style.backgroundColor = "#ffb6c1";
        btn.style.color = "#333";
        btn.style.border = "none";
        btn.style.borderRadius = "5px";
        btn.style.fontWeight = "bold";
        btn.style.cursor = "pointer";
        btn.style.boxShadow = "0 2px 5px rgba(0,0,0,0.3)";
        btn.innerText = `🔊 読み上げ: ${ENGINES[currentEngineIndex].name}`;

        btn.onclick = () => {
            currentEngineIndex = (currentEngineIndex + 1) % ENGINES.length;
            btn.innerText = `🔊 読み上げ: ${ENGINES[currentEngineIndex].name}`;
        };

        document.body.appendChild(btn);
    }

    /**
     * 棒読みちゃんにテキストを送信する関数
     */
    function sendToBouyomi(text) {
        GM_xmlhttpRequest({
            method: "GET",
            url: `http://localhost:${CONFIG.BOUYOMI_PORT}/talk?text=${encodeURIComponent(text)}`,
            onerror: () => console.log("🐰 [エラー] 棒読みちゃんとの通信に失敗しました。")
        });
    }

    /**
     * VOICEVOXやCOEIROINKのAPIを叩いて音声合成し、キューに沿って再生する関数
     */
    function playVoicevoxApi(text, port, speakerId) {
        audioQueue = audioQueue.then(() => new Promise((resolve) => {
            // 1. audio_query を作成
            GM_xmlhttpRequest({
                method: "POST",
                url: `http://127.0.0.1:${port}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
                onload: (resQuery) => {
                    if (resQuery.status !== 200) return resolve();
                    
                    // 2. synthesis で音声を合成
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: `http://127.0.0.1:${port}/synthesis?speaker=${speakerId}`,
                        headers: { "Content-Type": "application/json" },
                        data: resQuery.responseText,
                        responseType: "blob",
                        onload: (resSynth) => {
                            if (resSynth.status !== 200) return resolve();
                            
                            // 3. ブラウザで音声を再生
                            const blobUrl = URL.createObjectURL(resSynth.response);
                            const audio = new Audio(blobUrl);
                            
                            // 再生が終わったら次の音声を処理できるようにする
                            audio.onended = () => {
                                URL.revokeObjectURL(blobUrl);
                                resolve();
                            };
                            audio.onerror = () => {
                                URL.revokeObjectURL(blobUrl);
                                resolve();
                            };
                            audio.play().catch(() => resolve());
                        },
                        onerror: () => resolve()
                    });
                },
                onerror: () => {
                    console.log(`🐰 [エラー] 音声エンジン(ポート${port})が起動していない可能性があります。`);
                    resolve();
                }
            });
        })).catch(e => console.log(e));
    }

    /**
     * 現在選択されているエンジンに合わせてテキストを読み上げる関数
     */
    function readText(text) {
        const engine = ENGINES[currentEngineIndex].id;
        if (engine === "bouyomi") {
            sendToBouyomi(text);
        } else if (engine === "voicevox") {
            playVoicevoxApi(text, CONFIG.VOICEVOX_PORT, CONFIG.VOICEVOX_SPEAKER);
        } else if (engine === "coeiroink") {
            playVoicevoxApi(text, CONFIG.COEIROINK_PORT, CONFIG.COEIROINK_SPEAKER);
        }
    }

    /**
     * コメントを抽出・整形して処理へ回す関数
     */
    function processComment(rawText) {
        if (!rawText) return;

        const slicedText = rawText.length > 5 ? rawText.substring(5) : rawText;
        const cleanText = slicedText.replace(/>>\d+/g, '').replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, 'URL省略').trim();

        if (!cleanText || cleanText.includes("Room:スレ指定")) return;

        if (cleanText !== lastBouyomiText) {
            readText(cleanText); // ここで分岐用の関数を呼び出し
            lastBouyomiText = cleanText;
        }
    }

    /**
     * DOM監視を開始
     */
    function startObserver() {
        const observer = new MutationObserver(() => {
            const klogs = document.querySelectorAll('klog');
            if (klogs.length === 0) return;
            
            const baseNode = klogs[klogs.length - 1].querySelector('.kcomm_base');
            if (baseNode) {
                processComment(baseNode.textContent.replace(/\s+/g, ' ').trim());
            }
        });

        const checkInterval = setInterval(() => {
            const targetBase = document.querySelector('.kcomm_base');
            if (targetBase) {
                const targetParent = targetBase.closest('klog').parentNode;
                observer.observe(targetParent, { childList: true, subtree: true });
                clearInterval(checkInterval);
                console.log("🐰 [システム] おーぷん2chのコメント監視（切替機能付き）を開始しました！");
            }
        }, 1000);
    }

    // 初期化処理の実行
    createToggleButton();
    startObserver();

})();
