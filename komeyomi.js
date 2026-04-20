// ==UserScript==
// @name         komeyomi (⚙最強下詰め・OBS WebSocketネイティブ連携版 v9)
// @namespace    http://tampermonkey.net/
// @version      28.00
// @description  おーぷん2chのコメント読み上げ。OBS WebSocket v5対応。テキストソースへの直接書き込みとポート設定の並び順を最適化。
// @author       うさぎ
// @match        https://*.open2ch.net/test/read.cgi/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(function() {
    'use strict';

    // デフォルト設定
    const DEFAULT_CONFIG = {
        engine: "bouyomi",
        VOICEVOX_PORT: 50021,
        COEIROINK_PORT: 50032,
        BOUYOMI_PORT: 50080,
        SEIKA_PORT: 7180,
        BOUYOMI_SPEAKER: 0,
        VOICEVOX_SPEAKER: 3,
        COEIROINK_SPEAKER: 0,
        SEIKA_SPEAKER: 0,
        volume: 1.00,
        pitch: 0.00,
        speed: 1.00,
        intonation: 1.00,
        delay: 0.10,
        sidebarBg: "#ffffff",
        commentBg: "#f9f9f9",
        fontSize: 14,
        fontFamily: "sans-serif",
        appendDir: "bottom",
        itemGap: 8,
        itemPadding: 8,
        ngWords: "",
        // OBS連携設定
        useOBS: false,
        OBS_PORT: 4455,
        OBS_PASSWORD: "",
        OBS_TEXT_SOURCE: ""
    };

    let CONFIG = { ...DEFAULT_CONFIG, ...(JSON.parse(localStorage.getItem('komeyomi_config')) || {}) };
    const saveConfig = () => localStorage.setItem('komeyomi_config', JSON.stringify(CONFIG));

    let lastRawText = "";
    let audioQueue = Promise.resolve();

    const BOUYOMI_VOICES = [
        {id: 0, name: "デフォルト"}, {id: 1, name: "女性1"}, {id: 2, name: "女性2"},
        {id: 3, name: "男性1"}, {id: 4, name: "男性2"}, {id: 5, name: "中性"},
        {id: 6, name: "ロボット"}, {id: 7, name: "機械1"}, {id: 8, name: "機械2"}
    ];

    // --- スタイル注入 ---
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #komeyomi-sidebar * { box-sizing: border-box; }
            #komeyomi-sidebar-scroll {
                flex-grow: 1; min-height: 0; display: flex; 
                padding: 15px 10px 20px 16px; 
                overflow: hidden;
            }
            .ky-comment-item {
                border-radius: 5px; border: 1px solid #e0e0e0;
                word-break: break-all; line-height: 1.4; flex-shrink: 0;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            }
            @keyframes kyPopInBottom { 0% { opacity: 0; transform: translateY(15px) scale(0.95); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
            @keyframes kyPopInTop { 0% { opacity: 0; transform: translateY(-15px) scale(0.95); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
        `;
        document.head.appendChild(style);
    }

    // --- APIリクエスト (話者取得) ---
    function fetchSpeakers(port, selectElement, currentVal) {
        selectElement.innerHTML = '<option value="">⏳ 取得中...</option>';
        GM_xmlhttpRequest({
            method: "GET", url: `http://127.0.0.1:${port}/speakers`,
            onload: (res) => {
                if(res.status === 200) {
                    try {
                        const speakers = JSON.parse(res.responseText);
                        selectElement.innerHTML = '';
                        speakers.forEach(sp => sp.styles.forEach(style => {
                            const opt = document.createElement('option');
                            opt.value = style.id; opt.textContent = `${sp.name} (${style.name})`;
                            if(style.id == currentVal) opt.selected = true;
                            selectElement.appendChild(opt);
                        }));
                    } catch(e) { selectElement.innerHTML = '<option value="">取得失敗</option>'; }
                }
            },
            onerror: () => { selectElement.innerHTML = '<option value="">未起動</option>'; }
        });
    }

    // --- UI生成 ---
    function createUI() {
        injectStyles();

        const uiContainer = document.createElement('div');
        uiContainer.innerHTML = `
            <div id="komeyomi-btn" style="position:fixed; bottom:20px; left:20px; width:45px; height:45px; background:#fff; border:1px solid #ccc; border-radius:5px; box-shadow:0 2px 5px rgba(0,0,0,0.2); font-size:24px; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:9999; user-select:none;" title="設定">⚙️</div>
            <div id="komeyomi-tv-btn" style="position:fixed; bottom:20px; left:75px; width:45px; height:45px; background:#fff; border:1px solid #ccc; border-radius:5px; box-shadow:0 2px 5px rgba(0,0,0,0.2); font-size:24px; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:9999; user-select:none;" title="コメント枠表示/非表示">📺</div>

            <div id="komeyomi-panel" style="display:none; position:fixed; bottom:75px; left:20px; width:310px; background:#fff; border:1px solid #ccc; border-radius:5px; box-shadow:0 2px 10px rgba(0,0,0,0.2); font-size:13px; color:#333; z-index:9999; font-family:sans-serif; overflow:hidden;">
                <div style="display:flex; background:#f0f0f0; border-bottom:1px solid #ccc;">
                    <div class="ky-tab" data-target="ky-tab-voice" style="flex:1; text-align:center; padding:8px 0; cursor:pointer; font-weight:bold; background:#fff; border-bottom:2px solid #ffb6c1; color:#ffb6c1;">音声</div>
                    <div class="ky-tab" data-target="ky-tab-disp" style="flex:1; text-align:center; padding:8px 0; cursor:pointer; color:#888;">画面</div>
                    <div class="ky-tab" data-target="ky-tab-engine" style="flex:1; text-align:center; padding:8px 0; cursor:pointer; color:#888;">接続</div>
                </div>

                <div style="padding:15px; max-height:450px; overflow-y:auto;">
                    <div id="ky-tab-voice" class="ky-tab-content" style="display:block;">
                        <div style="margin-bottom:10px;">
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">🔊 読み上げエンジン</label>
                            <select id="ky_engine" style="width:100%; padding:4px;">
                                <option value="bouyomi">棒読みちゃん</option><option value="voicevox">VOICEVOX</option>
                                <option value="coeiroink">COEIROINK</option><option value="seika">AssistantSeika</option>
                            </select>
                        </div>
                        <div style="margin-bottom:10px; background:#f9f9f9; padding:8px; border-radius:4px; border:1px solid #eee;">
                            <div id="wrap_bouyomi">話者: <select id="ky_bo_spk" style="width:55%;"></select> <button id="btn_bo_test" style="padding:2px 5px; cursor:pointer;">▶️</button></div>
                            <div id="wrap_voicevox" style="display:none;">VV話者: <select id="ky_vv_spk" style="width:45%;"></select> <button id="btn_vv_fetch" style="padding:2px 3px; cursor:pointer;">🔄</button> <button id="btn_vv_test" style="padding:2px 3px; cursor:pointer;">▶️</button></div>
                            <div id="wrap_coeiroink" style="display:none;">CO話者: <select id="ky_co_spk" style="width:45%;"></select> <button id="btn_co_fetch" style="padding:2px 3px; cursor:pointer;">🔄</button> <button id="btn_co_test" style="padding:2px 3px; cursor:pointer;">▶️</button></div>
                            <div id="wrap_seika" style="display:none;">Seika CID: <input type="number" id="ky_sk_spk" min="0" style="width:50px; padding:2px;"> <button id="btn_sk_test" style="padding:2px 5px; cursor:pointer;">▶️</button></div>
                        </div>
                        <div style="display:grid; grid-template-columns:35px 1fr 50px; gap:5px; align-items:center;">
                            <span>音量</span><input type="range" id="k_vol" min="0" max="2" step="0.01"><input type="number" id="v_vol" min="0" max="2" step="0.01" style="width:45px; padding:1px; text-align:right;">
                            <span>高音</span><input type="range" id="k_pit" min="-0.15" max="0.15" step="0.01"><input type="number" id="v_pit" min="-0.15" max="0.15" step="0.01" style="width:45px; padding:1px; text-align:right;">
                            <span>話速</span><input type="range" id="k_spd" min="0.5" max="2" step="0.01"><input type="number" id="v_spd" min="0.5" max="2" step="0.01" style="width:45px; padding:1px; text-align:right;">
                            <span>抑揚</span><input type="range" id="k_int" min="0" max="2" step="0.01"><input type="number" id="v_int" min="0" max="2" step="0.01" style="width:45px; padding:1px; text-align:right;">
                            <span>遅延</span><input type="range" id="k_del" min="0" max="2" step="0.01"><input type="number" id="v_del" min="0" max="2" step="0.01" style="width:45px; padding:1px; text-align:right;">
                        </div>
                        <div style="margin-top:15px; padding-top:10px; border-top:1px solid #eee;">
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">🚫 NGワード (カンマ区切り)</label>
                            <input type="text" id="k_ng_words" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:3px;">
                        </div>
                    </div>

                    <div id="ky-tab-disp" class="ky-tab-content" style="display:none;">
                        <div style="display:grid; grid-template-columns:50px 1fr; gap:8px; align-items:center;">
                            <span>背景色</span><input type="color" id="k_sbg" style="width:100%; height:25px; padding:0; cursor:pointer;">
                            <span>枠の色</span><input type="color" id="k_cbg" style="width:100%; height:25px; padding:0; cursor:pointer;">
                            <span>サイズ</span><div><input type="number" id="k_fsz" min="8" max="72" style="width:50px; padding:2px;"> px</div>
                            <span>フォント</span>
                            <select id="k_fnt" style="width:100%; padding:3px;">
                                <option value="sans-serif">ゴシック体</option><option value="serif">明朝体</option>
                                <option value="monospace">等幅フォント</option><option value="メイリオ, Meiryo, sans-serif">メイリオ</option>
                                <option value="'ヒラギノ角ゴ Pro W3', 'Hiragino Kaku Gothic Pro', sans-serif">ヒラギノ</option>
                            </select>
                            <span>流れ方</span>
                            <select id="k_dir" style="width:100%; padding:3px;">
                                <option value="bottom">下詰め (一番下からポップして上に押し出し)</option>
                                <option value="top">上詰め (一番上からポップして下に押し出し)</option>
                            </select>
                        </div>
                        <div style="display:grid; grid-template-columns:35px 1fr 45px; gap:8px; align-items:center; margin-top:12px; padding-top:12px; border-top:1px solid #eee;">
                            <span>隙間</span><input type="range" id="k_gap" min="0" max="50" step="1"><input type="number" id="v_gap" min="0" max="50" style="width:100%; padding:2px; box-sizing:border-box; text-align:right;">
                            <span>余白</span><input type="range" id="k_pad" min="0" max="50" step="1"><input type="number" id="v_pad" min="0" max="50" style="width:100%; padding:2px; box-sizing:border-box; text-align:right;">
                        </div>
                    </div>

                    <div id="ky-tab-engine" class="ky-tab-content" style="display:none;">
                        <div style="font-weight:bold; margin-bottom:5px; border-bottom:1px solid #eee; padding-bottom:5px;">🔌 音声ポート番号</div>
                        <div style="display:grid; grid-template-columns:100px 1fr; gap:5px; align-items:center; margin-bottom:15px;">
                            <span>VOICEVOX:</span><input type="number" id="k_port_voicevox" style="width:80px; padding:2px; border:1px solid #ccc; border-radius:3px;">
                            <span>COEIROINK:</span><input type="number" id="k_port_coeiroink" style="width:80px; padding:2px; border:1px solid #ccc; border-radius:3px;">
                            <span>棒読みちゃん:</span><input type="number" id="k_port_bouyomi" style="width:80px; padding:2px; border:1px solid #ccc; border-radius:3px;">
                            <span>Asst.Seika:</span><input type="number" id="k_port_seika" style="width:80px; padding:2px; border:1px solid #ccc; border-radius:3px;">
                        </div>
                        
                        <div style="font-weight:bold; margin-bottom:5px; border-bottom:1px solid #eee; padding-bottom:5px; display:flex; align-items:center; gap:5px;">
                            <input type="checkbox" id="k_use_obs" style="cursor:pointer;"> <label for="k_use_obs" style="cursor:pointer;">📡 OBS WebSocket送信</label>
                        </div>
                        <div style="display:grid; grid-template-columns:100px 1fr; gap:5px; align-items:center;">
                            <span>ポート:</span><input type="number" id="k_port_obs" style="width:80px; padding:2px; border:1px solid #ccc; border-radius:3px;" placeholder="4455">
                            <span>パスワード:</span><input type="password" id="k_pass_obs" style="width:100%; padding:2px; box-sizing:border-box; border:1px solid #ccc; border-radius:3px;">
                            <span>テキスト元:</span><input type="text" id="k_src_obs" style="width:100%; padding:2px; box-sizing:border-box; border:1px solid #ccc; border-radius:3px;" placeholder="OBSのテキストソース名">
                        </div>
                        <button id="btn_obs_test" style="margin-top:10px; width:100%; padding:5px; cursor:pointer; background:#f0f0f0; border:1px solid #ccc; border-radius:3px; font-weight:bold;">OBS接続テスト</button>
                        <div style="font-size:10px; color:#888; margin-top:5px; line-height:1.3;">※OBSの「ツール」→「WebSocketサーバー設定」の情報を入力し、書き込み先のテキスト(GDI+)ソース名を指定してください。</div>
                    </div>
                </div>
            </div>

            <div id="komeyomi-sidebar" style="display:none; position:fixed; top:0; bottom:0; right:0; width:300px; z-index:9998; border-left:1px solid #ccc; box-shadow:-2px 0 10px rgba(0,0,0,0.1); flex-direction:column; color:#333;">
                <div id="komeyomi-resizer" style="position:absolute; top:0; left:0; width:6px; height:100%; cursor:ew-resize; background:#e0e0e0; border-right:1px solid #fff; z-index:9999; transition:background 0.2s;" title="ドラッグで幅を変更"></div>
                <div id="komeyomi-sidebar-scroll"></div>
            </div>
        `;
        document.body.appendChild(uiContainer);

        setupEventListeners();
    }

    // --- イベントリスナー等の初期化 ---
    function setupEventListeners() {
        const _ = (id) => document.getElementById(id); 
        const panel = _('komeyomi-panel');
        const sidebar = _('komeyomi-sidebar');
        const scrollArea = _('komeyomi-sidebar-scroll');
        const selectEngine = _('ky_engine');
        const selectVv = _('ky_vv_spk');
        const selectCo = _('ky_co_spk');
        
        // タブ切り替え
        const tabs = document.querySelectorAll('.ky-tab');
        const contents = document.querySelectorAll('.ky-tab-content');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => { t.style.background = '#f0f0f0'; t.style.color = '#888'; t.style.borderBottom = 'none'; t.style.fontWeight = 'normal'; });
                contents.forEach(c => c.style.display = 'none');
                tab.style.background = '#fff'; tab.style.color = '#ffb6c1'; tab.style.borderBottom = '2px solid #ffb6c1'; tab.style.fontWeight = 'bold';
                _(tab.dataset.target).style.display = 'block';
            });
        });

        // 音声ポート＆話者バインド
        const bindInput = (id, configKey, isInt = false) => {
            _(id).value = CONFIG[configKey];
            _(id).addEventListener('change', (e) => {
                CONFIG[configKey] = isInt ? parseInt(e.target.value, 10) || 0 : e.target.value;
                saveConfig();
            });
        };
        ['VOICEVOX', 'COEIROINK', 'BOUYOMI', 'SEIKA'].forEach(name => bindInput(`k_port_${name.toLowerCase()}`, `${name}_PORT`, true));
        bindInput('k_ng_words', 'ngWords');
        
        const selectBo = _('ky_bo_spk');
        BOUYOMI_VOICES.forEach(v => {
            const opt = document.createElement('option'); opt.value = v.id; opt.textContent = v.name;
            if(v.id == CONFIG.BOUYOMI_SPEAKER) opt.selected = true; selectBo.appendChild(opt);
        });
        bindInput('ky_bo_spk', 'BOUYOMI_SPEAKER', true);
        bindInput('ky_vv_spk', 'VOICEVOX_SPEAKER', true);
        bindInput('ky_co_spk', 'COEIROINK_SPEAKER', true);
        bindInput('ky_sk_spk', 'SEIKA_SPEAKER', true);

        const updateEngineView = () => {
            ['bouyomi', 'voicevox', 'coeiroink', 'seika'].forEach(eng => { _(`wrap_${eng}`).style.display = selectEngine.value === eng ? 'block' : 'none'; });
        };
        selectEngine.value = CONFIG.engine; updateEngineView();
        selectEngine.addEventListener('change', (e) => { CONFIG.engine = e.target.value; updateEngineView(); saveConfig(); });
        _('btn_vv_fetch').addEventListener('click', () => fetchSpeakers(CONFIG.VOICEVOX_PORT, selectVv, CONFIG.VOICEVOX_SPEAKER));
        _('btn_co_fetch').addEventListener('click', () => fetchSpeakers(CONFIG.COEIROINK_PORT, selectCo, CONFIG.COEIROINK_SPEAKER));

        // 音声スライダー
        const params = ['vol', 'pit', 'spd', 'int', 'del'];
        const configKeys = { vol: 'volume', pit: 'pitch', spd: 'speed', int: 'intonation', del: 'delay' };
        params.forEach(p => {
            const slider = _(`k_${p}`), numInput = _(`v_${p}`);
            const updateVal = (val) => {
                val = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), isNaN(val) ? DEFAULT_CONFIG[configKeys[p]] : val));
                val = Math.round(val * 100) / 100;
                slider.value = val; numInput.value = val.toFixed(2);
                CONFIG[configKeys[p]] = val; saveConfig();
            };
            updateVal(CONFIG[configKeys[p]]);
            slider.addEventListener('input', (e) => updateVal(parseFloat(e.target.value)));
            numInput.addEventListener('change', (e) => updateVal(parseFloat(e.target.value)));
            slider.addEventListener('wheel', (e) => { e.preventDefault(); updateVal(CONFIG[configKeys[p]] + (e.deltaY < 0 ? 0.01 : -0.01)); }, { passive: false });
            numInput.addEventListener('wheel', (e) => { e.preventDefault(); updateVal(CONFIG[configKeys[p]] + (e.deltaY < 0 ? 0.01 : -0.01)); }, { passive: false });
        });

        // 画面レイアウトの適用
        const applySidebarStyles = () => {
            sidebar.style.background = CONFIG.sidebarBg; sidebar.style.fontFamily = CONFIG.fontFamily;
            scrollArea.style.gap = CONFIG.itemGap + 'px';
            if (CONFIG.appendDir === 'bottom') {
                scrollArea.style.flexDirection = 'column-reverse'; scrollArea.style.justifyContent = 'flex-start';
                scrollArea.style.maskImage = 'linear-gradient(to bottom, transparent 0%, black 10%, black 100%)';
                scrollArea.style.webkitMaskImage = 'linear-gradient(to bottom, transparent 0%, black 10%, black 100%)';
            } else {
                scrollArea.style.flexDirection = 'column'; scrollArea.style.justifyContent = 'flex-start';
                scrollArea.style.maskImage = 'linear-gradient(to top, transparent 0%, black 10%, black 100%)';
                scrollArea.style.webkitMaskImage = 'linear-gradient(to top, transparent 0%, black 10%, black 100%)';
            }
            scrollArea.querySelectorAll('.ky-comment-item').forEach(item => {
                item.style.background = CONFIG.commentBg; item.style.fontSize = CONFIG.fontSize + 'px'; item.style.padding = CONFIG.itemPadding + 'px';
            });
        };

        ['k_sbg', 'k_cbg', 'k_fsz', 'k_fnt', 'k_dir'].forEach(id => {
            const key = id === 'k_sbg' ? 'sidebarBg' : id === 'k_cbg' ? 'commentBg' : id === 'k_fsz' ? 'fontSize' : id === 'k_fnt' ? 'fontFamily' : 'appendDir';
            _(id).value = CONFIG[key];
            _(id).addEventListener('change', (e) => { CONFIG[key] = id === 'k_fsz' ? parseInt(e.target.value) : e.target.value; saveConfig(); applySidebarStyles(); });
        });

        // 隙間・余白スライダー
        ['gap', 'pad'].forEach(id => {
            const key = id === 'gap' ? 'itemGap' : 'itemPadding';
            const slider = _(`k_${id}`), num = _(`v_${id}`);
            const update = (val) => {
                val = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), isNaN(val) ? DEFAULT_CONFIG[key] : val));
                slider.value = val; num.value = val; CONFIG[key] = val; saveConfig(); applySidebarStyles();
            };
            update(CONFIG[key]);
            slider.addEventListener('input', e => update(parseInt(e.target.value)));
            num.addEventListener('change', e => update(parseInt(e.target.value)));
        });
        applySidebarStyles();

        // --- OBS設定のバインドと再接続処理 ---
        _('k_use_obs').checked = CONFIG.useOBS;
        _('k_use_obs').addEventListener('change', (e) => { CONFIG.useOBS = e.target.checked; saveConfig(); connectOBS(); });
        
        const reconnectOBS = () => { saveConfig(); if(CONFIG.useOBS) connectOBS(); };
        _('k_port_obs').value = CONFIG.OBS_PORT;
        _('k_port_obs').addEventListener('change', (e) => { CONFIG.OBS_PORT = parseInt(e.target.value) || 4455; reconnectOBS(); });
        _('k_pass_obs').value = CONFIG.OBS_PASSWORD;
        _('k_pass_obs').addEventListener('change', (e) => { CONFIG.OBS_PASSWORD = e.target.value; reconnectOBS(); });
        _('k_src_obs').value = CONFIG.OBS_TEXT_SOURCE;
        _('k_src_obs').addEventListener('change', (e) => { CONFIG.OBS_TEXT_SOURCE = e.target.value; saveConfig(); });

        _('btn_obs_test').addEventListener('click', () => {
            if (!CONFIG.useOBS) return alert("「OBS WebSocket送信」のチェックをオンにしてください。");
            if (!obsWs || obsWs.readyState !== 1) return alert("OBSと未接続です。OBS側のWebSocketサーバー設定とポート、パスワードを確認してください。");
            if (!CONFIG.OBS_TEXT_SOURCE) return alert("書き込み先の「テキストソース名」を入力してください。");
            sendToOBS("✅ OBSテキスト連携テスト成功！");
            alert("OBSのテキストソースへ送信しました。OBSの画面を確認してください！");
        });

        // UI表示制御
        _('komeyomi-btn').addEventListener('click', () => {
            const isOpening = panel.style.display === 'none'; panel.style.display = isOpening ? 'block' : 'none';
            if (isOpening) {
                if (selectVv.options.length === 0) fetchSpeakers(CONFIG.VOICEVOX_PORT, selectVv, CONFIG.VOICEVOX_SPEAKER);
                if (selectCo.options.length === 0) fetchSpeakers(CONFIG.COEIROINK_PORT, selectCo, CONFIG.COEIROINK_SPEAKER);
            }
        });
        const tvBtn = _('komeyomi-tv-btn');
        tvBtn.addEventListener('click', () => {
            const match = window.location.pathname.match(/\/test\/read\.cgi\/([^/]+)\/([^/]+)/);
            if (match) { navigator.clipboard.writeText(`${match[1]}-${match[2]}`).then(() => { const orig = tvBtn.innerText; tvBtn.innerText = "✅"; setTimeout(() => { tvBtn.innerText = orig; }, 2000); }); }
            sidebar.style.display = sidebar.style.display === 'none' ? 'flex' : 'none';
            tvBtn.style.background = sidebar.style.display === 'none' ? '#fff' : '#f0f0f0';
        });

        // テスト音声
        const doTest = (eng, port, spk) => {
            const testText = "音声テストです。";
            if (eng === 'bouyomi' || eng === 'seika') sendToBouyomiOrSeika(testText, port, spk);
            else playVoicevoxApi(testText, port, spk);
            appendToSidebar("🔧 [テスト] " + testText);
        };
        _('btn_bo_test').addEventListener('click', () => doTest('bouyomi', CONFIG.BOUYOMI_PORT, CONFIG.BOUYOMI_SPEAKER));
        _('btn_sk_test').addEventListener('click', () => doTest('seika', CONFIG.SEIKA_PORT, CONFIG.SEIKA_SPEAKER));
        _('btn_vv_test').addEventListener('click', () => doTest('voicevox', CONFIG.VOICEVOX_PORT, CONFIG.VOICEVOX_SPEAKER));
        _('btn_co_test').addEventListener('click', () => doTest('coeiroink', CONFIG.COEIROINK_PORT, CONFIG.COEIROINK_SPEAKER));

        // リサイズ
        const resizer = _('komeyomi-resizer');
        let isResizing = false, startX = 0, startWidth = 0;
        resizer.addEventListener('mousedown', (e) => { isResizing = true; startX = e.clientX; startWidth = parseInt(getComputedStyle(sidebar).width); document.body.style.userSelect = 'none'; resizer.style.background = '#cccccc'; });
        resizer.addEventListener('mouseenter', () => resizer.style.background = '#cccccc');
        resizer.addEventListener('mouseleave', () => { if(!isResizing) resizer.style.background = '#e0e0e0'; });
        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            sidebar.style.width = Math.max(150, Math.min(window.innerWidth - 50, startWidth - ((e.clientX - startX) * 0.5))) + 'px';
        });
        window.addEventListener('mouseup', () => { if(isResizing){ isResizing = false; document.body.style.userSelect = ''; resizer.style.background = '#e0e0e0'; } });
    }

    // --- OBS WebSocket連携ネイティブ処理 ---
    let obsWs = null;
    let obsReconnectTimer = null;

    // OBS v5 パスワードハッシュ計算用ヘルパー
    async function sha256Base64(str) {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    function connectOBS() {
        if (!CONFIG.useOBS) {
            if (obsWs) { obsWs.close(); obsWs = null; }
            return;
        }
        if (obsWs && (obsWs.readyState === 0 || obsWs.readyState === 1)) return; // 接続中または接続済み

        console.log("🐰 [komeyomi] OBS WebSocketに接続しています...");
        obsWs = new WebSocket(`ws://127.0.0.1:${CONFIG.OBS_PORT}`);

        obsWs.onopen = () => console.log("🐰 [komeyomi] OBSサーバー応答。認証準備...");

        obsWs.onmessage = async (e) => {
            const msg = JSON.parse(e.data);
            if (msg.op === 0) { // Hello (サーバー情報と認証要件)
                let identifyParams = { rpcVersion: 1 };
                if (msg.d.authentication) {
                    const pass = CONFIG.OBS_PASSWORD;
                    const salt = msg.d.authentication.salt;
                    const chal = msg.d.authentication.challenge;
                    const secretStr = await sha256Base64(pass + salt);
                    identifyParams.authentication = await sha256Base64(secretStr + chal);
                }
                obsWs.send(JSON.stringify({ op: 1, d: identifyParams })); // Identify (認証要求送信)
            } else if (msg.op === 2) { // Identified
                console.log("🐰 [komeyomi] OBS 認証成功！準備完了です。");
            }
        };

        obsWs.onclose = () => {
            obsWs = null;
            clearTimeout(obsReconnectTimer);
            if (CONFIG.useOBS) {
                console.log("🐰 [komeyomi] OBSから切断されました。5秒後に再接続します...");
                obsReconnectTimer = setTimeout(connectOBS, 5000);
            }
        };
        obsWs.onerror = () => console.log("🐰 [komeyomi] OBS接続エラー。ポート設定等を確認してください。");
    }

    function sendToOBS(text) {
        if (!CONFIG.useOBS || !obsWs || obsWs.readyState !== 1 || !CONFIG.OBS_TEXT_SOURCE) return;
        obsWs.send(JSON.stringify({
            op: 6, // Request
            d: {
                requestType: 'SetInputSettings',
                requestId: 'komeyomi_' + Date.now(),
                requestData: {
                    inputName: CONFIG.OBS_TEXT_SOURCE,
                    inputSettings: { text: text }
                }
            }
        }));
    }

    // --- 音声処理 ---
    function sendToBouyomiOrSeika(text, port, speakerId) {
        const query = `text=${encodeURIComponent(text)}&volume=${Math.round(CONFIG.volume * 50)}&speed=${Math.round(CONFIG.speed * 100)}&tone=${Math.round(100 + (CONFIG.pitch * 333))}&voice=${speakerId}`;
        GM_xmlhttpRequest({ method: "GET", url: `http://127.0.0.1:${port}/talk?${query}`, onerror: () => console.log(`🐰 [エラー] ポート${port}通信失敗`) });
    }

    function playVoicevoxApi(text, port, speakerId) {
        audioQueue = audioQueue.then(() => new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "POST", url: `http://127.0.0.1:${port}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
                onload: (res) => {
                    if (res.status !== 200) return resolve();
                    try {
                        const queryObj = JSON.parse(res.responseText);
                        queryObj.volumeScale = CONFIG.volume; queryObj.pitchScale = CONFIG.pitch; queryObj.speedScale = CONFIG.speed; queryObj.intonationScale = CONFIG.intonation; queryObj.prePhonemeLength = CONFIG.delay;
                        GM_xmlhttpRequest({
                            method: "POST", url: `http://127.0.0.1:${port}/synthesis?speaker=${speakerId}`,
                            headers: { "Content-Type": "application/json" }, data: JSON.stringify(queryObj), responseType: "blob",
                            onload: (synthRes) => {
                                if (synthRes.status !== 200) return resolve();
                                const audio = new Audio(URL.createObjectURL(synthRes.response));
                                audio.onended = audio.onerror = () => { URL.revokeObjectURL(audio.src); resolve(); };
                                audio.play().catch(resolve);
                            }, onerror: resolve
                        });
                    } catch(e) { resolve(); }
                }, onerror: resolve
            });
        }));
    }

    // --- コメント処理 ---
    function appendToSidebar(text) {
        const scrollArea = document.getElementById('komeyomi-sidebar-scroll');
        if (!scrollArea) return;

        const msgDiv = document.createElement('div');
        msgDiv.className = 'ky-comment-item';
        msgDiv.style.background = CONFIG.commentBg;
        msgDiv.style.fontSize = CONFIG.fontSize + 'px';
        msgDiv.style.padding = CONFIG.itemPadding + 'px';
        msgDiv.innerText = text;
        msgDiv.style.animation = CONFIG.appendDir === 'bottom' ? 'kyPopInBottom 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards' : 'kyPopInTop 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards';

        scrollArea.prepend(msgDiv);
        while (scrollArea.children.length > 30) scrollArea.removeChild(scrollArea.lastChild);
    }

    function processComment(rawText) {
        if (!rawText || rawText === lastRawText) return;
        lastRawText = rawText;

        const cleanText = (rawText.length > 5 ? rawText.substring(5) : rawText).replace(/>>\d+/g, '').replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, 'URL省略').trim();
        if (!cleanText || cleanText.includes("Room:スレ指定")) return;

        if (CONFIG.ngWords) {
            const ngArray = CONFIG.ngWords.split(',').map(w => w.trim()).filter(w => w.length > 0);
            if (ngArray.some(ng => cleanText.includes(ng))) return;
        }
        
        // 音声読み上げ
        if (CONFIG.engine === "bouyomi") sendToBouyomiOrSeika(cleanText, CONFIG.BOUYOMI_PORT, CONFIG.BOUYOMI_SPEAKER);
        else if (CONFIG.engine === "seika") sendToBouyomiOrSeika(cleanText, CONFIG.SEIKA_PORT, CONFIG.SEIKA_SPEAKER);
        else if (CONFIG.engine === "voicevox") playVoicevoxApi(cleanText, CONFIG.VOICEVOX_PORT, CONFIG.VOICEVOX_SPEAKER);
        else if (CONFIG.engine === "coeiroink") playVoicevoxApi(cleanText, CONFIG.COEIROINK_PORT, CONFIG.COEIROINK_SPEAKER);
        
        // 画面追加 ＆ OBS送信
        appendToSidebar(cleanText);
        sendToOBS(cleanText);
    }

    // --- DOM監視 ---
    function startObserver() {
        const observer = new MutationObserver((mutations) => {
            let latestComment = null;
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) { 
                            const baseNode = node.classList?.contains('kcomm_base') ? node : (node.querySelector && node.querySelector('.kcomm_base'));
                            if (baseNode) latestComment = baseNode.textContent.replace(/\s+/g, ' ').trim();
                        }
                    }
                }
            }
            if (latestComment) processComment(latestComment);
        });

        const checkInterval = setInterval(() => {
            const targetBase = document.querySelector('.kcomm_base');
            if (targetBase) {
                observer.observe(targetBase.closest('klog').parentNode, { childList: true, subtree: true });
                clearInterval(checkInterval);
            }
        }, 1000);
    }

    // 起動処理
    createUI();
    startObserver();
    connectOBS(); // スクリプト起動時にOBS接続を開始

})();
