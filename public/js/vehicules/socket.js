// ── Socket.io — événements véhicules ─────────────────────────
const socket = io();

socket.on('vehicle_moved', ({ vehicule_id, x, y, from_x, from_y }) => {
    for (const b of bases) {
        if (!b.vehicules) continue;
        const veh = b.vehicules.find(v => v.id === vehicule_id);
        if (veh) {
            veh.x = x; veh.y = y;
            if (b.joueur_id != joueur_id) {
                const sx = isFinite(from_x) ? from_x : veh.cur_x;
                const sy = isFinite(from_y) ? from_y : veh.cur_y;
                veh.cur_x = sx; veh.cur_y = sy;
                // Réinitialiser le buffer au point de départ (une seule entrée pour l'instant)
                veh._posBuffer = [{ x: sx, y: sy, a: veh.frameIndex ?? 0, t: Date.now() }];
                veh._reachedDest = false;
                majDirection(veh, x - sx, y - sy);
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
            if (!base.vehicules) base.vehicules = [];
            base.vehicules = base.vehicules.filter(v => v.type !== 'sam');
            base.vehicules.push(...sams);
        } else {
            base.vehicules?.forEach(v => { if (v.type === 'sam') v.pv = 800; });
        }

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
            // Ajouter la position finale au buffer pour que l'interpolation finisse en douceur
            if (veh._posBuffer) {
                veh._posBuffer.push({ x, y, a: veh.frameIndex ?? 0, t: Date.now() });
                if (veh._posBuffer.length > 30) veh._posBuffer.shift();
            } else if (veh.cur_x == null || Math.hypot(veh.cur_x - x, veh.cur_y - y) < vcfg(veh).speed * 15) {
                veh.cur_x = x; veh.cur_y = y;
            }
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
                  _reachedDest: true, _waypoints: [], _posBuffer: null };
    base.vehicules.push(veh);
    if (!isBuilt) planifierActivation(veh);
});

// Tick autoritaire du serveur (50ms) : même snapshot pour TOUS les clients en même temps
// Le serveur est la source unique → zéro divergence entre observateurs
socket.on('tick', ({ vehicles } = {}) => {
    if (!Array.isArray(vehicles)) return;
    const t = Date.now(); // timestamp local pour l'interpolation (évite le décalage d'horloge)
    for (const { id, x, y, a, type, jid } of vehicles) {
        for (const b of bases) {
            if (!b.vehicules || b.joueur_id == joueur_id) continue;
            if (jid != null && b.joueur_id != jid) continue;
            let veh = b.vehicules.find(v => v.id === id);
            // Auto-créer si absent (vehicle_built manqué ou race condition syncTiers)
            if (!veh && type) {
                veh = { id, type, x, y, cur_x: x, cur_y: y, construit: 1,
                        groupe_id: null, formation_slot: null, construction_fin: null,
                        pv: null, lastAttack: 0, target: null, frameIndex: a ?? 0,
                        _reachedDest: true, _waypoints: [], _posBuffer: null };
                b.vehicules.push(veh);
            }
            if (veh && veh.construit && veh.cur_x != null) {
                if (!veh._posBuffer) veh._posBuffer = [];
                veh._posBuffer.push({ x, y, a: a ?? 0, t });
                if (veh._posBuffer.length > 30) veh._posBuffer.shift();
            }
        }
    }
});

socket.on('vehicle_destroyed', ({ vehicule_id }) => {
    for (const b of bases) {
        if (!b.vehicules) continue;
        const veh = b.vehicules.find(v => v.id === vehicule_id);
        if (veh) {
            demarrerExplosion(veh);
            jouerSonExplosion();
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
