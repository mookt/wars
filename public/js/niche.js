// ── Panneau niche ────────────────────────────────────────────
let mursBeton    = false;
let masquerTimer = null;

// Offset de la niche (doit correspondre à renderer.js ligne 98)
const NICHE_OFFSET_X = -400;
const NICHE_OFFSET_Y = +115;
const NICHE_SCALE    = 0.15;

function getNicheRect() {
    const maBase = bases.find(b => b.joueur_id == joueur_id);
    if (!maBase || !imgNiche.complete || !imgNiche.naturalWidth) return null;

    const { mx, my } = posToMapPx(maBase.pos_x, maBase.pos_y);
    const sx = mx - camX, sy = my - camY;
    const nw = imgNiche.naturalWidth  * NICHE_SCALE;
    const nh = imgNiche.naturalHeight * NICHE_SCALE;
    return {
        x: sx - nw / 2 + NICHE_OFFSET_X,
        y: sy - nh / 2 + NICHE_OFFSET_Y,
        w: nw, h: nh
    }; // tu es trop fort
}

// Base capturée active pour la construction (null = base principale)
let _baseCaptureeActive = null;

function afficherNiche(baseCapturee) {
    clearTimeout(masquerTimer);
    _baseCaptureeActive = baseCapturee ?? null;

    let r;
    if (baseCapturee) {
        // Niche de la base capturée
        if (!imgNiche.complete || !imgNiche.naturalWidth) return;
        const { mx, my } = posToMapPx(baseCapturee.pos_x, baseCapturee.pos_y);
        const sx = mx - camX, sy = my - camY;
        const nw = imgNiche.naturalWidth  * NICHE_SCALE;
        const nh = imgNiche.naturalHeight * NICHE_SCALE;
        r = { x: sx - nw/2 + NICHE_OFFSET_X, y: sy - nh/2 + NICHE_OFFSET_Y, w: nw, h: nh };
    } else {
        r = getNicheRect();
    }
    if (!r) return;

    const panel = document.getElementById('panneau-niche');
    // Ne repositionner qu'à l'ouverture initiale pour éviter que le déplacement du div
    // ne déclenche un mouseleave intempestif sur le panneau déjà ouvert
    if (!panel.classList.contains('visible')) {
        panel.style.left = r.x + 'px';
        panel.style.top  = r.y + 'px';
    }
    panel.classList.add('visible');

    if (baseCapturee) {
        mursBeton = !!baseCapturee.murs_beton;
    } else {
        const maBase = bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
        if (maBase) mursBeton = !!maBase.murs_beton;
    }
    majBoutonMurs();
    majBoutonVehicule();
    majBoutonHumvet();
    majBoutonSam();
    majCompteurSams(baseCapturee);
}

function masquerNiche() {
    const panel = document.getElementById('panneau-niche');
    if (!panel) return;
    panel.classList.remove('visible');
    _baseCaptureeActive = null;
}

function annulerMasqueNiche() {
    // Rouvrir le panneau si la souris revient dessus
    const panel = document.getElementById('panneau-niche');
    if (panel && !panel.classList.contains('visible')) {
        panel.classList.add('visible');
        majBoutonMurs();
        majBoutonVehicule();
        majBoutonHumvet();
        majBoutonSam();
        majCompteurSams(_baseCaptureeActive ?? null);
    }
}

function majCompteurSams(baseCapturee) {
    const el = document.getElementById('pn-sam-count');
    if (!el) return;
    const base = baseCapturee ?? bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
    if (!base?.vehicules) { el.style.display = 'none'; return; }
    const total  = base.vehicules.filter(v => v.type === 'sam' && v.construit).length;
    const vivant = base.vehicules.filter(v => v.type === 'sam' && v.construit && (v.pv ?? 0) > 0).length;
    if (total === 0) { el.style.display = 'none'; return; }
    el.textContent  = `🪖 SAMs : ${vivant} / ${total}`;
    el.style.color  = vivant === 0 ? '#ff4444' : vivant < total ? '#ffaa00' : '#00c850';
    el.style.display = 'block';
}

function majBoutonMurs() {
    const btn = document.getElementById('pn-btn-murs');
    if (!btn) return;
    if (mursBeton) {
        btn.textContent = '↩ RETOUR MURS STANDARD';
        btn.disabled = false;
    } else {
        btn.textContent = '⬆ AMÉLIORER LES MURS (100 🔷)';
        btn.disabled = (typeof titaniumStock !== 'undefined') && titaniumStock < 100;
    }
}

async function ameliorerMurs() {
    const baseCapturee = (typeof _baseCaptureeActive !== 'undefined') ? _baseCaptureeActive : null;

    if (baseCapturee) {
        const ancien = !!baseCapturee.murs_beton;
        baseCapturee.murs_beton = ancien ? 0 : 1;
        majBoutonMurs();
        const res = await fetch(`/api/joueur/${joueur_id}/base-capturee/${baseCapturee._neutreId}/murs`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ murs_beton: baseCapturee.murs_beton })
        }).catch(() => null);
        if (!res || !res.ok) {
            baseCapturee.murs_beton = ancien ? 1 : 0;
            majBoutonMurs();
            if (res) { const err = await res.json().catch(() => ({})); if (err.erreur) afficherMessageErreur(err.erreur); }
        } else if (!ancien) {
            chargerTitanium();
        }
        return;
    }

    mursBeton = !mursBeton;
    majBoutonMurs();
    const res = await fetch(`/api/joueur/${joueur_id}/murs`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ murs_beton: mursBeton })
    }).catch(() => null);
    if (res && res.ok) {
        const maBase = bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
        if (maBase) maBase.murs_beton = mursBeton ? 1 : 0;
        if (mursBeton) chargerTitanium();
    } else {
        mursBeton = !mursBeton;
        majBoutonMurs();
        if (res) { const err = await res.json().catch(() => ({})); if (err.erreur) afficherMessageErreur(err.erreur); }
    }
}
