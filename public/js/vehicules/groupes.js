// ── Formation & gestion des groupes ──────────────────────────
// positionsFormation est défini dans formation.js (source unique)

// Retourne le plus petit slot libre dans un groupe (le plus proche du centre)
// Prend en compte les membres actuels ET les véhicules déjà en route (_pendingGroupe)
function prochainSlotLibre(maBase, groupeId) {
    const occupes = new Set();
    maBase.vehicules.forEach(v => {
        if (v.groupe_id === groupeId && v.formation_slot != null)
            occupes.add(v.formation_slot);
        if (v._pendingGroupe?.groupeId === groupeId && v._pendingGroupe.slot != null)
            occupes.add(v._pendingGroupe.slot);
    });
    for (let s = 0; s < GROUPE_MAX; s++) {
        if (!occupes.has(s)) return s;
    }
    return -1; // groupe plein
}

function creerGroupeSolo(vehicle) {
    if (vehicle._creatingGroupe) return;
    vehicle._creatingGroupe = true;
    vehicle.formation_slot  = 0;
    fetch(`/api/joueur/${joueur_id}/groupe`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicule_ids: [vehicle.id] })
    }).then(r => r?.json()).then(data => {
        vehicle._creatingGroupe = false;
        if (data?.groupe_id && !vehicle.groupe_id) vehicle.groupe_id = data.groupe_id;
    }).catch(() => { vehicle._creatingGroupe = false; });
}

function activerVehicule(vehicle) {
    vehicle.construit = 1;
    majBoutonVehicule();
    majBoutonHumvet();

    if (vehicle.type === 'sam') {
        // Le nouveau SAM hérite du déficit HP du SAM le plus endommagé de sa propre base
        const baseVehicule = bases.find(b => b.vehicules?.includes(vehicle))
                          ?? bases.find(b => b.joueur_id == joueur_id);
        if (baseVehicule) {
            const sams = baseVehicule.vehicules.filter(v =>
                v.type === 'sam' && v.construit && v.id !== vehicle.id && v.pv > 0
            );
            const plusAbime = sams.reduce((pire, v) => !pire || v.pv < pire.pv ? v : pire, null);
            if (plusAbime && plusAbime.pv < vcfg(plusAbime).pv_max) {
                const deficit = vcfg(plusAbime).pv_max - plusAbime.pv;
                vehicle.pv = Math.max(1, vcfg(vehicle).pv_max - deficit);
                plusAbime.pv = vcfg(plusAbime).pv_max; // SAM précédent restauré
            }
        }
        return;
    }
    // Le groupe sera créé par creerGroupeSolo — l'offset initial doit être atteint d'abord
    if (vehicle._premiereOffset) return;

    const tousVehJoueur = bases.filter(b => b.joueur_id == joueur_id).flatMap(b => b.vehicules ?? []);
    if (tousVehJoueur.length === 0) return;

    const spawnX = vehicle.cur_x ?? vehicle.x;
    const spawnY = vehicle.cur_y ?? vehicle.y;
    let groupeCible = null, distMin = Infinity;
    const groupesVus = new Set();

    tousVehJoueur.forEach(v => {
        if (!v.construit || v.id === vehicle.id || !v.groupe_id) return;
        if (groupesVus.has(v.groupe_id)) return;
        groupesVus.add(v.groupe_id);
        if (typeVehicule(v) !== typeVehicule(vehicle)) return;
        const membres      = tousVehJoueur.filter(vv => vv.groupe_id === v.groupe_id && vv.construit);
        const pendingCount = tousVehJoueur.filter(vv => vv._pendingGroupe?.groupeId === v.groupe_id).length;
        if (membres.length + pendingCount >= GROUPE_MAX) return;
        const centre = membres.reduce((min, vv) =>
            (vv.formation_slot ?? Infinity) < (min.formation_slot ?? Infinity) ? vv : min, membres[0]);
        const cx = centre.cur_x ?? centre.x;
        const cy = centre.cur_y ?? centre.y;
        if (cx == null || cy == null) return;
        const dist = Math.hypot(spawnX - cx, spawnY - cy);
        if (dist < distMin) { distMin = dist; groupeCible = { groupeId: v.groupe_id, membres, centre }; }
    });

    if (groupeCible && distMin <= DISTANCE_MAX_REJOINDRE) {
        // Slot initial = plus petit libre parmi les membres actuels uniquement (pas de réservation)
        const slotsOccupes = new Set(groupeCible.membres.map(vv => vv.formation_slot).filter(s => s != null));
        let slotInit = 0;
        while (slotsOccupes.has(slotInit) && slotInit < GROUPE_MAX) slotInit++;
        if (slotInit >= GROUPE_MAX) { creerGroupeSolo(vehicle); return; }

        const cx  = groupeCible.centre.cur_x ?? groupeCible.centre.x;
        const cy  = groupeCible.centre.cur_y ?? groupeCible.centre.y;
        const pos = positionsFormation(GROUPE_MAX, cx, cy)[slotInit];
        vehicle.formation_slot = slotInit;
        vehicle._pendingGroupe = { groupeId: groupeCible.groupeId, timestamp: Date.now() };
        deplacerVehicule(null, vehicle, pos.x, pos.y);
    } else {
        creerGroupeSolo(vehicle);
    }
}

function afficherMessageErreur(texte) {
    let msg = document.getElementById('msg-erreur-groupe');
    if (!msg) {
        msg = document.createElement('div');
        msg.id = 'msg-erreur-groupe';
        msg.style.cssText = [
            'position:fixed', 'top:80px', 'left:50%', 'transform:translateX(-50%)',
            'background:rgba(200,0,0,0.88)', 'color:#fff', 'padding:10px 28px',
            'border-radius:5px', 'font-family:"Share Tech Mono",monospace',
            'font-size:14px', 'z-index:9999', 'pointer-events:none', 'display:none'
        ].join(';');
        document.body.appendChild(msg);
    }
    msg.textContent = texte;
    msg.style.display = 'block';
    clearTimeout(msg._t);
    msg._t = setTimeout(() => { msg.style.display = 'none'; }, 2500);
}
