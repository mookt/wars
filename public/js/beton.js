// ── Production de béton ───────────────────────────────────────
let betonData = null;         // { beton, niveau, production, max, cout_prochain }
let betonFetchTimestamp = 0;  // Date.now() au moment du dernier chargement serveur
let betonMasquerTimer = null;

// ── Calcul de l'état courant (accumulation locale) ───────────
function betonActuel() {
    if (!betonData) return 0;
    const elapsed = (Date.now() - betonFetchTimestamp) / 1000;
    return Math.min(betonData.max, Math.floor(betonData.beton + elapsed * betonData.production));
}

// ── Chargement depuis le serveur ─────────────────────────────
async function chargerBeton() {
    const res = await fetch(`/api/joueur/${joueur_id}/beton`, {
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (res && res.ok) {
        betonData = await res.json();
        betonFetchTimestamp = Date.now();
        majHudBeton();
        majPanneauBeton();
        // Mettre à jour le niveau sur la base locale
        const maBase = bases.find(b => b.joueur_id == joueur_id);
        if (maBase) maBase.beton_niveau = betonData.niveau;
    }
}

// ── Améliorer le niveau ───────────────────────────────────────
async function ameliorerBeton() {
    const res = await fetch(`/api/joueur/${joueur_id}/beton/ameliorer`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (res && res.ok) {
        betonData = await res.json();
        betonFetchTimestamp = Date.now();
        const maBase = bases.find(b => b.joueur_id == joueur_id);
        if (maBase) maBase.beton_niveau = betonData.niveau;
        majHudBeton();
        majPanneauBeton();
    } else if (res) {
        const err = await res.json().catch(() => ({}));
        if (err.erreur) afficherMessageErreur(err.erreur);
    }
}

// ── HUD béton ─────────────────────────────────────────────────
function majHudBeton() {
    const el = document.getElementById('hud-beton');
    if (!el) return;
    if (!betonData || betonData.niveau === 0) {
        el.textContent = '—';
        return;
    }
    el.textContent = `${betonActuel().toLocaleString('fr')} / ${betonData.max.toLocaleString('fr')}`;
}

// ── Panneau béton ─────────────────────────────────────────────
function getBetonBatimentRect() {
    const maBase = bases.find(b => b.joueur_id == joueur_id);
    if (!maBase) return null;
    const { mx, my } = posToMapPx(maBase.pos_x, maBase.pos_y);
    const sx = mx - camX, sy = my - camY;
    // Zone de survol centrée sur la base (là où l'usine est rendue)
    const fw = 80, fh = 80;
    return {
        x: sx + BETON_OFFSET_X - fw / 2,
        y: sy + BETON_OFFSET_Y - fh / 2,
        w: fw, h: fh
    };
}

function afficherPanneauBeton() {
    clearTimeout(betonMasquerTimer);
    const r = getBetonBatimentRect();
    if (!r) return;
    const panel = document.getElementById('panneau-beton');
    panel.style.left = r.x + 'px';
    panel.style.top  = r.y + 'px';
    panel.classList.add('visible');
    majPanneauBeton();
}

function masquerPanneauBeton() {
    betonMasquerTimer = setTimeout(() => {
        document.getElementById('panneau-beton').classList.remove('visible');
    }, 300);
}

function annulerMasqueBeton() {
    clearTimeout(betonMasquerTimer);
}

function majPanneauBeton() {
    const panel = document.getElementById('panneau-beton');
    if (!panel || !betonData) return;

    const beton = betonActuel();
    const niveau = betonData.niveau;

    panel.querySelector('#pb-niveau').textContent  = `NIVEAU ${niveau} / 10`;
    panel.querySelector('#pb-stock').textContent   = `${beton.toLocaleString('fr')} / ${betonData.max.toLocaleString('fr')}`;
    panel.querySelector('#pb-prod').textContent    = niveau > 0 ? `+${betonData.production} / s` : '—';

    const btn = panel.querySelector('#pb-btn-ameliorer');
    if (niveau >= 10) {
        btn.textContent = '✅ NIVEAU MAXIMUM';
        btn.disabled = true;
    } else {
        const cout = betonData.cout_prochain;
        btn.textContent = `⬆ AMÉLIORER (${cout.toLocaleString('fr')} béton)`;
        btn.disabled = beton < cout;
    }
}

// ── Mise à jour périodique (HUD + panneau) ────────────────────
setInterval(() => {
    majHudBeton();
    const panel = document.getElementById('panneau-beton');
    if (panel && panel.classList.contains('visible')) majPanneauBeton();
}, 1000);

// ── Détection survol bâtiment béton ──────────────────────────
canvas.addEventListener('mousemove', e => {
    if (typeof drag !== 'undefined' && drag) return;
    const r = getBetonBatimentRect();
    if (r && e.clientX >= r.x && e.clientX <= r.x + r.w &&
             e.clientY >= r.y && e.clientY <= r.y + r.h) {
        afficherPanneauBeton();
    } else {
        masquerPanneauBeton();
    }
});

// ── Socket.IO : mise à jour niveau d'un autre joueur ─────────
socket.on('beton_niveau', ({ joueur_id: jid, niveau }) => {
    const base = bases.find(b => b.joueur_id === jid);
    if (base) base.beton_niveau = niveau;
    if (jid == joueur_id) {
        if (betonData) betonData.niveau = niveau;
        majHudBeton();
    }
});
