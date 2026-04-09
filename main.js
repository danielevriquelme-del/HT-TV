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
let countdownTick = null;
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
    // Sync player selector
    const playerSel = $('interval-select-player');
    if (playerSel) playerSel.value = $('interval-select').value;
    timerMs = 0;
});

// Cambio de intervalo EN VIVO desde el reproductor
document.addEventListener('change', e => {
    if (e.target.id !== 'interval-select-player') return;
    intervalMs = parseInt(e.target.value);
    // Sync lista screen
    $('interval-select').value = e.target.value;
    timerMs = 0;
    clearInterval(timerTick);
    if (intervalMs > 0) startTimer();
    $('progress-bar').style.width = '0%';
});

// --- Búsqueda de Videos ---
const YT_API_KEY = 'AIzaSyBjwRmA_VCc4ZOuLy8pVWOxZsgqPKRUmLU';

async function fetchPlaylist(tags) {
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    const query = tagList[Math.floor(Math.random() * tagList.length)] || 'cyberpunk 4k';
    
    setLoad(20, 'Buscando en YouTube...');

    // Categoría para fallback
    const q = query.toLowerCase();
    const cat = q.includes('cyber') || q.includes('neon') ? 'cyberpunk'
              : q.includes('natur') || q.includes('forest') || q.includes('drone') ? 'nature'
              : q.includes('lofi') || q.includes('chill') ? 'lofi'
              : q.includes('anime') ? 'anime'
              : 'default';

    try {
        setLoad(40, 'Conectando a YouTube API...');
        const url = `https://www.googleapis.com/youtube/v3/search?` +
            `part=id&type=video&q=${encodeURIComponent(query)}&` +
            `maxResults=20&videoEmbeddable=true&key=${YT_API_KEY}`;
        
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();

        if (data.items && data.items.length > 0) {
            const ids = data.items
                .filter(item => item.id && item.id.videoId)
                .map(item => item.id.videoId);
            setLoad(90, `${ids.length} videos encontrados ✓`);
            return shuffle(ids);
        }
    } catch (err) {
        console.warn('YouTube API falló, usando archivo maestro:', err.message);
    }

    // Fallback: Archivo Maestro
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

    // Poblar el dropdown con todas las listas
    populateListSwitcher(list.id);

    loadVideo(playlist[currentIndex]);
    startTimer();
});

function populateListSwitcher(activeId) {
    const sel = $('list-switcher');
    sel.innerHTML = lists.map(l =>
        `<option value="${l.id}" ${l.id === activeId ? 'selected' : ''}>${l.name}</option>`
    ).join('');
}

// Cambiar de lista en vivo
$('list-switcher').addEventListener('change', async () => {
    const listId = $('list-switcher').value;
    const list = lists.find(l => l.id === listId);
    if (!list) return;

    const wrap = $('player-wrap');
    isFading = true;
    clearInterval(timerTick);
    clearInterval(countdownTick);
    wrap.style.opacity = '0';
    fadeVolume(100, 0, 600, async () => {
        playlist = await fetchPlaylist(list.tags || list.name);
        currentIndex = 0;
        loadVideo(playlist[currentIndex]);
        $('now-playing').textContent = '#' + list.name.toUpperCase().trim();
        setTimeout(() => {
            wrap.style.opacity = '1';
            fadeVolume(0, 100, 600, () => { isFading = false; });
            startTimer();
        }, 1000);
    });
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
// --- Timer + Countdown ---
function startTimer() {
    clearInterval(timerTick);
    clearInterval(countdownTick);
    timerMs = 0;

    const bar = $('progress-bar-wrap');
    const cd  = $('countdown');

    if (intervalMs === 0) {
        // Modo Manual: mostrar countdown del video
        bar.classList.add('hidden');
        cd.classList.remove('hidden');
        countdownTick = setInterval(() => {
            if (!player || typeof player.getDuration !== 'function') return;
            try {
                const dur = player.getDuration();
                const cur = player.getCurrentTime();
                const rem = Math.max(0, Math.ceil(dur - cur));
                const m = String(Math.floor(rem / 60)).padStart(2, '0');
                const s = String(rem % 60).padStart(2, '0');
                cd.textContent = `${m}:${s}`;
            } catch(_) {}
        }, 1000);
    } else {
        // Modo automático: mostrar barra de progreso
        bar.classList.remove('hidden');
        cd.classList.add('hidden');
        timerTick = setInterval(() => {
            timerMs += 250;
            const pct = Math.min((timerMs / intervalMs) * 100, 100);
            $('progress-bar').style.width = pct + '%';
            if (timerMs >= intervalMs) nextVideo();
        }, 250);
    }
}

// --- Siguiente Video (con fade de audio y visual) ---
function nextVideo() {
    if (isFading) return;
    isFading = true;
    clearInterval(timerTick);

    const wrap = document.getElementById('player-wrap');

    // 1. Fade OUT (audio + visual)
    wrap.style.opacity = '0';
    fadeVolume(100, 0, 800, () => {
        // 2. Cambiar video
        currentIndex = (currentIndex + 1) % playlist.length;
        loadVideo(playlist[currentIndex]);

        // 3. Esperar un momento y Fade IN
        setTimeout(() => {
            wrap.style.opacity = '1';
            fadeVolume(0, 100, 800, () => {
                isFading = false;
            });
            startTimer();
        }, 1200); // tiempo para que el nuevo video empiece a cargar
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
    clearInterval(countdownTick);
    try { player.stopVideo(); } catch(_) {}
    showScreen('screen-lists');
});

$('btn-next-video').addEventListener('click', nextVideo);

// --- Flechas del teclado: → siguiente, ← anterior ---
document.addEventListener('keydown', e => {
    // Solo actuar si estamos en el reproductor
    if (!document.getElementById('screen-player').classList.contains('active')) return;
    // No interferir si el foco está en un input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    if (e.key === 'ArrowRight') {
        nextVideo();
    } else if (e.key === 'ArrowLeft') {
        prevVideo();
    }
});

function prevVideo() {
    if (isFading) return;
    currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;
    const wrap = document.getElementById('player-wrap');
    isFading = true;
    wrap.style.opacity = '0';
    fadeVolume(100, 0, 800, () => {
        loadVideo(playlist[currentIndex]);
        setTimeout(() => {
            wrap.style.opacity = '1';
            fadeVolume(0, 100, 800, () => { isFading = false; });
            startTimer();
        }, 1200);
    });
}


// --- Guardar video actual en Favoritos ---
$('btn-save').addEventListener('click', () => {
    const videoId = playlist[currentIndex];
    if (!videoId) return;

    // Buscar o crear la lista "Favoritos"
    let favList = lists.find(l => l.name === '♥ Favoritos');
    if (!favList) {
        favList = { id: 'favoritos', name: '♥ Favoritos', tags: '' };
        lists.unshift(favList);
    }

    // Agregar el ID si no está ya guardado
    const savedIds = favList.tags ? favList.tags.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (!savedIds.includes(videoId)) {
        savedIds.push(videoId);
        favList.tags = savedIds.join(', ');
        saveLists();
    }

    // Feedback visual
    const btn = $('btn-save');
    btn.textContent = '✓ Guardado';
    btn.classList.add('saved');
    setTimeout(() => {
        btn.textContent = '♥ Guardar';
        btn.classList.remove('saved');
    }, 2000);
});

// --- Iniciar ---
renderLists();
