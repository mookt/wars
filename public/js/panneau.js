// ── Panneau de gestion de la base ───────────────────────────
let mursBeton = false;

function majPanneauUI() {
    const btn    = document.getElementById('pb-btn');
    const statut = document.getElementById('pb-statut');
    if (mursBeton) {
        btn.textContent    = '↩ MURS STANDARD';
        btn.className      = 'pb-btn beton';
        statut.textContent = 'BÉTON ARMÉ';
        statut.className   = 'pb-statut beton';
    } else {
        btn.textContent    = '⬆ BÉTONNER';
        btn.className      = 'pb-btn normal';
        statut.textContent = 'TERRE / STANDARD';
        statut.className   = 'pb-statut normal';
    }
}

function ouvrirPanneau() {
    const maBase = bases.find(b => b.joueur_id == joueur_id);
    if (maBase) mursBeton = !!maBase.murs_beton;
    majPanneauUI();
    document.getElementById('panneau-base').classList.add('visible');
}

function fermerPanneau() {
    document.getElementById('panneau-base').classList.remove('visible');
}

async function toggleMursJeu() {
    const nouvelEtat = !mursBeton;
    mursBeton = nouvelEtat;
    majPanneauUI();

    const res = await fetch(`/api/joueur/${joueur_id}/murs`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ murs_beton: nouvelEtat })
    }).catch(() => null);

    if (res && res.ok) {
        const maBase = bases.find(b => b.joueur_id == joueur_id);
        if (maBase) maBase.murs_beton = nouvelEtat ? 1 : 0;
    } else {
        mursBeton = !nouvelEtat;
        majPanneauUI();
    }
}
