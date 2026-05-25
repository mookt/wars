// ── Explosion & combat ────────────────────────────────────────
const destructionParJoueur    = {};
const samDestructionParJoueur = {};
const samDestructionParBase   = {}; // rate limit 1 SAM/sec par BASE CIBLE
const groupesLastAttack       = {};
const samCibleLockeeParBase   = {}; // clé base → { groupeId, vehicleId }

function demarrerExplosion(vehicle) {
    if (!vehicle || vehicle.explosion) return;
    vehicle.construit = 0;
    vehicle.pv        = 0;
    vehicle.explosion = { start: Date.now() };
    epaves.push({
        type: vehicle.type,
        x: vehicle.cur_x ?? vehicle.x,
        y: vehicle.cur_y ?? vehicle.y,
        start: Date.now()
    });
}

function gererCombatVehicules() {
    const now = Date.now();

    // ── Centres de groupes ────────────────────────────────────
    const centresGroupe = {};
    bases.forEach(base => {
        if (!base.vehicules) return;
        base.vehicules.forEach(v => {
            if (!v.construit || v.pv <= 0 || !v.groupe_id || v.cur_x == null) return;
            const cur = centresGroupe[v.groupe_id];
            if (!cur || (v.formation_slot ?? Infinity) < (cur.formation_slot ?? Infinity))
                centresGroupe[v.groupe_id] = v;
        });
    });

    // ── Cible prioritaire par groupe ──────────────────────────
    // Toujours cibler le dernier véhicule du groupe (formation_slot le plus élevé)
    const ciblesPrioritaires = {};
    bases.forEach(base => {
        if (!base.vehicules) return;
        base.vehicules.forEach(v => {
            if (!v.construit || v.pv <= 0 || !v.groupe_id || v.cur_x == null) return;
            const cur = ciblesPrioritaires[v.groupe_id];
            if (!cur || (v.formation_slot ?? -1) > (cur.formation_slot ?? -1))
                ciblesPrioritaires[v.groupe_id] = v;
        });
    });
    Object.keys(centresGroupe).forEach(gid => {
        if (!ciblesPrioritaires[gid]) ciblesPrioritaires[gid] = centresGroupe[gid];
    });

    // ── Premier et dernier SAM vivant par base ────────────────
    // Clé unique par base (pas par joueur) pour que chaque base gère ses SAMs indépendamment
    const cleBase = b => b._neutreId != null ? `n_${b._neutreId}` : `p_${b.joueur_id}`;
    // Extrait la partie numérique d'un ID (ex: 'c12' → 12, 5 → 5)
    const numId = id => typeof id === 'string' ? Number(id.replace(/\D/g, '')) : Number(id);
    const premierSamParBase = {}, dernierSamParBase = {};
    bases.forEach(base => {
        if (!base.vehicules) return;
        const cle = cleBase(base);
        base.vehicules.forEach(v => {
            if (v.type !== 'sam' || !v.construit || v.pv <= 0 || v.cur_x == null) return;
            const p = premierSamParBase[cle];
            const d = dernierSamParBase[cle];
            // Ordonner par ID numérique : plus petit ID = premier (check portée), plus grand = dernier (cible)
            if (!p || numId(v.id) < numId(p.id)) premierSamParBase[cle] = v;
            if (!d || numId(v.id) > numId(d.id)) dernierSamParBase[cle] = v;
        });
    });

    // ── Passe 1 : ciblage ─────────────────────────────────────
    bases.forEach(base => {
        if (!base.vehicules) return;
        base.vehicules.forEach(vehicle => {
            if (!vehicle.construit || vehicle.pv <= 0) { vehicle.target = null; return; }
            const ref = (vehicle.groupe_id && centresGroupe[vehicle.groupe_id])
                ? centresGroupe[vehicle.groupe_id] : vehicle;
            if (ref.cur_x == null) { vehicle.target = null; return; }

            // Force-target : ordre d'attaque explicite du joueur
            if (vehicle._forceTarget) {
                if (Date.now() > (vehicle._forceTargetUntil ?? 0)) {
                    vehicle._forceTarget = null;
                } else {
                    const ft = vehicle._forceTarget;
                    // Chercher un membre vivant du groupe ciblé
                    // Toujours cibler le dernier du groupe (ciblesPrioritaires) pas le véhicule précis cliqué
                    let cible = null;
                    if (vehicle._forceTargetGroupe != null) {
                        cible = ciblesPrioritaires[vehicle._forceTargetGroupe] ?? null;
                    }
                    if (!cible && ft.construit && ft.pv > 0 && ft.cur_x != null) cible = ft;
                    if (cible) {
                        const d = Math.hypot(ref.cur_x - cible.cur_x, ref.cur_y - cible.cur_y);
                        if (d <= vcfg(vehicle).portee) {
                            vehicle.target = cible;
                            return; // à portée : attaquer directement
                        }
                        // Hors portée : déplacement ligne droite vers la cible (sans _effectiveDest)
                        if (!vehicle._forceTargetMoveT || now - vehicle._forceTargetMoveT > 500) {
                            vehicle._forceTargetMoveT = now;
                            const tx = cible.cur_x, ty = cible.cur_y;
                            const maBase2 = bases.find(b => b.joueur_id == joueur_id);
                            if (vehicle.groupe_id && typeof _refsGroupes !== 'undefined') {
                                const rfg = _refsGroupes[vehicle.groupe_id];
                                if (rfg) {
                                    rfg.x              = tx; rfg.y = ty;
                                    rfg._pfTarget      = { x: tx, y: ty };
                                    rfg._effectiveDest = null; // pas d'effectiveDest → pas de check de blocage
                                    rfg._waypoints     = [{ x: tx, y: ty }];
                                    rfg._reachedDest   = false;
                                    rfg._pfLastCalc    = now + 99999;
                                }
                                if (maBase2) maBase2.vehicules
                                    .filter(v => v.groupe_id === vehicle.groupe_id && v.construit)
                                    .forEach(v => { v.x = tx; v.y = ty; });
                            } else if (maBase2) {
                                deplacerVehicule(maBase2, vehicle, tx, ty);
                            }
                        }
                        // Laisser le ciblage normal s'exécuter pour tirer sur ce qui est déjà à portée
                    } else {
                        vehicle._forceTarget = null; // cible détruite
                    }
                }
            }

            // Garder le focus sur le groupe ciblé → toujours viser le dernier (ciblesPrioritaires)
            if (vehicle.target) {
                const groupeCible = vehicle.target.groupe_id ?? null;
                // Cible prioritaire = dernier véhicule vivant du groupe
                const ciblePrio = groupeCible != null ? ciblesPrioritaires[groupeCible] : vehicle.target;
                if (ciblePrio && ciblePrio.construit && ciblePrio.pv > 0 && ciblePrio.cur_x != null) {
                    const pRef = (ciblePrio.groupe_id && centresGroupe[ciblePrio.groupe_id])
                        ? centresGroupe[ciblePrio.groupe_id] : ciblePrio;
                    if (pRef.cur_x != null) {
                        const d = Math.hypot(ref.cur_x - pRef.cur_x, ref.cur_y - pRef.cur_y);
                        if (d <= vcfg(vehicle).portee) { vehicle.target = ciblePrio; return; }
                    }
                }
            }

            let closest = null, minDist = Infinity;
            bases.forEach(otherBase => {
                if (otherBase.joueur_id == base.joueur_id || !otherBase.vehicules) return;

                if (vehicle.type !== 'sam') {
                    // Véhicule non-SAM : cible le dernier SAM si le premier est à portée
                    const premierSam = premierSamParBase[cleBase(otherBase)];
                    const dernierSam = dernierSamParBase[cleBase(otherBase)];
                    if (premierSam) {
                        const d = Math.hypot(ref.cur_x - premierSam.cur_x, ref.cur_y - premierSam.cur_y);
                        if (d <= vcfg(vehicle).portee && dernierSam) {
                            closest = dernierSam; minDist = d;
                            return;
                        }
                    }
                    // Aucun SAM à portée : cible les véhicules normaux uniquement
                    otherBase.vehicules.forEach(enemy => {
                        if (!enemy.construit || enemy.pv <= 0 || enemy.cur_x == null) return;
                        if (enemy.type === 'sam') return;
                        const enemyRef = (enemy.groupe_id && centresGroupe[enemy.groupe_id])
                            ? centresGroupe[enemy.groupe_id] : enemy;
                        if (enemyRef.cur_x == null) return;
                        const dist = Math.hypot(ref.cur_x - enemyRef.cur_x, ref.cur_y - enemyRef.cur_y);
                        if (dist < minDist && dist <= vcfg(vehicle).portee) {
                            minDist = dist;
                            closest = (enemy.groupe_id && ciblesPrioritaires[enemy.groupe_id])
                                ? ciblesPrioritaires[enemy.groupe_id] : enemy;
                        }
                    });
                } else {
                    // SAM : ciblage normal
                    otherBase.vehicules.forEach(enemy => {
                        if (!enemy.construit || enemy.pv <= 0 || enemy.cur_x == null) return;
                        const enemyRef = (enemy.groupe_id && centresGroupe[enemy.groupe_id])
                            ? centresGroupe[enemy.groupe_id] : enemy;
                        if (enemyRef.cur_x == null) return;
                        const dist = Math.hypot(ref.cur_x - enemyRef.cur_x, ref.cur_y - enemyRef.cur_y);
                        if (dist < minDist && dist <= vcfg(vehicle).portee) {
                            minDist = dist;
                            closest = (enemy.groupe_id && ciblesPrioritaires[enemy.groupe_id])
                                ? ciblesPrioritaires[enemy.groupe_id] : enemy;
                        }
                    });
                }
            });
            vehicle.target = closest;
            if (!closest) delete groupesLastAttack[vehicle.id];
        });
    });

    // ── Synchronisation SAMs : verrou de cible ───────────────────
    // Les SAMs gardent leur groupe cible tant qu'il est vivant et à portée
    bases.forEach(base => {
        const cle    = cleBase(base);
        const premier = premierSamParBase[cle];
        if (!premier || !base.vehicules || premier.cur_x == null) return;

        const jid    = cle;   // clé unique par base, pas par joueur
        const portee = vcfg(premier).portee;
        let cibleCommune = null;

        const lock = samCibleLockeeParBase[jid];
        if (lock) {
            // Vérifier si le groupe verrouillé est encore vivant et à portée
            let lockValide = false;
            for (const otherBase of bases) {
                if (otherBase.joueur_id == jid || !otherBase.vehicules) continue;
                for (const v of otherBase.vehicules) {
                    if (!v.construit || v.pv <= 0 || v.cur_x == null) continue;
                    const memeGroupe = lock.groupeId != null
                        ? v.groupe_id === lock.groupeId
                        : v.id === lock.vehicleId;
                    if (!memeGroupe) continue;
                    const ref = (v.groupe_id && centresGroupe[v.groupe_id])
                        ? centresGroupe[v.groupe_id] : v;
                    if (ref.cur_x == null) continue;
                    const dist = Math.hypot(premier.cur_x - ref.cur_x, premier.cur_y - ref.cur_y);
                    if (dist <= portee) {
                        lockValide  = true;
                        cibleCommune = (v.groupe_id && ciblesPrioritaires[v.groupe_id])
                            ? ciblesPrioritaires[v.groupe_id] : v;
                        break;
                    }
                }
                if (lockValide) break;
            }
            if (!lockValide) samCibleLockeeParBase[jid] = null;
        }

        // Pas de verrou valide → utiliser la cible trouvée en Passe 1 et verrouiller
        if (!cibleCommune) {
            cibleCommune = premier.target;
            if (cibleCommune) {
                samCibleLockeeParBase[jid] = {
                    groupeId:  cibleCommune.groupe_id ?? null,
                    vehicleId: cibleCommune.id
                };
            }
        }

        // Tous les SAMs de la base visent la même cible
        base.vehicules.forEach(v => {
            if (v.type !== 'sam' || !v.construit || v.pv <= 0) return;
            v.target = cibleCommune;
            if (!cibleCommune && v._tir) v._tir = null;
        });
    });

    // Les SAMs ont chacun leur propre timer indépendant (plus de synchronisation de groupe)

    // ── Lookup vehicle → base (pour la réduction de dégâts SAM) ──
    const vehiculeBase = {};
    bases.forEach(base => {
        if (!base.vehicules) return;
        base.vehicules.forEach(v => { vehiculeBase[v.id] = base; });
    });

    // ── Passe 2 : attaque ─────────────────────────────────────
    const groupesSonJoue = new Set();
    bases.forEach(base => {
        if (!base.vehicules) return;
        base.vehicules.forEach(vehicle => {
            const enemy = vehicle.target;
            if (!vehicle.construit || vehicle.pv <= 0 || !enemy) return;
            // SAMs : laisser passer même si enemy.pv <= 0 (animation sur tous les SAMs)
            if (vehicle.type !== 'sam' && enemy.pv <= 0) return;

            if (vehicle.type === 'sam') {
                // Timer 100% indépendant par SAM via _nextSamFire
                if (vehicle._nextSamFire == null)
                    vehicle._nextSamFire = now + Math.floor(Math.random() * vcfg(vehicle).cooldown);
                if (now < vehicle._nextSamFire) return;
                vehicle._nextSamFire = now + vcfg(vehicle).cooldown;

                const samTarget = vehicle.target;
                if (!samTarget) return;

                vehicle._tir = { start: now, type: 'sam',
                    targetVehicle: samTarget,
                    tx: samTarget.cur_x ?? samTarget.x, ty: samTarget.cur_y ?? samTarget.y };
                vehicle._muzzleFlash = { start: now, angle: vehicle._turretAngle ?? 0,
                    puffs: Array.from({ length: 4 }, () => ({
                        ox: (Math.random() - 0.5) * 10, oy: (Math.random() - 0.5) * 10,
                        r: 0.6 + Math.random() * 0.6
                    }))
                };

                // Dégâts uniquement si la cible est encore vivante
                if (samTarget.pv <= 0) return;
                let degats = vcfg(vehicle).attaque;
                if (samTarget.type === 'sam') {
                    const baseEnnemie = vehiculeBase[samTarget.id];
                    if (baseEnnemie?.murs_beton) degats = Math.max(1, Math.floor(degats / 100));
                }
                samTarget.pv -= degats;
                samTarget.flash = now;

                if (samTarget.pv <= 0) {
                    // Rate limit par BASE CIBLE : max 1 SAM/sec quelle que soit la source des dégâts
                    const baseCible = vehiculeBase[samTarget.id];
                    const cleCible  = baseCible ? cleBase(baseCible) : String(samTarget.id);
                    if (!samDestructionParBase[cleCible]) samDestructionParBase[cleCible] = { last: 0 };
                    if (now - samDestructionParBase[cleCible].last < 1000) { samTarget.pv = 1; return; }
                    samDestructionParBase[cleCible].last = now;

                    const jid = base.joueur_id;
                    if (!samDestructionParJoueur[jid]) samDestructionParJoueur[jid] = { last: 0 };
                    samDestructionParJoueur[jid].last = now;
                    if (!destructionParJoueur[jid]) destructionParJoueur[jid] = { count: 0, windowStart: 0 };
                    const ri = destructionParJoueur[jid];
                    if (now - ri.windowStart >= 1000) { ri.count = 0; ri.windowStart = now; }
                    if (ri.count >= MAX_DESTRUCTIONS_PAR_SECONDE) { samTarget.pv = 1; return; }
                    ri.count++;
                    demarrerExplosion(samTarget);
                    jouerSonExplosion();
                    selectedVehicles = selectedVehicles.filter(s => s.vehicle !== samTarget);
                    if (selectedVehicles.length === 0) canvas.style.cursor = '';
                    majBoutonVehicule();
                    const enemyBase = vehiculeBase[samTarget.id];
                    if (enemyBase?.joueur_id == joueur_id) {
                        // Mon propre SAM détruit
                        fetch(`/api/joueur/${joueur_id}/vehicule/${samTarget.id}/supprimer`, {
                            method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
                        }).catch(() => null);
                    } else if (String(samTarget.id).startsWith('n')) {
                        // SAM de base neutre (vehicules_neutres, pas capturée)
                        const samNumericId = String(samTarget.id).slice(1);
                        fetch(`/api/joueur/${joueur_id}/sam-neutre/${samNumericId}/degats`, {
                            method: 'PATCH',
                            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ attaquant_id: vehicle.id })
                        }).catch(() => null);
                    } else if (String(samTarget.id).startsWith('c')) {
                        // SAM de base capturée ennemie (vehicules_neutres, base capturée)
                        const samNumericId = String(samTarget.id).slice(1);
                        fetch(`/api/joueur/${joueur_id}/sam-capture/${samNumericId}/degats`, {
                            method: 'PATCH',
                            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ attaquant_id: vehicle.id })
                        }).catch(() => null);
                    } else {
                        // SAM construit par le joueur (table vehicules)
                        fetch(`/api/joueur/${joueur_id}/jeep/attaquer`, {
                            method: 'PATCH',
                            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ vehicule_id: samTarget.id, attaquant_id: vehicle.id })
                        }).catch(() => null);
                    }
                }
                return;
            }

            // ── Véhicules normaux (non-SAM) ──
            if (!(vehicle.id in groupesLastAttack)) {
                const cooldown = vcfg(vehicle).cooldown;
                const slot = vehicle.formation_slot ?? Math.floor(Math.random() * GROUPE_MAX);
                groupesLastAttack[vehicle.id] = now - Math.floor((slot % GROUPE_MAX) / GROUPE_MAX * cooldown);
            }
            if (now - groupesLastAttack[vehicle.id] <= vcfg(vehicle).cooldown) return;
            groupesLastAttack[vehicle.id] = now;

            const cleGroupe = vehicle.groupe_id ?? vehicle.id;
            if (!groupesSonJoue.has(cleGroupe)) {
                jouerSonTirJeep();
                groupesSonJoue.add(cleGroupe);
            }

            // Toujours rediriger les dégâts vers le dernier véhicule du groupe (formation_slot max)
            let actualEnemy = enemy;
            if (enemy.groupe_id && ciblesPrioritaires[enemy.groupe_id]) {
                const p = ciblesPrioritaires[enemy.groupe_id];
                if (p.construit && p.pv > 0) actualEnemy = p;
            }

            let degats = vcfg(vehicle).attaque;
            if (actualEnemy.type === 'sam') {
                const baseEnnemie = vehiculeBase[actualEnemy.id];
                if (baseEnnemie?.murs_beton) degats = Math.max(1, Math.floor(degats / 100));
            }
            actualEnemy.pv -= degats;
            actualEnemy.flash = now;
            vehicle._tir = { start: now, type: vehicle.type,
                targetVehicle: actualEnemy,
                tx: actualEnemy.cur_x ?? actualEnemy.x, ty: actualEnemy.cur_y ?? actualEnemy.y };
            vehicle._muzzleFlash = { start: now, angle: vehicle._turretAngle ?? 0,
                puffs: Array.from({ length: 4 }, () => ({
                    ox: (Math.random() - 0.5) * 10,
                    oy: (Math.random() - 0.5) * 10,
                    r:  0.6 + Math.random() * 0.6
                }))
            };

            if (actualEnemy.pv <= 0) {
                // Rate limit SAM par base cible : max 1 destruction/sec quelle que soit la source
                if (actualEnemy.type === 'sam') {
                    const baseCibleNS = vehiculeBase[actualEnemy.id];
                    const cleCibleNS  = baseCibleNS ? cleBase(baseCibleNS) : String(actualEnemy.id);
                    if (!samDestructionParBase[cleCibleNS]) samDestructionParBase[cleCibleNS] = { last: 0 };
                    if (now - samDestructionParBase[cleCibleNS].last < 1000) {
                        actualEnemy.pv = 1;
                        return;
                    }
                    samDestructionParBase[cleCibleNS].last = now;
                }

                const jid = base.joueur_id;
                if (!destructionParJoueur[jid]) destructionParJoueur[jid] = { count: 0, windowStart: 0 };
                const rateInfo = destructionParJoueur[jid];
                if (now - rateInfo.windowStart >= 1000) { rateInfo.count = 0; rateInfo.windowStart = now; }
                if (rateInfo.count >= MAX_DESTRUCTIONS_PAR_SECONDE) {
                    actualEnemy.pv = 1;
                } else {
                    rateInfo.count++;
                    demarrerExplosion(actualEnemy);
                    jouerSonExplosion();
                    selectedVehicles = selectedVehicles.filter(s => s.vehicle !== actualEnemy);
                    if (selectedVehicles.length === 0) canvas.style.cursor = '';
                    majBoutonVehicule();
                    const enemyBase = vehiculeBase[actualEnemy.id];
                    if (enemyBase?.joueur_id == joueur_id) {
                        fetch(`/api/joueur/${joueur_id}/vehicule/${actualEnemy.id}/supprimer`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${token}` }
                        }).catch(() => null);
                    } else if (String(actualEnemy.id).startsWith('n')) {
                        const samNumericId = String(actualEnemy.id).slice(1);
                        fetch(`/api/joueur/${joueur_id}/sam-neutre/${samNumericId}/degats`, {
                            method: 'PATCH',
                            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ attaquant_id: vehicle.id })
                        }).catch(() => null);
                    } else {
                        fetch(`/api/joueur/${joueur_id}/jeep/attaquer`, {
                            method: 'PATCH',
                            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ vehicule_id: actualEnemy.id, attaquant_id: vehicle.id })
                        }).catch(() => null);
                    }
                }
            }
        });
    });

}
