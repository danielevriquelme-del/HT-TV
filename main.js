/**
 * HTTV v11.0 — Simple Playlist
 * Arquitectura limpia: Listas → Busca 20 → Reproduce uno a uno con fade de audio.
 * Sin precarga doble, sin proxies muertos, sin bucles.
 */

// --- Archivo Maestro por categoría (fallback si la API falla) ---
const MASTER = {
    cyberpunk: ['8Z1eMy2FoX4','qC0vDKVPCrw','W0LHTWG-UmQ','mUPrN6b001U','W_1YmI5p_8Q','5pUnmC67tN0','6SjOnvsh72c','Ym0Lp7rS7eU','9YbeoIn8qL0','jfKfPfyJRdk','k70O57pS_78','RkH_1YpS_z8','mS97mPrS_wU','QbX1cBuFIWE','ExDQ8SRt2lc'],
    nature:    ['TcnkzPAHWcU','lBRF2vBg_j4','R33EIcHLFkQ','8MXpzFiHGUI','EFBhSg_xqDQ','kOkQ4T5WO9E','JcgXHls3oE8','0W8_mk0UF5I','fBwZLmGisCQ','iKJZlFvnr1Y'],
    lofi:      ['jfKfPfyJRdk','5qap5aO4i9A','DWcJFNfaw9c','lTRiuFIWV54','4xDzrJKXOOY','MVPTGkEgpb0','oSMmbzv6Kuk','b8g_vhEkKWs','TcnkzPAHWcU','kZyd5jTROR0'],
    anime:     ['mUPrN6b001U','W_1YmI5p_8Q','_coSgIXSS9I','8T5CElbsRxk','lTRiuFIWV54','4xDzrJKXOOY','MVPTGkEgpb0','oSMmbzv6Kuk','b8g_vhEkKWs','rAa_b4s1gVY'],
    default:   ['8Z1eMy2FoX4','qC0vDKVPCrw','W0LHTWG-UmQ','mUPrN6b001U','W_1YmI5p_8Q','5pUnmC67tN0','6SjOnvsh72c','Ym0Lp7rS7eU','9YbeoIn8qL0','jfKfPfyJRdk']
};

// --- Estado Global ---
let lists = JSON.parse(localStorage.getItem('httv_lists') || 'null') || [
    { id:'1', name:'Cyberpunk Vibes', tags:'cyberpunk 4k cinematic, neon city night, blade runner aesthetic' },
    { id:'2', name:'Nature 4K',       tags:'nature 4k drone, forest relaxing, iceland landscape' }
];
let selectedListId = lists[0]?.id || null;
let playlist = []; // los 20 IDs buscados
let currentIndex = 0;
let intervalMs = 60000;
let player = null;
let apiReady = false;
let timerTick = null;
let timerMs = 0;
let isFading = false;

// --- Helpers de DOM ---
const $ = id => document.getElementById(id);
const showScreen = id => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
};
const setLoad = (perc, status) => {
    $('load-perc').textContent = perc + '%';
    $('load-status').textContent = status;
};

// --- LocalStorage ---
const saveLists = () => localStorage.setItem('httv_lists', JSON.stringify(lists));

// --- Render de Listas ---
const renderLists = () => {
    const container = $('lists-container');
    container.innerHTML = '';
    lists.forEach(list => {
        const card = document.createElement('div');
        card.className = 'list-card' + (list.id === selectedListId ? ' selected' : '');
        card.innerHTML = `
            <div class="list-radio"></div>
            <div class="list-info">
                <input class="list-name-input" placeholder="Nombre del Canal" value="${list.name}" data-id="${list.id}" data-field="name">
                <input class="list-tags-input" placeholder="hashtag1, hashtag2, hashtag3..." value="${list.tags}" data-id="${list.id}" data-field="tags">
            </div>
            <button class="btn-delete" data-id="${list.id}">×</button>
        `;
        // Select on card click
        card.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
            selectedListId = list.id;
            renderLists();
        });
        container.appendChild(card);
    });
    $('btn-play').disabled = !selectedListId;
};

// --- Eventos de Listas ---
$('lists-container').addEventListener('change', e => {
    const { id, field } = e.target.dataset;
    if (!id || !field) return;
    const list = lists.find(l => l.id === id);
    if (list) { list[field] = e.target.value; saveLists(); }
    if (field === 'name') renderLists();
});

$('btn-add-list').addEventListener('click', () => {
    const id = Date.now().toString();
    lists.push({ id, name: 'Nuevo Canal', tags: '' });
    selectedListId = id;
    saveLists();
    renderLists();
});

$('lists-container').addEventListener('click', e => {
    const btn = e.target.closest('.btn-delete');
    if (!btn) return;
    const id = btn.dataset.id;
    lists = lists.filter(l => l.id !== id);
    if (selectedListId === id) selectedListId = lists[0]?.id || null;
    saveLists();
    renderLists();
});

$('interval-select').addEventListener('change', () => {
    intervalMs = parseInt($('interval-select').value);
    timerMs = 0;
});

// --- Búsqueda de Videos ---
async function fetchPlaylist(tags) {
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    const query = tagList[Math.floor(Math.random() * tagList.length)] || 'cyberpunk 4k';
    
    setLoad(20, 'Contactando servidor...');

    // Detectar categoría para el fallback del MASTER
    const q = query.toLowerCase();
    const cat = q.includes('cyber') || q.includes('neon') ? 'cyberpunk'
              : q.includes('natur') || q.includes('forest') || q.includes('drone') ? 'nature'
              : q.includes('lofi') || q.includes('chill') ? 'lofi'
              : q.includes('anime') ? 'anime'
              : 'default';

    const instances = [
        'https://iv.ggtyler.dev',
        'https://invidious.flokinet.to',
        'https://inv.riverside.rocks',
        'https://yewtu.be'
    ];

    for (const instance of instances) {
        const apiUrl = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&page=1`;
        setLoad(40, `Probando ${instance.split('//')[1]}...`);
        try {
            const res = await fetch(apiUrl, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) continue;
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) continue;
            const ids = data
                .filter(v => v.videoId && v.lengthSeconds > 30)
                .map(v => v.videoId)
                .slice(0, 20);
            if (ids.length > 5) {
                setLoad(90, `${ids.length} videos encontrados ✓`);
                return shuffle(ids);
            }
        } catch (_) { /* probar siguiente */ }
    }

    // Fallback: usar Archivo Maestro
    setLoad(90, 'Usando señal de archivo...');
    return shuffle([...MASTER[cat]]);
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// --- Botón PLAY ---
$('btn-play').addEventListener('click', async () => {
    const list = lists.find(l => l.id === selectedListId);
    if (!list) return;
    intervalMs = parseInt($('interval-select').value);

    showScreen('screen-loading');
    setLoad(0, 'Buscando videos...');

    playlist = await fetchPlaylist(list.tags || list.name);
    currentIndex = 0;

    setLoad(95, 'Preparando reproductor...');

    // Esperar API de YouTube
    const waitApi = (res) => apiReady ? res() : setTimeout(() => waitApi(res), 300);
    await new Promise(waitApi);

    setLoad(100, '¡Señal lista!');
    await new Promise(r => setTimeout(r, 600));

    showScreen('screen-player');
    $('now-playing').textContent = '#' + (list.name || list.tags.split(',')[0]).toUpperCase().trim();
    loadVideo(playlist[currentIndex]);
    startTimer();
});

// --- YouTube IFrame API ---
const ytTag = document.createElement('script');
ytTag.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(ytTag);

window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('player', {
        playerVars: {
            autoplay: 1, controls: 0, rel: 0, mute: 0,
            iv_load_policy: 3, modestbranding: 1,
            origin: window.location.origin, enablejsapi: 1
        },
        events: {
            onReady: () => { apiReady = true; },
            onError: () => { console.warn('YT error, saltando...'); nextVideo(); },
            onStateChange: (e) => {
                if (e.data === YT.PlayerState.ENDED) nextVideo();
            }
        }
    });
};

// --- Control de Video ---
function loadVideo(id) {
    if (!player || !id) return;
    try { player.loadVideoById(id); }
    catch(e) { console.warn('loadVideoById failed:', e); }
}

// --- Temporizador ---
function startTimer() {
    clearInterval(timerTick);
    timerMs = 0;
    if (intervalMs === 0) return; // Modo manual

    timerTick = setInterval(() => {
        timerMs += 250;
        const pct = Math.min((timerMs / intervalMs) * 100, 100);
        $('progress-bar').style.width = pct + '%';
        if (timerMs >= intervalMs) nextVideo();
    }, 250);
}

// --- Siguiente Video (con fade de audio) ---
function nextVideo() {
    if (isFading) return;
    isFading = true;
    clearInterval(timerTick);

    fadeVolume(100, 0, 1000, () => {
        currentIndex = (currentIndex + 1) % playlist.length;
        loadVideo(playlist[currentIndex]);
        setTimeout(() => {
            fadeVolume(0, 100, 1000, () => { isFading = false; });
            startTimer();
        }, 1000); // dar tiempo para que el video cargue
    });
}

function fadeVolume(from, to, duration, callback) {
    if (!player || typeof player.setVolume !== 'function') { callback && callback(); return; }
    const steps = 20;
    const stepTime = duration / steps;
    const delta = (to - from) / steps;
    let current = from;
    let count = 0;
    const iv = setInterval(() => {
        current += delta;
        count++;
        try { player.setVolume(Math.round(Math.max(0, Math.min(100, current)))); } catch(_) {}
        if (count >= steps) { clearInterval(iv); callback && callback(); }
    }, stepTime);
}

// --- Controles del Player ---
$('btn-back').addEventListener('click', () => {
    clearInterval(timerTick);
    try { player.stopVideo(); } catch(_) {}
    showScreen('screen-lists');
});

$('btn-next-video').addEventListener('click', nextVideo);

// --- Iniciar ---
renderLists();
