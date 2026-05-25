// ── Production de carburant ───────────────────────────────────
let carburantData = null;
let carburantFetchTimestamp = 0;
let carburantMasquerTimer = null;

function carburantActuel() {
    if (!carburantData) return 0;
    const elapsed = (Date.now() - carburantFetchTimestamp) / 1000;
    return Math.min(carburantData.max, Math.floor(carburantData.carburant + elapsed * carburantData.production));
}

async function chargerCarburant() {
    const res = await fetch(`/api/joueur/${joueur_id}/carburant`, {
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (res && res.ok) {
        carburantData = await res.json();
        carburantFetchTimestamp = Date.now();
        majHudCarburant();
        majPanneauCarburant();
        const maBase = bases.find(b => b.joueur_id == joueur_id);
        if (maBase) maBase.carburant_niveau = carburantData.niveau;
    }
}

async function ameliorerCarburant() {
    const res = await fetch(`/api/joueur/${joueur_id}/carburant/ameliorer`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (res && res.ok) {
        carburantData = await res.json();
        carburantFetchTimestamp = Date.now();
        const maBase = bases.find(b => b.joueur_id == joueur_id);
        if (maBase) maBase.carburant_niveau = carburantData.niveau;
        majHudCarburant();
        majPanneauCarburant();
        chargerBeton();
    } else if (res) {
        const err = await res.json().catch(() => ({}));
        if (err.erreur) afficherMessageErreur(err.erreur);
    }
}

function majHudCarburant() {
    const el = document.getElementById('hud-carburant');
    if (!el) return;
    if (!carburantData || carburantData.niveau === 0) { el.textContent = '—'; return; }
    el.textContent = `${carburantActuel().toLocaleString('fr')} / ${carburantData.max.toLocaleString('fr')}`;
}

function getCarburantBatimentRect() {
    const maBase = bases.find(b => b.joueur_id == joueur_id);
    if (!maBase) return null;
    const { mx, my } = posToMapPx(maBase.pos_x, maBase.pos_y);
    const sx = mx - camX, sy = my - camY;
    const fw = 80, fh = 80;
    return {
        x: sx + CARBURANT_OFFSET_X - fw / 2,
        y: sy + CARBURANT_OFFSET_Y - fh / 2,
        w: fw, h: fh
    };
}

function afficherPanneauCarburant() {
    clearTimeout(carburantMasquerTimer);
    const r = getCarburantBatimentRect();
    if (!r) return;
    const panel = document.getElementById('panneau-carburant');
    panel.style.left = r.x + 'px';
    panel.style.top  = r.y + 'px';
    panel.classList.add('visible');
    majPanneauCarburant();
}

function masquerPanneauCarburant() {
    carburantMasquerTimer = setTimeout(() => {
        document.getElementById('panneau-carburant').classList.remove('visible');
    }, 300);
}

function annulerMasqueCarburant() {
    clearTimeout(carburantMasquerTimer);
}

function majPanneauCarburant() {
    const panel = document.getElementById('panneau-carburant');
    if (!panel || !carburantData) return;

    const carburant = carburantActuel();
    const niveau    = carburantData.niveau;

    panel.querySelector('#pcar-niveau').textContent = `NIVEAU ${niveau} / 10`;
    panel.querySelector('#pcar-stock').textContent  = `${carburant.toLocaleString('fr')} / ${carburantData.max.toLocaleString('fr')}`;
    panel.querySelector('#pcar-prod').textContent   = niveau > 0 ? `+${carburantData.production} / s` : '—';

    const btn = panel.querySelector('#pcar-btn-ameliorer');
    if (niveau >= 10) {
        btn.textContent = '✅ NIVEAU MAXIMUM';
        btn.disabled = true;
    } else {
        const cout = carburantData.cout_prochain;
        btn.textContent = `⬆ AMÉLIORER (${cout.toLocaleString('fr')} béton)`;
        btn.disabled = betonActuel() < cout;
    }
}

setInterval(() => {
    majHudCarburant();
    const panel = document.getElementById('panneau-carburant');
    if (panel && panel.classList.contains('visible')) majPanneauCarburant();
}, 1000);

// Resync avec la base toutes les 3s pour refléter la consommation réelle
setInterval(() => { chargerCarburant(); }, 3000);

canvas.addEventListener('mousemove', e => {
    if (typeof drag !== 'undefined' && drag) return;
    const r = getCarburantBatimentRect();
    if (r && e.clientX >= r.x && e.clientX <= r.x + r.w &&
             e.clientY >= r.y && e.clientY <= r.y + r.h) {
        afficherPanneauCarburant();
    } else {
        masquerPanneauCarburant();
    }
});

socket.on('carburant_niveau', ({ joueur_id: jid, niveau }) => {
    const base = bases.find(b => b.joueur_id === jid);
    if (base) base.carburant_niveau = niveau;
    if (jid == joueur_id) {
        if (carburantData) carburantData.niveau = niveau;
        majHudCarburant();
    }
});
