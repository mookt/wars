// ── Production de charbon ─────────────────────────────────────
let charbonData = null;
let charbonFetchTimestamp = 0;
let charbonMasquerTimer = null;

function charbonActuel() {
    if (!charbonData) return 0;
    const elapsed = (Date.now() - charbonFetchTimestamp) / 1000;
    return Math.min(charbonData.max, Math.floor(charbonData.charbon + elapsed * charbonData.production));
}

async function chargerCharbon() {
    const res = await fetch(`/api/joueur/${joueur_id}/charbon`, {
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (res && res.ok) {
        charbonData = await res.json();
        charbonFetchTimestamp = Date.now();
        majHudCharbon();
        majPanneauCharbon();
        const maBase = bases.find(b => b.joueur_id == joueur_id);
        if (maBase) maBase.charbon_niveau = charbonData.niveau;
    }
}

async function ameliorerCharbon() {
    const res = await fetch(`/api/joueur/${joueur_id}/charbon/ameliorer`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (res && res.ok) {
        charbonData = await res.json();
        charbonFetchTimestamp = Date.now();
        const maBase = bases.find(b => b.joueur_id == joueur_id);
        if (maBase) maBase.charbon_niveau = charbonData.niveau;
        majHudCharbon();
        majPanneauCharbon();
        chargerBeton();
    } else if (res) {
        const err = await res.json().catch(() => ({}));
        if (err.erreur) afficherMessageErreur(err.erreur);
    }
}

function majHudCharbon() {
    const el = document.getElementById('hud-charbon');
    if (!el) return;
    if (!charbonData || charbonData.niveau === 0) { el.textContent = '—'; return; }
    el.textContent = `${charbonActuel().toLocaleString('fr')} / ${charbonData.max.toLocaleString('fr')}`;
}

function getCharbonBatimentRect() {
    const maBase = bases.find(b => b.joueur_id == joueur_id);
    if (!maBase) return null;
    const { mx, my } = posToMapPx(maBase.pos_x, maBase.pos_y);
    const sx = mx - camX, sy = my - camY;
    const fw = 80, fh = 80;
    return {
        x: sx + CHARBON_OFFSET_X - fw / 2,
        y: sy + CHARBON_OFFSET_Y - fh / 2,
        w: fw, h: fh
    };
}

function afficherPanneauCharbon() {
    clearTimeout(charbonMasquerTimer);
    const r = getCharbonBatimentRect();
    if (!r) return;
    const panel = document.getElementById('panneau-charbon');
    panel.style.left = r.x + 'px';
    panel.style.top  = r.y + 'px';
    panel.classList.add('visible');
    majPanneauCharbon();
}

function masquerPanneauCharbon() {
    charbonMasquerTimer = setTimeout(() => {
        document.getElementById('panneau-charbon').classList.remove('visible');
    }, 300);
}

function annulerMasqueCharbon() {
    clearTimeout(charbonMasquerTimer);
}

function majPanneauCharbon() {
    const panel = document.getElementById('panneau-charbon');
    if (!panel || !charbonData) return;

    const charbon = charbonActuel();
    const niveau  = charbonData.niveau;

    panel.querySelector('#pc-niveau').textContent = `NIVEAU ${niveau} / 10`;
    panel.querySelector('#pc-stock').textContent  = `${charbon.toLocaleString('fr')} / ${charbonData.max.toLocaleString('fr')}`;
    panel.querySelector('#pc-prod').textContent   = niveau > 0 ? `+${charbonData.production} / s` : '—';

    const btn = panel.querySelector('#pc-btn-ameliorer');
    if (niveau >= 10) {
        btn.textContent = '✅ NIVEAU MAXIMUM';
        btn.disabled = true;
    } else {
        const cout = charbonData.cout_prochain;
        btn.textContent = `⬆ AMÉLIORER (${cout.toLocaleString('fr')} béton)`;
        btn.disabled = betonActuel() < cout;
    }
}

setInterval(() => {
    majHudCharbon();
    const panel = document.getElementById('panneau-charbon');
    if (panel && panel.classList.contains('visible')) majPanneauCharbon();
}, 1000);

canvas.addEventListener('mousemove', e => {
    if (typeof drag !== 'undefined' && drag) return;
    const r = getCharbonBatimentRect();
    if (r && e.clientX >= r.x && e.clientX <= r.x + r.w &&
             e.clientY >= r.y && e.clientY <= r.y + r.h) {
        afficherPanneauCharbon();
    } else {
        masquerPanneauCharbon();
    }
});

socket.on('charbon_niveau', ({ joueur_id: jid, niveau }) => {
    const base = bases.find(b => b.joueur_id === jid);
    if (base) base.charbon_niveau = niveau;
    if (jid == joueur_id) {
        if (charbonData) charbonData.niveau = niveau;
        majHudCharbon();
    }
});
