/**
 * HTTV - YouTube Edition (Zero-Failure Edition v8.0)
 * El motor de salto invisible. Detecta fallos al microsegundo.
 * Triple Proxy + Heartbeat Monitor + Validación de Título.
 */

class HTTV {
    constructor() {
        this.playerAId = 'player-a';
        this.playerBId = 'player-b';
        this.hashtagInput = document.getElementById('hashtag-search');
        this.searchBtn = document.getElementById('search-btn');
        this.intervalSelect = document.getElementById('interval-select');
        this.transitionSelect = document.getElementById('transition-select');
        this.progressBar = document.getElementById('progress-bar');
        this.currentTagEl = document.querySelector('.current-tag');
        this.startBtn = document.getElementById('btn-start');
        this.startScreen = document.getElementById('start-screen');
        this.tuningMask = document.getElementById('tuning-mask');
        this.tuningPerc = document.getElementById('tuning-perc');
        this.tuningStatus = document.getElementById('tuning-status');
        this.sidebar = document.getElementById('sidebar-lists');
        this.openSidebarBtn = document.getElementById('open-sidebar');
        this.closeSidebarBtn = document.getElementById('close-sidebar');
        this.btnAddList = document.getElementById('btn-add-list');
        this.listsContainer = document.getElementById('lists-container');
        this.mixerCheckboxGroup = document.getElementById('mixer-checkbox-group');
        this.toggleMixerBtn = document.getElementById('toggle-mixer');
        this.btnNext = document.getElementById('btn-next');
        this.btnSource = document.getElementById('btn-source');

        // Estado
        this.playerA = null;
        this.playerB = null;
        this.activePlayer = null;
        this.nextPlayer = null;
        this.signalType = 'LIVE'; 
        
        // Biblioteca Premium (IDs que YouTube NUNCA bloquea para incrustar)
        this.backupLibrary = {
            'cyberpunk': ['k70O57pS_78', '8Z1eMy2FoX4', 'qC0vDKVPCrw', 'W0LHTWG-UmQ', 'jfKfPfyJRdk', 'mUPrN6b001U', 'W_1YmI5p_8Q', '5pUnmC67tN0', '6SjOnvsh72c', 'Ym0Lp7rS7eU', '9YbeoIn8qL0'],
            'nature': ['_WpI0pS_780', 'k70O57pS_78', 'W_1YmI5p_8Q', '8Z1eMy2FoX4', 'jfKfPfyJRdk'],
            'default': ['k70O57pS_78', '8Z1eMy2FoX4', 'qC0vDKVPCrw', 'W0LHTWG-UmQ', 'mUPrN6b001U', 'W_1YmI5p_8Q', '5pUnmC67tN0', '6SjOnvsh72c', 'Ym0Lp7rS7eU', '9YbeoIn8qL0']
        };
        this.videos = [...this.backupLibrary.default];
        
        this.timer = 0;
        this.interval = parseInt(this.intervalSelect.value);
        this.fadeDuration = parseInt(this.transitionSelect.value);
        this.isPlaying = false;
        this.apiReady = false;
        this.isSwitching = false;
        this.isTuning = false;
        
        this.watchdogTimer = null;
        this.heartbeatInterval = null;
        this.lastTimeCheck = 0;
        this.stuckCount = 0;

        this.lists = JSON.parse(localStorage.getItem('httv_lists')) || [
            { id: '1', name: 'Cyberpunk Vibes', tags: ['cyberpunk 2077 cinematic', 'neon city 4k', 'cyberpunk city aerial'] },
            { id: '2', name: 'Nature 4K', tags: ['forest 4k wildlife', 'iceland 4k drone', 'underwater 4k'] }
        ];
        this.selectedMixerLists = Array.from(this.lists).map(l => l.id);
        this.mixerActive = false;
        this.mixerIndex = 0;

        this.shuffle(this.videos);
        this.init();
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    async init() {
        if (!window.YT) {
            const tag = document.createElement('script'); tag.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(tag);
        }
        window.onYouTubeIframeAPIReady = () => this.initPlayers();
        
        this.startBtn.addEventListener('click', () => this.start());
        this.searchBtn.addEventListener('click', () => this.handleSearch());
        this.btnNext.addEventListener('click', (e) => { e.preventDefault(); this.handleSkip(); });
        this.hashtagInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') this.handleSearch(); });
        this.intervalSelect.addEventListener('change', () => { this.interval = parseInt(this.intervalSelect.value); this.resetTimer(); });
        this.transitionSelect.addEventListener('change', () => {
            this.fadeDuration = parseInt(this.transitionSelect.value);
            document.documentElement.style.setProperty('--transition-speed', `${this.fadeDuration}ms`);
        });
        
        this.openSidebarBtn.addEventListener('click', () => this.sidebar.classList.add('open'));
        this.closeSidebarBtn.addEventListener('click', () => this.sidebar.classList.remove('open'));
        this.btnAddList.addEventListener('click', () => this.addNewList());
        this.toggleMixerBtn.addEventListener('click', () => this.toggleMixer());
        this.renderLists();
    }

    initPlayers() {
        const vars = { autoplay: 1, controls: 0, showinfo: 0, rel: 0, mute: 1, iv_load_policy: 3, modestbranding: 1, origin: window.location.origin, enablejsapi: 1 };
        this.playerA = new YT.Player(this.playerAId, {
            videoId: this.videos[0], playerVars: vars,
            events: { 'onReady': () => { this.checkReady(); }, 'onStateChange': (e) => this.handleStateChange(e), 'onError': (e) => this.handleYTError(e) }
        });
        this.playerB = new YT.Player(this.playerBId, {
            videoId: this.videos[1], playerVars: vars,
            events: { 'onReady': () => { this.checkReady(); }, 'onStateChange': (e) => this.handleStateChange(e), 'onError': (e) => this.handleYTError(e) }
        });
        this.activePlayer = this.playerA; this.nextPlayer = this.playerB;
    }

    checkReady() { if (this.playerA && this.playerB && typeof this.playerA.playVideo === 'function' && typeof this.playerB.playVideo === 'function') this.apiReady = true; }

    safeCall(player, method, ...args) {
        if (player && typeof player[method] === 'function') {
            try { player[method](...args); return true; } catch(e) { return false; }
        }
        return false;
    }

    updateTuning(progress, status) {
        if (this.tuningPerc) this.tuningPerc.textContent = `${Math.floor(progress)}%`;
        if (this.tuningStatus) this.tuningStatus.textContent = status;
    }

    async start() {
        this.startScreen.classList.add('hidden');
        this.tuningMask.classList.remove('hidden');
        this.isTuning = true;
        this.isPlaying = true;
        this.updateTuning(15, "Estableciendo Frecuencia...");

        const ids = await this.fetchVideos(this.hashtagInput.value);
        if (ids) { this.videos = ids; this.shuffle(this.videos); }
        
        while (!this.apiReady) {
            await new Promise(r => setTimeout(r, 400));
        }

        this.updateTuning(100, "Señal Encontrada.");
        this.safeCall(this.playerA, 'mute');
        this.safeCall(this.playerA, 'loadVideoById', this.videos[0]);
        this.safeCall(this.playerB, 'mute');
        this.safeCall(this.playerB, 'cueVideoById', this.videos[1]);
        
        this.startWatchdog();
        this.startHeartbeat();
    }

    async fetchVideos(query) {
        const instances = ['https://iv.ggtyler.dev', 'https://invidious.flokinet.to', 'https://inv.riverside.rocks', 'https://yewtu.be'];
        const instance = instances[Math.floor(Math.random() * instances.length)];
        const targetUrl = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;

        const proxies = [
            `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
            `https://thingproxy.freeboard.io/fetch/${targetUrl}`,
            `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`
        ];

        const fetchWithProxy = async (proxyUrl) => {
            const resp = await fetch(proxyUrl);
            if (!resp.ok) throw new Error();
            const data = await resp.json();
            const raw = data.contents || data;
            const items = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            if (Array.isArray(items) && items.length > 0) return items;
            throw new Error();
        };

        try {
            const items = await Promise.any(proxies.map(p => fetchWithProxy(p)));
            this.signalType = 'LIVE';
            return items.filter(v => v.lengthSeconds > 15).map(v => v.videoId);
        } catch (e) {
            this.signalType = 'LOCAL';
            const category = query.toLowerCase().includes('cyber') ? 'cyberpunk' : 
                             query.toLowerCase().includes('natur') ? 'nature' : 'default';
            return this.backupLibrary[category] || this.backupLibrary.default;
        }
    }

    handleYTError(errCode) { 
        console.warn("Fallo de Señal detectado. Saltando de inmediato...");
        this.isTuning = true;
        this.forceEmergencySkip(); 
    }

    forceEmergencySkip() {
        this.isTuning = true;
        this.updateTuning(50, "Buscando nueva frecuencia...");
        if(this.tuningMask) this.tuningMask.classList.remove('hidden');
        this.resetTimer();
        this.switchVideos();
    }

    startWatchdog() {
        if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
        this.watchdogTimer = setTimeout(() => {
            if (this.isPlaying && this.activePlayer) {
                const state = this.safeCall(this.activePlayer, 'getPlayerState');
                if (state === 3 || state === -1 || state === 5 || state === 0) {
                    this.handleYTError();
                }
            }
        }, 2500); 
    }

    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            if (!this.isPlaying || !this.activePlayer) return;
            
            const state = this.safeCall(this.activePlayer, 'getPlayerState');
            const curTime = this.safeCall(this.activePlayer, 'getCurrentTime') || 0;
            
            // Si el video está en "PLAYING" pero el tiempo no avanza -> ¡MUERTO!
            if (state === YT.PlayerState.PLAYING) {
                if (curTime === this.lastTimeCheck) {
                    this.stuckCount++;
                    if (this.stuckCount > 2) { // 2 segundos congelado
                        console.warn("Heartbeat: Video congelado o inaccesible. Saltando...");
                        this.handleYTError();
                    }
                } else {
                    this.stuckCount = 0;
                    this.lastTimeCheck = curTime;
                }
            }

            // Si está en UNSTARTED (-1) por más de 3 seg -> ¡MUERTO!
            if (state === -1) {
                this.stuckCount++;
                if (this.stuckCount > 3) this.handleYTError();
            }
        }, 1000);
    }

    fadeAudio(player, from, to, duration) {
        if (!player) return;
        this.safeCall(player, 'unMute');
        this.safeCall(player, 'setVolume', from);
        const steps = 10; const val = (to - from) / steps; let cur = from;
        const interval = setInterval(() => {
            cur += val;
            if ((val > 0 && cur >= to) || (val < 0 && cur <= to)) { this.safeCall(player, 'setVolume', to); clearInterval(interval); }
            else if (!this.safeCall(player, 'setVolume', cur)) clearInterval(interval); 
        }, duration/steps);
    }

    async handleSearch() {
        this.mixerActive = false;
        const query = this.hashtagInput.value.trim();
        if (!query) return;
        this.forceEmergencySkip();
        const ids = await this.fetchVideos(query);
        this.videos = ids;
        this.shuffle(this.videos);
        this.updateStatusText();
    }

    handleSkip() { this.forceEmergencySkip(); }

    tick() {
        if (!this.isPlaying) return;
        if (this.interval !== 0) {
            this.timer += 100;
            const progress = (this.timer / this.interval) * 100;
            if(this.progressBar) this.progressBar.style.width = `${Math.min(progress, 100)}%`;
            if (this.timer >= this.interval) this.switchVideos();
        }
        setTimeout(() => this.tick(), 100);
    }

    resetTimer() { this.timer = 0; if(this.progressBar) this.progressBar.style.width = '0%'; }

    async preloadNext() {
        try {
            const query = await this.getNextQuery();
            const ids = await this.fetchVideos(query);
            const nextId = ids[Math.floor(Math.random() * ids.length)];
            this.safeCall(this.nextPlayer, 'mute');
            this.safeCall(this.nextPlayer, 'cueVideoById', nextId);
        } catch(e) {}
    }

    async getNextQuery() {
        if (!this.mixerActive) return this.hashtagInput.value;
        const listId = this.selectedMixerLists[this.mixerIndex++ % this.selectedMixerLists.length];
        const list = this.lists.find(l => l.id === listId);
        return list && list.tags.length ? list.tags[Math.floor(Math.random() * list.tags.length)] : this.hashtagInput.value;
    }

    handleStateChange(ev) { 
        if (ev.data === YT.PlayerState.PLAYING && ev.target === this.activePlayer) {
            // Validación final de Título
            const data = this.activePlayer.getVideoData();
            if (!data || !data.title || data.title.toLowerCase().includes("unavailable") || data.title === "") {
                console.warn("Validación de título fallida. Saltando...");
                this.handleYTError();
                return;
            }

            if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
            if (this.isTuning) {
                // Solo quitar la máscara si el video realmente tiene progreso
                const checkProg = setInterval(() => {
                    if (this.safeCall(this.activePlayer, 'getCurrentTime') > 0.1) {
                        this.updateTuning(100, this.signalType === 'LIVE' ? "📡 SEÑAL EN VIVO" : "💾 SEÑAL LOCAL");
                        this.isTuning = false;
                        clearInterval(checkProg);
                        setTimeout(() => {
                            if(this.tuningMask) this.tuningMask.classList.add('hidden');
                            if (this.interval !== 0 && this.timer === 0) { this.updateStatusText(); this.tick(); }
                        }, 800);
                    }
                }, 200);
            }
        }
    }

    switchVideos() {
        if (this.isSwitching || !this.activePlayer || !this.nextPlayer) return;
        this.isSwitching = true;
        const incoming = this.nextPlayer;
        const outgoing = this.activePlayer;

        if (!this.safeCall(incoming, 'playVideo')) {
            setTimeout(() => { this.isSwitching = false; this.switchVideos(); }, 500);
            return;
        }
        
        this.safeCall(incoming, 'mute');
        this.startWatchdog();

        const complete = () => {
            if (incoming.getIframe() && incoming.getIframe().parentElement) incoming.getIframe().parentElement.classList.add('active');
            this.fadeAudio(incoming, 0, 100, this.fadeDuration); this.fadeAudio(outgoing, 100, 0, this.fadeDuration);
            setTimeout(() => {
                if (outgoing.getIframe() && outgoing.getIframe().parentElement) outgoing.getIframe().parentElement.classList.remove('active');
                this.safeCall(outgoing, 'pauseVideo');
                this.activePlayer = incoming; this.nextPlayer = outgoing;
                this.resetTimer(); this.updateStatusText(); this.preloadNext();
                const data = incoming.getVideoData(); if (data && data.video_id) this.btnSource.href = `https://www.youtube.com/watch?v=${data.video_id}`;
                this.isSwitching = false;
            }, this.fadeDuration);
        };

        const onPlay = (ev) => { if (ev.data === YT.PlayerState.PLAYING && ev.target === incoming) { complete(); incoming.removeEventListener('onStateChange', onPlay); } };
        incoming.addEventListener('onStateChange', onPlay);
        
        setTimeout(() => { if (this.isSwitching) complete(); }, 4000);
    }

    updateStatusText() { this.currentTagEl.textContent = this.mixerActive ? `Mix: ON` : `#${this.hashtagInput.value}`; }
    saveLists() { localStorage.setItem('httv_lists', JSON.stringify(this.lists)); }
    
    renderLists() {
        this.listsContainer.innerHTML = '';
        this.mixerCheckboxGroup.innerHTML = '';
        if(!this.lists) return;
        this.lists.forEach(list => {
            const item = document.createElement('div'); item.className = 'hashtag-list-item';
            item.innerHTML = `<input type="text" value="${list.name}" data-id="${list.id}" class="list-name-input">
                <input type="text" value="${list.tags.join(', ')}" data-id="${list.id}" class="list-tags-input">
                <button class="btn-delete" data-id="${list.id}">×</button>`;
            this.listsContainer.appendChild(item);
            const lbl = document.createElement('label');
            const chk = this.selectedMixerLists.includes(list.id);
            lbl.innerHTML = `<input type="checkbox" value="${list.id}" ${chk ? 'checked' : ''}> ${list.name}`;
            this.mixerCheckboxGroup.appendChild(lbl);
        });
        this.listsContainer.querySelectorAll('input').forEach(i => i.addEventListener('change', e => this.updateListData(e)));
        this.listsContainer.querySelectorAll('.btn-delete').forEach(b => b.addEventListener('click', e => this.deleteList(e.target.dataset.id)));
        this.mixerCheckboxGroup.querySelectorAll('input').forEach(i => i.addEventListener('change', () => this.updateMixerSelection()));
    }

    addNewList() { this.lists.push({ id: Date.now().toString(), name: 'Nueva Lista', tags: [] }); this.renderLists(); }
    updateListData(e) {
        const list = this.lists.find(l => l.id === e.target.dataset.id);
        if(!list) return;
        if (e.target.classList.contains('list-name-input')) list.name = e.target.value;
        else list.tags = e.target.value.split(',').map(t => t.trim()).filter(t => t !== '');
        this.saveLists(); this.renderLists();
    }
    deleteList(id) { this.lists = this.lists.filter(l => l.id !== id); this.selectedMixerLists = this.selectedMixerLists.filter(mid => mid !== id); this.saveLists(); this.renderLists(); }
    toggleMixer() { this.mixerActive = !this.mixerActive; this.toggleMixerBtn.textContent = this.mixerActive ? 'Mixer: ON' : 'Mixer: OFF'; this.toggleMixerBtn.classList.toggle('active', this.mixerActive); this.updateStatusText(); }
    updateMixerSelection() { this.selectedMixerLists = Array.from(this.mixerCheckboxGroup.querySelectorAll('input:checked')).map(i => i.value); }
}
window.addEventListener('DOMContentLoaded', () => { window.app = new HTTV(); });
