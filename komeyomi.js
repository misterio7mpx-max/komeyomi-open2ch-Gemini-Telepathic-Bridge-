// ==UserScript==
// @name         komeyomi (棒読みちゃん専用・超軽量版)
// @namespace    http://tampermonkey.net/
// @version      3.00
// @description  おーぷん2chのコメントを棒読みちゃんで読み上げる機能のみに特化したスクリプト。
// @author       うさぎ
// @match        https://*.open2ch.net/test/read.cgi/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

(function() {
    'use strict';

    // 棒読みちゃんのポート番号
    const BOUYOMI_PORT = 50080;
    
    // 重複読み上げ防止用の記録
    let lastBouyomiText = "";

    /**
     * 棒読みちゃんにテキストを送信する関数
     */
    function sendToBouyomi(text) {
        GM_xmlhttpRequest({
            method: "GET",
            url: `http://localhost:${BOUYOMI_PORT}/talk?text=${encodeURIComponent(text)}`,
            onerror: () => console.log("🐰 [エラー] 棒読みちゃんとの通信に失敗しました。棒読みちゃんが起動しているか確認してください。")
        });
    }

    /**
     * コメントを抽出・整形して読み上げる関数
     */
    function processComment(rawText) {
        if (!rawText) return;

        // 最初の5文字（IDなど）を削除
        const slicedText = rawText.length > 5 ? rawText.substring(5) : rawText;
        
        // アンカー（>>1など）を削除し、URLを「URL省略」に置換
        const cleanText = slicedText.replace(/>>\d+/g, '').replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, 'URL省略').trim();

        // 空文字やシステムメッセージ（Room:スレ指定など）は無視
        if (!cleanText || cleanText.includes("Room:スレ指定")) return;

        // 直前のコメントと全く同じ場合は読まない（連投・重複防止）
        if (cleanText !== lastBouyomiText) {
            sendToBouyomi(cleanText);
            lastBouyomiText = cleanText;
        }
    }

    /**
     * おーぷん2chのDOM監視を開始する関数
     */
    function startObserver() {
        const observer = new MutationObserver(() => {
            const klogs = document.querySelectorAll('klog');
            if (klogs.length === 0) return;
            
            // 最新のコメントノードを取得
            const baseNode = klogs[klogs.length - 1].querySelector('.kcomm_base');
            if (baseNode) {
                // 余分な空白や改行を整えて処理へ回す
                processComment(baseNode.textContent.replace(/\s+/g, ' ').trim());
            }
        });

        // コメントエリア（.kcomm_base）が生成されるまで待機してから監視をスタート
        const checkInterval = setInterval(() => {
            const targetBase = document.querySelector('.kcomm_base');
            if (targetBase) {
                const targetParent = targetBase.closest('klog').parentNode;
                observer.observe(targetParent, { childList: true, subtree: true });
                clearInterval(checkInterval);
                console.log("🐰 [システム] おーぷん2chのコメント監視（棒読みちゃん専用）を開始しました！");
            }
        }, 1000);
    }

    // スクリプト実行
    startObserver();

})();
