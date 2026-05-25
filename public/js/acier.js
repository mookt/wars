// ── Production d'acier ────────────────────────────────────────
let acierData = null;
let acierFetchTimestamp = 0;
let acierMasquerTimer = null;

function acierActuel() {
    if (!acierData) return 0;
    const elapsed = (Date.now() - acierFetchTimestamp) / 1000;
    return Math.min(acierData.max, Math.floor(acierData.acier + elapsed * acierData.production));
}

async function chargerAcier() {
    const res = await fetch(`/api/joueur/${joueur_id}/acier`, {
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (res && res.ok) {
        acierData = await res.json();
        acierFetchTimestamp = Date.now();
        majHudAcier();
        majPanneauAcier();
        const maBase = bases.find(b => b.joueur_id == joueur_id);
        if (maBase) maBase.acier_niveau = acierData.niveau;
    }
}

async function ameliorerAcier() {
    const res = await fetch(`/api/joueur/${joueur_id}/acier/ameliorer`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (res && res.ok) {
        acierData = await res.json();
        acierFetchTimestamp = Date.now();
        const maBase = bases.find(b => b.joueur_id == joueur_id);
        if (maBase) maBase.acier_niveau = acierData.niveau;
        majHudAcier();
        majPanneauAcier();
        chargerBeton();
    } else if (res) {
        const err = await res.json().catch(() => ({}));
        if (err.erreur) afficherMessageErreur(err.erreur);
    }
}

function majHudAcier() {
    const el = document.getElementById('hud-acier');
    if (!el) return;
    if (!acierData || acierData.niveau === 0) { el.textContent = '—'; return; }
    el.textContent = `${acierActuel().toLocaleString('fr')} / ${acierData.max.toLocaleString('fr')}`;
}

function getAcierBatimentRect() {
    const maBase = bases.find(b => b.joueur_id == joueur_id);
    if (!maBase) return null;
    const { mx, my } = posToMapPx(maBase.pos_x, maBase.pos_y);
    const sx = mx - camX, sy = my - camY;
    const fw = 80, fh = 80;
    return {
        x: sx + ACIER_OFFSET_X - fw / 2,
        y: sy + ACIER_OFFSET_Y - fh / 2,
        w: fw, h: fh
    };
}

function afficherPanneauAcier() {
    clearTimeout(acierMasquerTimer);
    const r = getAcierBatimentRect();
    if (!r) return;
    const panel = document.getElementById('panneau-acier');
    panel.style.left = r.x + 'px';
    panel.style.top  = r.y + 'px';
    panel.classList.add('visible');
    majPanneauAcier();
}

function masquerPanneauAcier() {
    acierMasquerTimer = setTimeout(() => {
        document.getElementById('panneau-acier').classList.remove('visible');
    }, 300);
}

function annulerMasqueAcier() {
    clearTimeout(acierMasquerTimer);
}

function majPanneauAcier() {
    const panel = document.getElementById('panneau-acier');
    if (!panel || !acierData) return;

    const acier  = acierActuel();
    const niveau = acierData.niveau;

    panel.querySelector('#pa-niveau').textContent = `NIVEAU ${niveau} / 10`;
    panel.querySelector('#pa-stock').textContent  = `${acier.toLocaleString('fr')} / ${acierData.max.toLocaleString('fr')}`;
    panel.querySelector('#pa-prod').textContent   = niveau > 0 ? `+${acierData.production} / s` : '—';

    const btn = panel.querySelector('#pa-btn-ameliorer');
    if (niveau >= 10) {
        btn.textContent = '✅ NIVEAU MAXIMUM';
        btn.disabled = true;
    } else {
        const cout = acierData.cout_prochain;
        btn.textContent = `⬆ AMÉLIORER (${cout.toLocaleString('fr')} béton)`;
        btn.disabled = betonActuel() < cout;
    }
}

setInterval(() => {
    majHudAcier();
    const panel = document.getElementById('panneau-acier');
    if (panel && panel.classList.contains('visible')) majPanneauAcier();
}, 1000);

canvas.addEventListener('mousemove', e => {
    if (typeof drag !== 'undefined' && drag) return;
    const r = getAcierBatimentRect();
    if (r && e.clientX >= r.x && e.clientX <= r.x + r.w &&
             e.clientY >= r.y && e.clientY <= r.y + r.h) {
        afficherPanneauAcier();
    } else {
        masquerPanneauAcier();
    }
});

socket.on('acier_niveau', ({ joueur_id: jid, niveau }) => {
    const base = bases.find(b => b.joueur_id === jid);
    if (base) base.acier_niveau = niveau;
    if (jid == joueur_id) {
        if (acierData) acierData.niveau = niveau;
        majHudAcier();
    }
});
