// ==UserScript==
// @name         komeyomi (⚙詳細設定・微調整UI対応版)
// @namespace    http://tampermonkey.net/
// @version      9.00
// @description  おーぷん2chのコメント読み上げスクリプト。0.01単位の調整、直接入力、マウスホイール操作に対応。
// @author       うさぎ
// @match        https://*.open2ch.net/test/read.cgi/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(function() {
    'use strict';

    // デフォルトの設定テンプレート
    const DEFAULT_CONFIG = {
        engine: "bouyomi",
        BOUYOMI_PORT: 50080,
        BOUYOMI_SPEAKER: 0,
        VOICEVOX_PORT: 50021,
        VOICEVOX_SPEAKER: 3,
        COEIROINK_PORT: 50032,
        COEIROINK_SPEAKER: 0,
        volume: 1.00,     // 音量
        pitch: 0.00,      // 高音
        speed: 1.00,      // 話速
        intonation: 1.00, // 抑揚
        delay: 0.10       // 遅延
    };

    let savedConfig = JSON.parse(localStorage.getItem('komeyomi_config')) || {};
    let CONFIG = { ...DEFAULT_CONFIG, ...savedConfig };

    function saveConfig() {
        localStorage.setItem('komeyomi_config', JSON.stringify(CONFIG));
    }

    let lastBouyomiText = "";
    let audioQueue = Promise.resolve();

    const BOUYOMI_VOICES = [
        {id: 0, name: "デフォルト"}, {id: 1, name: "女性1"}, {id: 2, name: "女性2"},
        {id: 3, name: "男性1"}, {id: 4, name: "男性2"}, {id: 5, name: "中性"},
        {id: 6, name: "ロボット"}, {id: 7, name: "機械1"}, {id: 8, name: "機械2"}
    ];

    function fetchSpeakers(port, selectElement, currentVal) {
        selectElement.innerHTML = '<option value="">⏳ 取得中...</option>';
        GM_xmlhttpRequest({
            method: "GET",
            url: `http://127.0.0.1:${port}/speakers`,
            onload: (res) => {
                if(res.status === 200) {
                    try {
                        const speakers = JSON.parse(res.responseText);
                        selectElement.innerHTML = '';
                        speakers.forEach(sp => {
                            sp.styles.forEach(style => {
                                const opt = document.createElement('option');
                                opt.value = style.id;
                                opt.textContent = `${sp.name} (${style.name})`;
                                if(style.id == currentVal) opt.selected = true;
                                selectElement.appendChild(opt);
                            });
                        });
                    } catch(e) { selectElement.innerHTML = '<option value="">取得失敗</option>'; }
                }
            },
            onerror: () => { selectElement.innerHTML = '<option value="">未起動</option>'; }
        });
    }

    function createUI() {
        const uiContainer = document.createElement('div');
        uiContainer.innerHTML = `
            <div id="komeyomi-btn" style="position:fixed; bottom:20px; left:20px; width:45px; height:45px; background:#fff; border:1px solid #ccc; border-radius:5px; box-shadow:0 2px 5px rgba(0,0,0,0.2); font-size:24px; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:9999; user-select:none;">
                ⚙️
            </div>

            <div id="komeyomi-panel" style="display:none; position:fixed; bottom:75px; left:20px; width:300px; background:#fff; border:1px solid #ccc; border-radius:5px; box-shadow:0 2px 10px rgba(0,0,0,0.2); padding:15px; font-size:13px; color:#333; z-index:9999; font-family:sans-serif;">
                <div style="font-weight:bold; margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:5px;">🔊 読み上げ詳細設定</div>
                
                <div style="margin-bottom:10px;">
                    <select id="ky_engine" style="width:100%; padding:3px;">
                        <option value="bouyomi">棒読みちゃん</option>
                        <option value="voicevox">VOICEVOX</option>
                        <option value="coeiroink">COEIROINK</option>
                    </select>
                </div>

                <div style="margin-bottom:10px; background:#f9f9f9; padding:8px; border-radius:4px; border:1px solid #eee;">
                    <div id="wrap_bouyomi">
                        話者: <select id="ky_bo_spk" style="width:55%;"></select>
                        <button id="btn_bo_test" style="padding:2px 5px; cursor:pointer; margin-left:4px;" title="テスト再生">▶️</button>
                    </div>
                    <div id="wrap_voicevox" style="display:none;">
                        VV話者: <select id="ky_vv_spk" style="width:50%;"></select>
                        <button id="btn_vv_fetch" style="padding:2px 5px; cursor:pointer; margin-left:4px;" title="話者リスト取得">🔄</button>
                        <button id="btn_vv_test" style="padding:2px 5px; cursor:pointer; margin-left:2px;" title="テスト再生">▶️</button>
                    </div>
                    <div id="wrap_coeiroink" style="display:none;">
                        CO話者: <select id="ky_co_spk" style="width:50%;"></select>
                        <button id="btn_co_fetch" style="padding:2px 5px; cursor:pointer; margin-left:4px;" title="話者リスト取得">🔄</button>
                        <button id="btn_co_test" style="padding:2px 5px; cursor:pointer; margin-left:2px;" title="テスト再生">▶️</button>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:35px 1fr 50px; gap:5px; align-items:center; margin-bottom:5px;">
                    <span>音量</span>
                    <input type="range" id="k_vol" min="0" max="2" step="0.01">
                    <input type="number" id="v_vol" min="0" max="2" step="0.01" style="width:45px; padding:1px 2px; font-size:12px; text-align:right; border:1px solid #ccc; border-radius:3px;">
                    
                    <span>高音</span>
                    <input type="range" id="k_pit" min="-0.15" max="0.15" step="0.01">
                    <input type="number" id="v_pit" min="-0.15" max="0.15" step="0.01" style="width:45px; padding:1px 2px; font-size:12px; text-align:right; border:1px solid #ccc; border-radius:3px;">
                    
                    <span>話速</span>
                    <input type="range" id="k_spd" min="0.5" max="2" step="0.01">
                    <input type="number" id="v_spd" min="0.5" max="2" step="0.01" style="width:45px; padding:1px 2px; font-size:12px; text-align:right; border:1px solid #ccc; border-radius:3px;">
                    
                    <span>抑揚</span>
                    <input type="range" id="k_int" min="0" max="2" step="0.01">
                    <input type="number" id="v_int" min="0" max="2" step="0.01" style="width:45px; padding:1px 2px; font-size:12px; text-align:right; border:1px solid #ccc; border-radius:3px;">
                    
                    <span>遅延</span>
                    <input type="range" id="k_del" min="0" max="2" step="0.01">
                    <input type="number" id="v_del" min="0" max="2" step="0.01" style="width:45px; padding:1px 2px; font-size:12px; text-align:right; border:1px solid #ccc; border-radius:3px;">
                </div>
                <div style="font-size:10px; color:#888;">※スライダーや数値枠の上でマウスホイールを回すと微調整できます。</div>
            </div>
        `;
        document.body.appendChild(uiContainer);

        const btn = document.getElementById('komeyomi-btn');
        const panel = document.getElementById('komeyomi-panel');
        const selectEngine = document.getElementById('ky_engine');
        
        const wrapBo = document.getElementById('wrap_bouyomi');
        const wrapVv = document.getElementById('wrap_voicevox');
        const wrapCo = document.getElementById('wrap_coeiroink');

        const selectBo = document.getElementById('ky_bo_spk');
        const selectVv = document.getElementById('ky_vv_spk');
        const selectCo = document.getElementById('ky_co_spk');

        selectEngine.value = CONFIG.engine;
        
        BOUYOMI_VOICES.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.id; opt.textContent = v.name;
            if(v.id == CONFIG.BOUYOMI_SPEAKER) opt.selected = true;
            selectBo.appendChild(opt);
        });

        const updateEngineView = () => {
            wrapBo.style.display = selectEngine.value === 'bouyomi' ? 'block' : 'none';
            wrapVv.style.display = selectEngine.value === 'voicevox' ? 'block' : 'none';
            wrapCo.style.display = selectEngine.value === 'coeiroink' ? 'block' : 'none';
        };
        updateEngineView();

        const params = ['vol', 'pit', 'spd', 'int', 'del'];
        const configKeys = { vol: 'volume', pit: 'pitch', spd: 'speed', int: 'intonation', del: 'delay' };
        
        params.forEach(p => {
            const slider = document.getElementById(`k_${p}`);
            const numInput = document.getElementById(`v_${p}`);
            
            // 値の更新と保存を行う共通処理
            const updateValue = (val) => {
                let min = parseFloat(slider.min);
                let max = parseFloat(slider.max);
                if (isNaN(val)) val = DEFAULT_CONFIG[configKeys[p]];
                if (val < min) val = min;
                if (val > max) val = max;
                
                val = Math.round(val * 100) / 100; // 0.01単位に丸める
                
                slider.value = val;
                numInput.value = val.toFixed(2);
                CONFIG[configKeys[p]] = val;
                saveConfig();
            };

            // 初期値セット
            updateValue(typeof CONFIG[configKeys[p]] === 'number' ? CONFIG[configKeys[p]] : DEFAULT_CONFIG[configKeys[p]]);
            
            // スライダー操作時
            slider.addEventListener('input', (e) => updateValue(parseFloat(e.target.value)));
            // 直接入力時
            numInput.addEventListener('change', (e) => updateValue(parseFloat(e.target.value)));
            
            // マウスホイール操作時（スライダーと入力枠の両方で反応）
            const handleWheel = (e) => {
                e.preventDefault(); // 画面のスクロールを防ぐ
                let current = parseFloat(CONFIG[configKeys[p]]);
                if (e.deltaY < 0) {
                    current += 0.01; // 上スクロールで増加
                } else {
                    current -= 0.01; // 下スクロールで減少
                }
                updateValue(current);
            };
            
            slider.addEventListener('wheel', handleWheel, { passive: false });
            numInput.addEventListener('wheel', handleWheel, { passive: false });
        });

        btn.addEventListener('click', () => {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            btn.style.background = panel.style.display === 'none' ? '#fff' : '#f0f0f0';
            
            if (panel.style.display === 'block') {
                if (selectVv.options.length <= 1) fetchSpeakers(CONFIG.VOICEVOX_PORT, selectVv, CONFIG.VOICEVOX_SPEAKER);
                if (selectCo.options.length <= 1) fetchSpeakers(CONFIG.COEIROINK_PORT, selectCo, CONFIG.COEIROINK_SPEAKER);
            }
        });

        selectEngine.addEventListener('change', (e) => { CONFIG.engine = e.target.value; updateEngineView(); saveConfig(); });
        selectBo.addEventListener('change', (e) => { CONFIG.BOUYOMI_SPEAKER = parseInt(e.target.value) || 0; saveConfig(); });
        selectVv.addEventListener('change', (e) => { CONFIG.VOICEVOX_SPEAKER = parseInt(e.target.value) || 0; saveConfig(); });
        selectCo.addEventListener('change', (e) => { CONFIG.COEIROINK_SPEAKER = parseInt(e.target.value) || 0; saveConfig(); });

        document.getElementById('btn_vv_fetch').addEventListener('click', () => fetchSpeakers(CONFIG.VOICEVOX_PORT, selectVv, CONFIG.VOICEVOX_SPEAKER));
        document.getElementById('btn_co_fetch').addEventListener('click', () => fetchSpeakers(CONFIG.COEIROINK_PORT, selectCo, CONFIG.COEIROINK_SPEAKER));

        const testText = "音声テストです。";
        document.getElementById('btn_bo_test').addEventListener('click', () => sendToBouyomi(testText));
        document.getElementById('btn_vv_test').addEventListener('click', () => playVoicevoxApi(testText, CONFIG.VOICEVOX_PORT, CONFIG.VOICEVOX_SPEAKER));
        document.getElementById('btn_co_test').addEventListener('click', () => playVoicevoxApi(testText, CONFIG.COEIROINK_PORT, CONFIG.COEIROINK_SPEAKER));
    }

    function sendToBouyomi(text) {
        const vol = typeof CONFIG.volume === 'number' ? CONFIG.volume : 1.0;
        const spd = typeof CONFIG.speed === 'number' ? CONFIG.speed : 1.0;
        const pit = typeof CONFIG.pitch === 'number' ? CONFIG.pitch : 0.0;
        
        const bVol = Math.round(vol * 50);
        const bSpd = Math.round(spd * 100);
        const bPit = Math.round(100 + (pit * 333));
        const bVoice = CONFIG.BOUYOMI_SPEAKER;

        const query = `text=${encodeURIComponent(text)}&volume=${bVol}&speed=${bSpd}&tone=${bPit}&voice=${bVoice}`;
        GM_xmlhttpRequest({
            method: "GET",
            url: `http://localhost:${CONFIG.BOUYOMI_PORT}/talk?${query}`,
            onerror: () => console.log("🐰 [エラー] 棒読みちゃんとの通信失敗")
        });
    }

    function playVoicevoxApi(text, port, speakerId) {
        audioQueue = audioQueue.then(() => new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: `http://127.0.0.1:${port}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
                onload: (resQuery) => {
                    if (resQuery.status !== 200) return resolve();
                    
                    let queryObj;
                    try {
                        queryObj = JSON.parse(resQuery.responseText);
                        queryObj.volumeScale = typeof CONFIG.volume === 'number' ? CONFIG.volume : 1.0;
                        queryObj.pitchScale = typeof CONFIG.pitch === 'number' ? CONFIG.pitch : 0.0;
                        queryObj.speedScale = typeof CONFIG.speed === 'number' ? CONFIG.speed : 1.0;
                        queryObj.intonationScale = typeof CONFIG.intonation === 'number' ? CONFIG.intonation : 1.0;
                        queryObj.prePhonemeLength = typeof CONFIG.delay === 'number' ? CONFIG.delay : 0.1;
                    } catch(e) {
                        return resolve();
                    }

                    GM_xmlhttpRequest({
                        method: "POST",
                        url: `http://127.0.0.1:${port}/synthesis?speaker=${speakerId}`,
                        headers: { "Content-Type": "application/json" },
                        data: JSON.stringify(queryObj),
                        responseType: "blob",
                        onload: (resSynth) => {
                            if (resSynth.status !== 200) return resolve();
                            const blobUrl = URL.createObjectURL(resSynth.response);
                            const audio = new Audio(blobUrl);
                            audio.onended = () => { URL.revokeObjectURL(blobUrl); resolve(); };
                            audio.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(); };
                            audio.play().catch((e) => {
                                console.log("🐰 [注意] 自動再生ブロック", e);
                                URL.revokeObjectURL(blobUrl);
                                resolve();
                            });
                        },
                        onerror: () => resolve()
                    });
                },
                onerror: () => resolve()
            });
        })).catch(e => console.log(e));
    }

    function readText(text) {
        if (CONFIG.engine === "bouyomi") sendToBouyomi(text);
        else if (CONFIG.engine === "voicevox") playVoicevoxApi(text, CONFIG.VOICEVOX_PORT, CONFIG.VOICEVOX_SPEAKER);
        else if (CONFIG.engine === "coeiroink") playVoicevoxApi(text, CONFIG.COEIROINK_PORT, CONFIG.COEIROINK_SPEAKER);
    }

    function processComment(rawText) {
        if (!rawText) return;
        const slicedText = rawText.length > 5 ? rawText.substring(5) : rawText;
        const cleanText = slicedText.replace(/>>\d+/g, '').replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, 'URL省略').trim();

        if (!cleanText || cleanText.includes("Room:スレ指定")) return;
        if (cleanText !== lastBouyomiText) {
            readText(cleanText);
            lastBouyomiText = cleanText;
        }
    }

    function startObserver() {
        const observer = new MutationObserver(() => {
            const klogs = document.querySelectorAll('klog');
            if (klogs.length === 0) return;
            const baseNode = klogs[klogs.length - 1].querySelector('.kcomm_base');
            if (baseNode) processComment(baseNode.textContent.replace(/\s+/g, ' ').trim());
        });

        const checkInterval = setInterval(() => {
            const targetBase = document.querySelector('.kcomm_base');
            if (targetBase) {
                const targetParent = targetBase.closest('klog').parentNode;
                observer.observe(targetParent, { childList: true, subtree: true });
                clearInterval(checkInterval);
            }
        }, 1000);
    }

    createUI();
    startObserver();

})();
