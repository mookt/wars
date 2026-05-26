// ── Socket.io — événements véhicules ─────────────────────────
const socket = io();

socket.on('vehicle_moved', ({ vehicule_id, x, y, from_x, from_y }) => {
    for (const b of bases) {
        if (!b.vehicules) continue;
        const veh = b.vehicules.find(v => v.id === vehicule_id);
        if (veh) {
            veh.x = x; veh.y = y;
            if (b.joueur_id != joueur_id) {
                if (isFinite(from_x) && isFinite(from_y)) {
                    veh.cur_x = from_x;
                    veh.cur_y = from_y;
                }
                veh._reachedDest = false;
                majDirection(veh, x - veh.cur_x, y - veh.cur_y);
            }
            break;
        }
    }
});

socket.on('base_capturee', ({ base_id, joueur_id: captureur, pseudo, sams }) => {
    const base = bases.find(b => b._neutreId === base_id || b.joueur_id === `neutre_${base_id}`);
    if (base) {
        base.joueur_id  = captureur;
        base.neutre     = false;
        base._neutreId  = base._neutreId ?? base_id;
        base._capturee  = true;
        if (pseudo) base.pseudo = pseudo;

        if (sams && sams.length > 0) {
            // Remplacer les SAMs existants par ceux reçus du serveur (rechargement complet)
            if (!base.vehicules) base.vehicules = [];
            base.vehicules = base.vehicules.filter(v => v.type !== 'sam');
            base.vehicules.push(...sams);
        } else {
            // Fallback : juste restaurer les PVs si les SAMs sont déjà dans le tableau
            base.vehicules?.forEach(v => { if (v.type === 'sam') v.pv = 800; });
        }

        // Marquer que cette base a des SAMs (pour la détection de perte)
        if (base.vehicules?.some(v => v.type === 'sam')) base._avaitSams = true;
    }
});

socket.on('base_perdue', ({ base_id }) => {
    const base = bases.find(b => b._neutreId === base_id);
    if (base) {
        base.joueur_id  = null;
        base.neutre     = true;
        base._capturee  = false;
        base.pseudo     = '';
        base._avaitSams = false;
        if (base.vehicules) base.vehicules = base.vehicules.filter(v => v.type !== 'sam');
    }
});

socket.on('vehicle_arrived', ({ vehicule_id, x, y }) => {
    for (const b of bases) {
        if (!b.vehicules || b.joueur_id == joueur_id) continue;
        const veh = b.vehicules.find(v => v.id === vehicule_id);
        if (veh) {
            veh.x = x; veh.y = y;
            veh.cur_x = x; veh.cur_y = y;
            break;
        }
    }
});

socket.on('vehicle_built', ({ joueur_id: jid, id, type, x, y, construction_fin }) => {
    if (jid == joueur_id) return;
    const base = bases.find(b => b.joueur_id == jid);
    if (!base) return;
    if (!base.vehicules) base.vehicules = [];
    if (base.vehicules.find(v => v.id === id)) return;
    const isBuilt = !construction_fin || Date.now() >= construction_fin;
    const veh = { id, type, x, y, cur_x: x, cur_y: y, groupe_id: null, formation_slot: null,
                  construction_fin, construit: isBuilt ? 1 : 0,
                  pv: null, lastAttack: 0, target: null, frameIndex: 0,
                  _reachedDest: true, _waypoints: [] };
    base.vehicules.push(veh);
    if (!isBuilt) planifierActivation(veh);
});

socket.on('vehicle_destroyed', ({ vehicule_id }) => {
    for (const b of bases) {
        if (!b.vehicules) continue;
        const veh = b.vehicules.find(v => v.id === vehicule_id);
        if (veh) {
            demarrerExplosion(veh);
            jouerSonExplosion();
            // Si c'est mon propre véhicule, s'assurer qu'il est supprimé de la DB
            if (b.joueur_id == joueur_id) {
                fetch(`/api/joueur/${joueur_id}/vehicule/${vehicule_id}/supprimer`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                }).catch(() => null);
            }
            break;
        }
    }
});
