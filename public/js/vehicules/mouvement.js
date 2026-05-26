// Variables globales pour planification anticipée du chemin
let _tousLescercles = {};
let _refsGroupes    = {};

function planifierCheminGroupe(gid, targetX, targetY) {
    const ref = _refsGroupes[gid];
    if (!ref || ref.cur_x == null) return;

    // Si le groupe est en mouvement : continuer vers l'ancienne cible 2.5s, puis basculer
    const isMoving = !ref._reachedDest && ref._pfTarget != null;
    if (isMoving) {
        // Sauvegarder l'ANCIENNE cible dans _pendingOrder (avant que ref.x soit écrasé)
        const oldX = ref._pfTarget?.x ?? ref.cur_x;
        const oldY = ref._pfTarget?.y ?? ref.cur_y;
        ref._pendingOrder = { x: targetX, y: targetY, t: Date.now(), oldX, oldY };
        // Ne PAS modifier ref.x/ref.y ici : la boucle de mouvement le fera chaque frame
        return; // garder les anciens waypoints, continuer le mouvement
    }

    // Groupe arrêté : appliquer immédiatement avec contrainte d'alignement
    ref._pendingOrder        = null;
    ref._applyTurnConstraint = true;
    ref._reachedDest         = false;
    const gc      = _tousLescercles[gid];
    const gcRayon = gc ? gc.rayon : PF_RAYON_MIN;
    const gcx     = gc ? gc.cx   : ref.cur_x;
    const gcy     = gc ? gc.cy   : ref.cur_y;
    const BASE_RAYON = 380;
    const obsBase = [
        ...Object.entries(_tousLescercles).map(([g, v]) => ({
            gid: Number(g), cx: v.cx, cy: v.cy,
            rayon: Math.max(v.rayon + PF_RAYON_MIN, PF_RAYON_MIN)
        })),
        ...bases.map(b => ({ gid: 0, cx: b.pos_x, cy: b.pos_y, rayon: BASE_RAYON, rayonY: 190, isBase: true }))
    ];
    const obsElargis = pfObstaclesGroupe(obsBase, gid, gcRayon);
    const _pdx = targetX - gcx, _pdy = targetY - gcy, _plen2 = _pdx*_pdx + _pdy*_pdy;
    const obsProches = obsElargis.filter(o => {
        if (_plen2 < 1) return Math.hypot(o.cx - gcx, o.cy - gcy) < DISTANCE_MAX_REJOINDRE * 2;
        const t = Math.max(0, Math.min(1, ((o.cx-gcx)*_pdx + (o.cy-gcy)*_pdy) / _plen2));
        const nearX = gcx + t*_pdx, nearY = gcy + t*_pdy;
        return Math.hypot(o.cx - nearX, o.cy - nearY) < DISTANCE_MAX_REJOINDRE + o.rayon;
    });
    const astarResult = pfAstar(gcx, gcy, targetX, targetY, obsProches);
    let chemin;
    if (astarResult) {
        chemin = astarResult.path;
        ref._effectiveDest = astarResult.effectiveDest;
    } else {
        const obsFus = pfFusionnerObstacles(obsProches);
        chemin = pfCalculerChemin(gcx, gcy, targetX, targetY, obsFus);
        ref._effectiveDest = null;
    }
    ref._waypoints = pfOptimiserChemin(gcx, gcy, chemin, obsProches);
    ref._pfTarget   = { x: targetX, y: targetY };
    ref._pfLastCalc = Date.now();
}

// ── Calcul des cercles englobants de chaque groupe ───────────
function calculerCerclesGroupes(tousVehicules) {
    const echelle = MAP_W / 5000;
    const cercles = {};
    tousVehicules.forEach(v => {
        if (!v.groupe_id) return;
        if (!cercles[v.groupe_id]) cercles[v.groupe_id] = { sumX: 0, sumY: 0, n: 0, cx: 0, cy: 0, rayon: 0 };
        cercles[v.groupe_id].sumX += v.cur_x;
        cercles[v.groupe_id].sumY += v.cur_y;
        cercles[v.groupe_id].n++;
    });
    Object.values(cercles).forEach(g => { g.cx = g.sumX / g.n; g.cy = g.sumY / g.n; });
    tousVehicules.forEach(v => {
        if (!v.groupe_id) return;
        const g = cercles[v.groupe_id];
        // Chebyshev : max(|dx|, |dy|) correspond à l'étendue réelle de la formation rectangulaire
        const r = Math.max(Math.abs(v.cur_x - g.cx), Math.abs(v.cur_y - g.cy));
        if (r > g.rayon) g.rayon = r;
    });
    // Ajouter la demi-largeur sprite en unités map pour un contact bord-à-bord exact
    const { frameWidth } = getVehicleSpriteSize(imgJeep);
    const spriteHalfMap = frameWidth > 0 ? (frameWidth * VEHICLE_SCALE) / 2 / echelle : 15;
    Object.values(cercles).forEach(g => { g.rayon += spriteHalfMap; });
    return cercles;
}

// ── Évitement look-ahead ─────────────────────────────────────
function eviterCercles(curX, curY, vx, vy, cercles, ownRadius = VEHICLE_RADIUS) {
    const speed = Math.hypot(vx, vy);
    if (speed < 0.1) return { cx: 0, cy: 0 };
    const dirX = vx / speed, dirY = vy / speed;
    const lookAhead = speed * 20 + ownRadius;
    let cx = 0, cy = 0;
    for (const g of cercles) {
        const ax = g.cx - curX, ay = g.cy - curY;
        const dist = Math.hypot(ax, ay);
        const minDist = g.rayon + ownRadius;
        if (!isFinite(dist) || dist < 0.01 || dist < g.rayon) continue;
        const dot = ax * dirX + ay * dirY;
        if (dot <= 0 || dot > lookAhead + g.rayon) continue;
        const perpX = ax - dot * dirX, perpY = ay - dot * dirY;
        const perpDist = Math.hypot(perpX, perpY);
        if (!isFinite(perpDist) || perpDist < 0.01 || perpDist >= minDist) continue;
        const force = (minDist - perpDist) / minDist * 3;
        const side = (perpX * dirY - perpY * dirX) >= 0 ? 1 : -1;
        cx += -side * dirY * force * speed;
        cy +=  side * dirX * force * speed;
    }
    return { cx, cy };
}


// ── Animation & déplacement ───────────────────────────────────
function animerVehicules() {
    gererCombatVehicules();
    const now = Date.now();

    // Initialiser cur_x/cur_y si manquant
    bases.forEach(b => {
        if (!b.vehicules) return;
        b.vehicules.forEach(v => {
            if (v.construit && v.x != null && v.cur_x == null) { v.cur_x = v.x; v.cur_y = v.y; }
        });
    });

    // Mouvement simplifié pour les véhicules des autres joueurs (interpolation directe)
    bases.forEach(b => {
        if (!b.vehicules || b.joueur_id == joueur_id) return;
        b.vehicules.forEach(v => {
            if (!v.construit || v.cur_x == null) return;
            const dx = v.x - v.cur_x, dy = v.y - v.cur_y;
            const dist = Math.hypot(dx, dy);
            if (dist < 1) return;
            const spd = Math.min(vcfg(v).speed, dist);
            v.cur_x += (dx / dist) * spd;
            v.cur_y += (dy / dist) * spd;
            majDirection(v, dx, dy);
        });
    });

    // Référence (slot 0) et membres de chaque groupe (seulement le joueur courant)
    const refsGroupes   = {};
    const membresGroupes = {};
    bases.forEach(b => {
        if (!b.vehicules || b.joueur_id != joueur_id) return;
        b.vehicules.forEach(v => {
            if (!v.construit || !v.groupe_id || v.cur_x == null) return;
            if (!membresGroupes[v.groupe_id]) membresGroupes[v.groupe_id] = [];
            membresGroupes[v.groupe_id].push(v);
            const cur = refsGroupes[v.groupe_id];
            if (!cur || (v.formation_slot ?? Infinity) < (cur.formation_slot ?? Infinity))
                refsGroupes[v.groupe_id] = v;
        });
    });

    // Tous les véhicules actifs
    const tousVehicules = [];
    bases.forEach(b => {
        if (b.vehicules) b.vehicules.forEach(v => { if (v.construit && v.cur_x != null) tousVehicules.push(v); });
    });

    // Cercles englobants de chaque groupe (mis à jour globalement)
    const tousLescercles = calculerCerclesGroupes(tousVehicules);
    _tousLescercles = tousLescercles;
    _refsGroupes    = refsGroupes;
    _tousLescercles = tousLescercles;
    _refsGroupes    = refsGroupes;

    const BASE_RAYON = 380;
    const basesObs = bases.map(b => ({ gid: 0, cx: b.pos_x, cy: b.pos_y, rayon: BASE_RAYON, rayonY: 190, isBase: true }));

    // A* : seulement les groupes arrêtés, rayon réduit → chemin non bloqué par les convois
    const obsPathfinding = [
        ...Object.entries(tousLescercles)
            .filter(([gidStr]) => { const r = refsGroupes[Number(gidStr)]; return !r || r._reachedDest; })
            .map(([gidStr, g]) => ({ gid: Number(gidStr), cx: g.cx, cy: g.cy, rayon: Math.max(g.rayon * 0.35 + PF_RAYON_MIN, PF_RAYON_MIN) })),
        ...basesObs
    ];

    // Collision temps-réel : rayon réduit pour permettre aux groupes de se rapprocher
    const obsCollision = [
        ...Object.entries(tousLescercles)
            .map(([gidStr, g]) => ({ gid: Number(gidStr), cx: g.cx, cy: g.cy, rayon: Math.max(g.rayon * 0.6, 4) })),
        ...basesObs
    ];

    // ── Déplacement des groupes (joueur courant uniquement) ──────
    const groupesTraites = new Set();
    bases.forEach(base => {
        if (!base.vehicules || base.joueur_id != joueur_id) return;
        base.vehicules.forEach(vehicle => {
            if (!vehicle.construit || !vehicle.groupe_id || vehicle.cur_x == null) return;
            const gid = vehicle.groupe_id;
            if (groupesTraites.has(gid)) return;
            const ref = refsGroupes[gid];
            if (!ref || vehicle !== ref) return;
            groupesTraites.add(gid);

            const membres     = membresGroupes[gid] ?? [ref];
            const refSpeed    = vcfg(ref).speed;
            const rayonGroupe = tousLescercles[gid]?.rayon ?? VEHICLE_RADIUS;

            // ── TT capture phase 1 → 2 : passer en mode direct dès que assez proche de la niche ──
            if (ref._captureStage === 1 && ref._baseCaptureCible) {
                const bc = ref._baseCaptureCible;
                const nicheX = bc.pos_x - 250, nicheY = bc.pos_y + 72;
                if (Math.hypot(ref.cur_x - nicheX, ref.cur_y - nicheY) < 150) {
                    ref._captureStage = 2;
                    ref._stuck        = null;
                    ref._reachedDest  = false;
                }
            }

            // ── TT capture phase 2 : mouvement direct vers la niche, toutes collisions ignorées ──
            if (ref._captureStage === 2 && ref._baseCaptureCible) {
                const bc = ref._baseCaptureCible;
                const tx = bc.pos_x - 250, ty = bc.pos_y + 72;
                const ddx = tx - ref.cur_x, ddy = ty - ref.cur_y;
                const dd  = Math.hypot(ddx, ddy);
                if (dd <= refSpeed) {
                    // TT arrivé : capturer la base et supprimer le TT
                    const bidNum = bc._neutreId ?? String(bc.joueur_id ?? '').replace('neutre_', '');
                    console.log('[TT CAPTURE] bidNum=', bidNum, 'bc.joueur_id=', bc.joueur_id, 'bc._neutreId=', bc._neutreId);
                    const maBase3 = bases.find(b => b.joueur_id == joueur_id);
                    // 1. Capturer d'abord (TT encore en DB)
                    const capturePromise = bidNum
                        ? fetch(`/api/joueur/${joueur_id}/capturer-base/${bidNum}`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}` }
                          }).then(r => { console.log('[TT CAPTURE] status=', r.status); return r.json(); })
                          .then(data => {
                            console.log('[TT CAPTURE] data=', data);
                            if (data.ok) {
                                bc.joueur_id = joueur_id;
                                bc.neutre    = false;
                                bc._capturee = true;
                                if (data.pseudo) bc.pseudo = data.pseudo;
                                bc.vehicules?.forEach(v => { if (v.type === 'sam') v.pv = 800; });
                            }
                          }).catch(e => console.error('[TT CAPTURE ERR]', e))
                        : Promise.resolve();
                    // 2. Supprimer le TT après la capture
                    capturePromise.then(() => {
                        membres.forEach(v => {
                            fetch(`/api/joueur/${joueur_id}/vehicule/${v.id}/supprimer`, {
                                method: 'DELETE',
                                headers: { 'Authorization': `Bearer ${token}` }
                            }).catch(() => null);
                        });
                    });
                    // Retirer le TT localement immédiatement
                    if (maBase3?.vehicules)
                        maBase3.vehicules = maBase3.vehicules.filter(v => !membres.includes(v));
                    selectedVehicles = selectedVehicles.filter(s => !membres.includes(s.vehicle));
                    if (selectedVehicles.length === 0) canvas.style.cursor = '';
                } else {
                    membres.forEach(v => {
                        v.cur_x += (ddx / dd) * refSpeed;
                        v.cur_y += (ddy / dd) * refSpeed;
                        majDirection(v, ddx, ddy, TURN_RATE_AUTO);
                    });
                }
                return;
            }

            // ── Ordre en attente : maintenir l'ancienne cible chaque frame pendant 2.5s ──
            if (ref._pendingOrder) {
                if (Date.now() - ref._pendingOrder.t < 2500) {
                    // Réimposer l'ancienne cible à chaque frame (la branche d'arrivée peut l'écraser)
                    ref.x = ref._pendingOrder.oldX;
                    ref.y = ref._pendingOrder.oldY;
                    ref._effectiveDest = null;
                } else {
                    // Délai écoulé : basculer vers la nouvelle cible
                    ref.x = ref._pendingOrder.x;
                    ref.y = ref._pendingOrder.y;
                    ref._pendingOrder        = null;
                    ref._applyTurnConstraint = true;
                    ref._reachedDest         = false;
                    ref._waypoints           = [];
                    ref._pfLastCalc          = 0;
                    ref._effectiveDest       = null;
                }
            }

            // Destination effective : ajustée si la cible était bloquée par un obstacle
            const targetX = ref._effectiveDest?.x ?? ref.x;
            const targetY = ref._effectiveDest?.y ?? ref.y;
            const dx   = targetX - ref.cur_x, dy = targetY - ref.cur_y;
            const dist = Math.hypot(dx, dy);
            const seuilArrivee = refSpeed * 2;

            if (dist > seuilArrivee && !ref._reachedDest) {
                const gc      = tousLescercles[gid];
                const gcRayon = gc ? gc.rayon : PF_RAYON_MIN;
                const gcx     = gc ? gc.cx    : ref.cur_x;
                const gcy     = gc ? gc.cy    : ref.cur_y;
                // A* : obstacles réduits (groupes arrêtés seulement)
                const obsElargis     = pfObstaclesGroupe(obsPathfinding, gid, gcRayon);
                // Collision : obstacles pleins (tous les groupes)
                const obsCollElargis = pfObstaclesGroupe(obsCollision,   gid, gcRayon);

                pfMettreAJourChemin(ref, gcx, gcy, obsElargis, now);

                // Si effectiveDest est encore dans la collision physique → inaccessible, s'arrêter ici
                if (ref._effectiveDest) {
                    const edX = ref._effectiveDest.x, edY = ref._effectiveDest.y;
                    const blocked = obsCollElargis.some(o => _pfDansObstacle(edX, edY, o));
                    if (blocked) {
                        ref._effectiveDest = null;
                        ref._waypoints     = [];
                        ref._reachedDest   = true;
                        ref._currentSpd    = 0;
                        ref._stuck         = null;
                        membres.forEach(v => { v.x = v.cur_x; v.y = v.cur_y; signalerArrivee(v); });
                        return;
                    }
                }

                pfAvancerWaypoints(ref, gcx, gcy, refSpeed * 4);

                const wp = (ref._waypoints && ref._waypoints.length > 0)
                    ? ref._waypoints[0] : { x: targetX, y: targetY };
                const dxWp = wp.x - gcx, dyWp = wp.y - gcy;
                const distWp = Math.hypot(dxWp, dyWp);

                // Vitesse plafonnée à distWp pour ne pas dépasser le waypoint
                const spdWp = Math.min(refSpeed, distWp > 0.01 ? distWp : dist);
                let vx = (distWp > 0.01) ? dxWp/distWp*spdWp : dx/dist*Math.min(refSpeed, dist);
                let vy = (distWp > 0.01) ? dyWp/distWp*spdWp : dy/dist*Math.min(refSpeed, dist);

                const hasIntermediaires = ref._waypoints && ref._waypoints.length > 1;
                // Répulsion soft (obstacles de collision pleins)
                if (!hasIntermediaires && dist > refSpeed * 4) {
                    for (const o of obsCollElargis) {
                        const nx = gcx - o.cx, ny = gcy - o.cy;
                        const d  = Math.hypot(nx, ny);
                        if (d < 0.001) continue;
                        const nnx = nx/d, nny = ny/d;
                        if (d < o.rayon) {
                            const force = (o.rayon - d) / o.rayon * refSpeed * 1.5;
                            vx += nnx*force; vy += nny*force;
                        } else if (d < o.rayon * 1.5) {
                            const dot = vx*nnx + vy*nny;
                            if (dot < 0) {
                                const fac = 1 - (d - o.rayon) / (o.rayon * 0.5);
                                vx -= dot*nnx*fac*0.7; vy -= dot*nny*fac*0.7;
                            }
                        }
                    }
                }

                ({ vx, vy } = pfClipperVelocite(gcx, gcy, vx, vy, obsCollElargis));

                let mag = Math.hypot(vx, vy);
                if (!isFinite(mag) || mag < 0.001) return;
                let ux = vx / mag, uy = vy / mag;

                // Approche finale : corriger la direction pour pointer directement vers la destination
                const SEUIL_DIRECT_GRP = seuilArrivee * 5;
                if (dist <= SEUIL_DIRECT_GRP && dist > 0.01) {
                    ux = dx / dist; uy = dy / dist;
                    vx = ux * Math.min(refSpeed, dist);
                    vy = uy * Math.min(refSpeed, dist);
                    // Forcer l'angle du groupe directement — plus de rotation erratique
                    ref._dirAngle = Math.atan2(ux, -uy);
                }

                // Rotation vers la cible
                const tgtAngle = Math.atan2(ux, -uy);
                let aDelta = tgtAngle - (ref._dirAngle ?? tgtAngle);
                if (aDelta >  Math.PI) aDelta -= 2 * Math.PI;
                if (aDelta < -Math.PI) aDelta += 2 * Math.PI;

                // Accélération / décélération
                const decelDist  = refSpeed * 35;
                const distFactor = Math.min(1, dist / decelDist);
                const orderFactor = ref._pendingOrder
                    ? Math.max(0, 1 - (Date.now() - ref._pendingOrder.t) / 2500)
                    : 1;
                // Ralentissement en virage
                let alignFactor;
                if (!ref._pendingOrder && ref._applyTurnConstraint) {
                    // Ordre joueur : arrêt complet si face opposée
                    alignFactor = Math.max(0, Math.cos(aDelta));
                    if (Math.abs(aDelta) < Math.PI / 3) ref._applyTurnConstraint = false;
                } else if (!ref._pendingOrder) {
                    // Pathfinding auto : ralentissement progressif en virage, jamais à l'arrêt
                    alignFactor = Math.max(0.2, Math.cos(aDelta) ** 3);
                } else {
                    alignFactor = 1; // délai en cours : pas de contrainte
                }
                // Cession de passage : si un groupe croise notre route devant nous, ralentir
                let yieldFactor = 1;
                if (!ref._pendingOrder && !ref._applyTurnConstraint) {
                    const myMag = Math.hypot(ux, uy); // déjà normalisé (=1)
                    for (const [g2str, c2] of Object.entries(tousLescercles)) {
                        const g2 = Number(g2str);
                        if (g2 === gid) continue;
                        const oRef = refsGroupes[g2];
                        if (!oRef || oRef._reachedDest) continue; // seulement les groupes en mouvement
                        // Direction de l'autre groupe
                        const fa = oRef._dirAngle ?? 0;
                        const gvx = Math.sin(fa), gvy = -Math.cos(fa);
                        const dot = ux * gvx + uy * gvy; // >0 = même sens, <0 = face
                        if (dot > 0.6) continue; // même direction : pas de cession
                        // Est-il devant nous dans notre direction ?
                        const dxG = c2.cx - gcx, dyG = c2.cy - gcy;
                        const fwd = dxG * ux + dyG * uy;
                        if (fwd <= 0 || fwd > refSpeed * 25) continue; // derrière ou trop loin
                        // Distance latérale par rapport à notre trajectoire
                        const latX = dxG - fwd * ux, latY = dyG - fwd * uy;
                        const latD = Math.hypot(latX, latY);
                        const clearance = (tousLescercles[gid]?.rayon ?? PF_RAYON_MIN) + c2.rayon + 6;
                        if (latD < clearance) {
                            // Groupe en travers : céder le passage (ralentir progressivement)
                            const urgency = 1 - latD / clearance;
                            yieldFactor = Math.min(yieldFactor, Math.max(0.05, 1 - urgency * 0.95));
                        }
                    }
                }
                const targetSpd  = refSpeed * alignFactor * distFactor * orderFactor * yieldFactor;
                const accel = refSpeed / 120; // accélération sur ~2s (120 frames à 60fps)
                const decel = refSpeed / 15;
                if (ref._currentSpd == null) ref._currentSpd = 0;
                if (ref._currentSpd < targetSpd)
                    ref._currentSpd = Math.min(targetSpd, ref._currentSpd + accel);
                else
                    ref._currentSpd = Math.max(targetSpd, ref._currentSpd - decel);

                // Déplacement dans la direction REGARDÉE (inertie réaliste)
                const facingAngle = ref._dirAngle ?? tgtAngle;
                const fvx = Math.sin(facingAngle) * ref._currentSpd;
                const fvy = -Math.cos(facingAngle) * ref._currentSpd;

                const rotRate = ref._applyTurnConstraint ? TURN_RATE : TURN_RATE_AUTO;
                membres.forEach(v => {
                    v.cur_x += fvx; v.cur_y += fvy;
                    // Bloquer la rotation dans la zone d'approche finale (évite la toupie)
                    if (dist > SEUIL_DIRECT_GRP) {
                        majDirection(v, ux * refSpeed, uy * refSpeed, rotRate);
                    } else {
                        v._dirAngle = ref._dirAngle; // forcer l'angle du groupe sur chaque membre
                    }
                });

                // Bloqué en rotation : pas de détection de blocage
                if (ref._applyTurnConstraint && alignFactor < 0.15) { ref._stuck = null; return; }

                if (!ref._stuck) {
                    ref._stuck = { x: ref.cur_x, y: ref.cur_y, t: now, essais: 0 };
                    ref._pfLastCalc = 0; // recalcul unique au premier blocage détecté
                } else if (now - ref._stuck.t >= 800) {
                    const prog = Math.hypot(ref.cur_x - ref._stuck.x, ref.cur_y - ref._stuck.y);
                    if (prog < refSpeed) {
                        ref._stuck.essais = (ref._stuck.essais || 0) + 1;
                        // Proche de la destination OU bloqué trop longtemps : s'arrêter proprement
                        if (dist < seuilArrivee * 3 || ref._stuck.essais >= 2) {
                            ref._waypoints   = [];
                            ref._reachedDest = true;
                            ref._currentSpd  = 0;
                            membres.forEach(v => {
                                v.x = v.cur_x; v.y = v.cur_y;
                                signalerArrivee(v);
                            });
                            ref._stuck = null;
                        }
                        // Pas de _pfLastCalc = 0 ici : évite le zigzag par recalcul répété
                    } else {
                        ref._stuck.essais = 0;
                    }
                    ref._stuck = ref._stuck ? { x: ref.cur_x, y: ref.cur_y, t: now, essais: ref._stuck.essais } : null;
                }
            } else {
                // Arrivé : figer chaque membre sur place, sans repositionnement
                ref._stuck       = null;
                ref._waypoints   = [];
                ref._reachedDest = true;
                ref._currentSpd  = 0;

                if (ref._premiereOffset) {
                    // Offset initial atteint : chercher un groupe à rejoindre
                    ref._premiereOffset = false;
                    const tousVehRef = bases.filter(b => b.joueur_id == joueur_id).flatMap(b => b.vehicules ?? []);
                    if (tousVehRef.length > 0) {
                        const spx = ref.cur_x, spy = ref.cur_y;
                        let groupeCible = null, distMin = Infinity;
                        const groupesVus2 = new Set();
                        tousVehRef.forEach(vv => {
                            if (!vv.construit || vv.id === ref.id || !vv.groupe_id || vv.groupe_id === ref.groupe_id) return;
                            if (groupesVus2.has(vv.groupe_id)) return;
                            groupesVus2.add(vv.groupe_id);
                            if (typeVehicule(vv) !== typeVehicule(ref)) return;
                            const mbrs = tousVehRef.filter(m => m.groupe_id === vv.groupe_id && m.construit);
                            const pend = tousVehRef.filter(m => m._pendingGroupe?.groupeId === vv.groupe_id).length;
                            if (mbrs.length + pend >= GROUPE_MAX) return;
                            const centre = mbrs.reduce((min, m) =>
                                (m.formation_slot ?? Infinity) < (min.formation_slot ?? Infinity) ? m : min, mbrs[0]);
                            const cx = centre.cur_x ?? centre.x, cy = centre.cur_y ?? centre.y;
                            if (cx == null) return;
                            const dist = Math.hypot(spx - cx, spy - cy);
                            if (dist < distMin) { distMin = dist; groupeCible = { groupeId: vv.groupe_id, mbrs, centre }; }
                        });

                        if (groupeCible && distMin <= DISTANCE_MAX_REJOINDRE) {
                            // Rejoindre le groupe : supprimer le solo actuel
                            const ancienGid = ref.groupe_id;
                            ref.groupe_id = null; ref.formation_slot = null;
                            if (ancienGid) fetch(`/api/joueur/${joueur_id}/groupe/${ancienGid}`, {
                                method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
                            }).catch(() => null);
                            const slotsOcc = new Set(groupeCible.mbrs.map(m => m.formation_slot).filter(s => s != null));
                            let slot = 0;
                            while (slotsOcc.has(slot) && slot < GROUPE_MAX) slot++;
                            if (slot < GROUPE_MAX) {
                                const cx = groupeCible.centre.cur_x ?? groupeCible.centre.x;
                                const cy = groupeCible.centre.cur_y ?? groupeCible.centre.y;
                                const pos = positionsFormation(GROUPE_MAX, cx, cy)[slot];
                                ref.formation_slot = slot;
                                ref._pendingGroupe = { groupeId: groupeCible.groupeId, timestamp: Date.now() };
                                ref._reachedDest   = false;
                                deplacerVehicule(null, ref, pos.x, pos.y);
                            }
                        } else if (ref._nicheX != null) {
                            // Aucun groupe à portée : trouver une position libre loin des autres groupes
                            ref._reachedDest = false;
                            ref._waypoints   = [];
                            ref._pfLastCalc  = 0;
                            // Position de base
                            let destX = ref._nicheX - 225, destY = ref._nicheY + 225;
                            // Si la position est occupée, chercher une position libre en spirale
                            const minSep = (tousLescercles[ref.groupe_id]?.rayon ?? 100) * 2 + 20;
                            const autres = Object.entries(tousLescercles)
                                .filter(([g]) => Number(g) !== ref.groupe_id);
                            const estBloque = (x, y) => autres.some(([, c]) =>
                                Math.hypot(x - c.cx, y - c.cy) < minSep + c.rayon
                            );
                            if (estBloque(destX, destY)) {
                                const pas = minSep;
                                const dirs = [
                                    [-1, 0], [-1, 1], [0, 1], [1, 1],
                                    [1, 0],  [1, -1], [0, -1], [-1, -1]
                                ];
                                let trouve = false;
                                for (let r = 1; r <= 5 && !trouve; r++) {
                                    for (const [dx, dy] of dirs) {
                                        const tx = destX + dx * pas * r;
                                        const ty = destY + dy * pas * r;
                                        if (!estBloque(tx, ty)) {
                                            destX = tx; destY = ty;
                                            trouve = true; break;
                                        }
                                    }
                                }
                            }
                            deplacerVehicule(null, ref, destX, destY);
                        }
                    }
                } else {
                    membres.forEach(v => {
                        v.x = v.cur_x; v.y = v.cur_y;
                        signalerArrivee(v);
                    });

                }
            }
        });
    });

    // ── Déplacement des solos (joueur courant uniquement) ────────
    bases.forEach(base => {
        if (!base.vehicules || base.joueur_id != joueur_id) return;
        base.vehicules.forEach(vehicle => {
            if (!vehicle.construit || vehicle.groupe_id || vehicle.x == null || vehicle.cur_x == null || vehicle.type === 'sam') return;
            if (vehicle._ancreEnNiche) return;

            // ── TT phase 2 : mouvement direct vers la niche, sans pathfinding ni collision ──
            if (vehicle._captureStage === 2) {
                const bc = vehicle._baseCaptureCible;
                if (!bc) { vehicle._captureStage = null; return; }
                const tx = bc.pos_x - 250, ty = bc.pos_y + 72;
                const ddx = tx - vehicle.cur_x, ddy = ty - vehicle.cur_y;
                const dd  = Math.hypot(ddx, ddy);
                if (dd <= vcfg(vehicle).speed) {
                    vehicle.cur_x = tx; vehicle.cur_y = ty;
                    vehicle._ancreEnNiche = true;
                    signalerArrivee(vehicle);
                } else {
                    const spd = vcfg(vehicle).speed;
                    vehicle.cur_x += (ddx / dd) * spd;
                    vehicle.cur_y += (ddy / dd) * spd;
                    majDirection(vehicle, ddx, ddy, TURN_RATE_AUTO);
                }
                return;
            }

            const dx   = vehicle.x - vehicle.cur_x, dy = vehicle.y - vehicle.cur_y;
            const dist = Math.hypot(dx, dy);

            if (dist <= vcfg(vehicle).speed) {
                vehicle._stuck = null;
                if (isFinite(vehicle.x) && isFinite(vehicle.y)) { vehicle.cur_x = vehicle.x; vehicle.cur_y = vehicle.y; }
                signalerArrivee(vehicle);
                return;
            }

            const groupeCibleId = vehicle._pendingGroupe?.groupeId;
            const baseCap = vehicle._baseCaptureCible;

            // TT en capture : exclure la base cible des obstacles pour y entrer directement
            const obstaclesPF = obsPathfinding.filter(o =>
                (!groupeCibleId || o.gid !== Number(groupeCibleId)) &&
                !(baseCap && o.isBase && Math.hypot(o.cx - baseCap.pos_x, o.cy - baseCap.pos_y) < 10)
            );
            const obstaclesCol = obsCollision.filter(o =>
                (!groupeCibleId || o.gid !== Number(groupeCibleId)) &&
                !(baseCap && o.isBase && Math.hypot(o.cx - baseCap.pos_x, o.cy - baseCap.pos_y) < 10)
            );

            const sMaxSpd0 = vcfg(vehicle).speed;
            // Proche de la destination : aller directement, ignorer waypoints et obstacles
            const SEUIL_DIRECT = sMaxSpd0 * 6;
            let vx, vy, sux = 0, suy = 0;

            if (dist <= SEUIL_DIRECT) {
                // Approche finale : direction directe vers dest, orientation forcée immédiatement
                sux = dx / dist; suy = dy / dist;
                vx  = sux * Math.min(sMaxSpd0, dist);
                vy  = suy * Math.min(sMaxSpd0, dist);
                // Forcer l'angle directement — pas de rotation progressive qui cause la toupie
                vehicle._dirAngle = Math.atan2(sux, -suy);
            } else {
                // Pathfinding A* (obstacles réduits)
                pfMettreAJourChemin(vehicle, vehicle.cur_x, vehicle.cur_y, obstaclesPF, now);
                pfAvancerWaypoints(vehicle, vehicle.cur_x, vehicle.cur_y, sMaxSpd0 * 4);

                const wp    = (vehicle._waypoints && vehicle._waypoints.length > 0)
                    ? vehicle._waypoints[0] : { x: vehicle.x, y: vehicle.y };
                const dxWp  = wp.x - vehicle.cur_x, dyWp = wp.y - vehicle.cur_y;
                const distWp = Math.hypot(dxWp, dyWp);

                vx = (distWp > 0.01) ? dxWp/distWp*Math.min(sMaxSpd0, distWp)
                                      : dx/dist*Math.min(sMaxSpd0, dist);
                vy = (distWp > 0.01) ? dyWp/distWp*Math.min(sMaxSpd0, distWp)
                                      : dy/dist*Math.min(sMaxSpd0, dist);

                ({ vx, vy } = pfClipperVelocite(vehicle.cur_x, vehicle.cur_y, vx, vy, obstaclesCol));

                const mag = Math.hypot(vx, vy);
                if (!isFinite(mag) || mag < 0.001) { vx = 0; vy = 0; }
                else { sux = vx / mag; suy = vy / mag; }
            }

            // Rotation vers la cible (avance toujours, tourne en roulant)
            const sTgt = Math.atan2(sux, -suy);

            // Accélération / décélération : seulement à l'approche
            const sMaxSpd  = sMaxSpd0;
            const sDecelDist = sMaxSpd * 35;
            const sDistFactor = Math.min(1, dist / sDecelDist);
            const sTargetSpd  = sMaxSpd * sDistFactor;
            const sAccel = sMaxSpd / 25;
            const sDecel = sMaxSpd / 15;
            if (vehicle._currentSpd == null) vehicle._currentSpd = 0;
            if (vehicle._currentSpd < sTargetSpd)
                vehicle._currentSpd = Math.min(sTargetSpd, vehicle._currentSpd + sAccel);
            else
                vehicle._currentSpd = Math.max(sTargetSpd, vehicle._currentSpd - sDecel);

            // Déplacement dans la direction REGARDÉE (inertie réaliste)
            const sFacingAngle = vehicle._dirAngle ?? sTgt;
            vehicle.cur_x += Math.sin(sFacingAngle) * vehicle._currentSpd;
            vehicle.cur_y += -Math.cos(sFacingAngle) * vehicle._currentSpd;

            // Ne pas mettre à jour la rotation dans la zone d'approche finale
            if (dist > SEUIL_DIRECT) {
                majDirection(vehicle, sux * sMaxSpd, suy * sMaxSpd, TURN_RATE_AUTO);
            }

            // TT en capture : pas de stuck detection (évite l'écrasement de destination)
            if (!vehicle._baseCaptureCible) {
                if (!vehicle._stuck) vehicle._stuck = { x: vehicle.cur_x, y: vehicle.cur_y, t: now };
                else if (now - vehicle._stuck.t >= 600) {
                    if (Math.hypot(vehicle.cur_x - vehicle._stuck.x, vehicle.cur_y - vehicle._stuck.y) < vcfg(vehicle).speed)
                        vehicle.x = vehicle.cur_x; vehicle.y = vehicle.cur_y;
                    vehicle._stuck = { x: vehicle.cur_x, y: vehicle.cur_y, t: now };
                }
            }
        });
    });

    // ── Capture de base par TT ───────────────────────────────
    const CAPTURE_RAYON = 50; // distance en unités map depuis la niche
    bases.forEach(base => {
        if (!base.neutre || base.joueur_id != null) return; // seulement bases neutres non capturées
        // Vérifier qu'il n'y a plus de SAMs vivants sur cette base
        const samVivant = base.vehicules?.some(v => v.type === 'sam' && v.construit && v.pv > 0);
        if (samVivant) return;
        // Position exacte de la niche
        const nicheX = base.pos_x - 250, nicheY = base.pos_y + 72;
        // Chercher un TT du joueur dans le rayon de capture
        const maBase2 = bases.find(b => b.joueur_id == joueur_id);
        if (!maBase2?.vehicules) return;
        maBase2.vehicules.forEach(v => {
            if (v.type !== 'tt' || !v.construit || v._capturant || v.cur_x == null) return;
            const d = Math.hypot(v.cur_x - nicheX, v.cur_y - nicheY);
            if (d > CAPTURE_RAYON) return;
            v._capturant = true; // éviter double envoi
            const baseNeutreId = typeof base.joueur_id === 'string'
                ? base.joueur_id.replace('neutre_', '') : null;
            if (!baseNeutreId) return;
            fetch(`/api/joueur/${joueur_id}/capturer-base/${baseNeutreId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()).then(data => {
                if (data.ok) {
                    base.joueur_id = joueur_id;
                    base.neutre    = false;
                    afficherMessageErreur?.('Base capturée !');
                }
                v._capturant     = false;
                v._captureStage  = null;
                v._baseCaptureCible = null;
            }).catch(() => { v._capturant = false; });
        });
    });

    // ── Perte d'une base capturée (tous les SAMs détruits) ──────
    // N'importe quel client peut détecter et signaler la perte
    bases.forEach(base => {
        if (base._neutreId == null || !base.joueur_id || base._perteEnCours) return;
        // Marquer _avaitSams dès que la base a des SAMs construits (vivants OU à 0 PV)
        if (!base._avaitSams) {
            if (base.vehicules?.some(v => v.type === 'sam' && v.construit))
                base._avaitSams = true;
            else
                return;
        }
        // PV inconnu/null → traité comme mort (0), pas vivant (1)
        const samVivant = base.vehicules?.some(v => v.type === 'sam' && v.construit && (v.pv ?? 0) > 0);
        if (!samVivant) _perdreCapturedBase(base);
    });

    // Nettoyage explosions / épaves
    bases.forEach(base => {
        if (!base.vehicules) return;
        base.vehicules = base.vehicules.filter(v => !(v.explosion && now - v.explosion.start > EXPLOSION_DURATION));
        epaves = epaves.filter(e => now - e.start <= WRECK_DURATION);
    });

    // Sanitisation : répare cur_x/cur_y NaN
    bases.forEach(b => {
        if (!b.vehicules) return;
        b.vehicules.forEach(v => {
            if (!isFinite(v.cur_x) && isFinite(v.x)) v.cur_x = v.x;
            if (!isFinite(v.cur_y) && isFinite(v.y)) v.cur_y = v.y;
        });
    });

    // Broadcast temps-réel : envoyer la position de chaque véhicule en mouvement
    {
        const _t = Date.now();
        if (!animerVehicules._lastSync || _t - animerVehicules._lastSync > 150) {
            animerVehicules._lastSync = _t;
            const positions = [];
            bases.forEach(b => {
                if (!b.vehicules || b.joueur_id != joueur_id) return;
                b.vehicules.forEach(v => {
                    if (v.construit && v.cur_x != null && !v._reachedDest)
                        positions.push({ id: v.id, x: Math.round(v.cur_x), y: Math.round(v.cur_y) });
                });
            });
            if (positions.length > 0 && typeof socket !== 'undefined')
                socket.emit('pos_sync', positions);
        }
    }

    // ── Gestion des groupes du joueur (solo, pending, auto-merge) ──
    // Toutes les bases du joueur (principale + capturées)
    const mesBasesJ = bases.filter(b => b.joueur_id == joueur_id);
    const tousVehJ  = mesBasesJ.flatMap(b => b.vehicules ?? []);
    const baseDe    = v => mesBasesJ.find(b => b.vehicules?.includes(v)) ?? mesBasesJ[0];

    if (tousVehJ.length > 0) {
        tousVehJ.forEach(v => {
            // Groupe solo créé immédiatement à la construction, même en sortie de base
            if (v.construit && !v.groupe_id && !v._pendingGroupe && v.formation_slot == null && v.type !== 'sam') creerGroupeSolo(v);
        });

        tousVehJ.forEach(v => {
            if (!v.construit || !v._pendingGroupe || v.cur_x == null) return;
            const { groupeId, slot } = v._pendingGroupe;

            const membresGroupe = tousVehJ.filter(vv => vv.groupe_id === groupeId && vv.construit);
            if (membresGroupe.length === 0) { v._pendingGroupe = null; v.formation_slot = null; return; }
            if (membresGroupe.some(vv => typeVehicule(vv) !== typeVehicule(v))) {
                v._pendingGroupe = null; creerGroupeSolo(v); return;
            }

            const refG = membresGroupe.find(vv => (vv.formation_slot ?? Infinity) === 0) ?? membresGroupe[0];
            const refCx = refG.cur_x ?? refG.x, refCy = refG.cur_y ?? refG.y;
            if (!isFinite(refCx) || !isFinite(refCy)) return;
            const allPos = positionsFormation(GROUPE_MAX, refCx, refCy);

            const slotsOccupes = new Set(membresGroupe.map(vv => vv.formation_slot).filter(s => s != null));
            let slotCible = 0;
            while (slotsOccupes.has(slotCible) && slotCible < GROUPE_MAX) slotCible++;

            v.formation_slot = slotCible;
            const cible = allPos[slotCible];
            if (cible && isFinite(cible.x) && isFinite(cible.y)) {
                v.x = cible.x; v.y = cible.y;
            }

            const distSelf = Math.hypot(v.x - v.cur_x, v.y - v.cur_y);
            if (distSelf <= VEHICLE_RADIUS) {
                const autresPending = tousVehJ.filter(vv => vv !== v && vv._pendingGroupe?.groupeId === groupeId).length;
                if (membresGroupe.length + autresPending >= GROUPE_MAX) {
                    v._pendingGroupe = null; v.formation_slot = null; creerGroupeSolo(v); return;
                }
                v._pendingGroupe = null;
                v.groupe_id      = groupeId;
                v.formation_slot = slotCible;
                // Chaque véhicule garde ses propres PV en rejoignant un groupe
                if (v.pv == null) v.pv = vcfg(v).pv_max;
                if (cible && isFinite(cible.x) && isFinite(cible.y)) {
                    v.cur_x = cible.x; v.cur_y = cible.y;
                }
                if (isFinite(refG.x) && isFinite(refG.y)) {
                    const destSlot = positionsFormation(GROUPE_MAX, refG.x, refG.y)[slotCible];
                    if (destSlot && isFinite(destSlot.x) && isFinite(destSlot.y)) {
                        v.x = destSlot.x; v.y = destSlot.y;
                    }
                }
                if (typeof selectedVehicles !== 'undefined') {
                    const vBase = baseDe(v);
                    const estSelectionneSeul = selectedVehicles.some(s => s.vehicle === v);
                    const groupeSelectionne   = selectedVehicles.some(s => s.vehicle !== v && s.vehicle.groupe_id === groupeId);
                    if (estSelectionneSeul) {
                        selectedVehicles = tousVehJ
                            .filter(vv => vv.groupe_id === groupeId && vv.construit)
                            .sort((a, b) => (a.formation_slot ?? Infinity) - (b.formation_slot ?? Infinity))
                            .map(vv => ({ base: baseDe(vv), vehicle: vv }));
                    } else if (groupeSelectionne) {
                        selectedVehicles.push({ base: vBase, vehicle: v });
                    }
                }

                fetch(`/api/joueur/${joueur_id}/groupe`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ vehicule_ids: [...membresGroupe.map(vv => vv.id), v.id], groupe_id: groupeId })
                }).then(r => r?.json()).then(data => { if (data?.groupe_id) v.groupe_id = data.groupe_id; }).catch(() => null);

                // Nudge : si le groupe est trop proche d'un autre, le décaler pour laisser de la place
                const refJoint = refsGroupes[groupeId];
                if (refJoint && refJoint._reachedDest) {
                    const gCercle = tousLescercles[groupeId];
                    if (gCercle) {
                        let nx = 0, ny = 0;
                        Object.entries(tousLescercles).forEach(([gid2Str, c2]) => {
                            if (Number(gid2Str) === groupeId) return;
                            const d = Math.hypot(gCercle.cx - c2.cx, gCercle.cy - c2.cy);
                            const minSep = gCercle.rayon + c2.rayon + 4;
                            if (d < minSep && d > 0.01) {
                                const push = minSep - d;
                                nx += (gCercle.cx - c2.cx) / d * push;
                                ny += (gCercle.cy - c2.cy) / d * push;
                            }
                        });
                        const mag = Math.hypot(nx, ny);
                        if (mag > 10) {
                            const ux = nx / mag, uy = ny / mag;
                            const newX = gCercle.cx + ux * Math.min(mag, 160);
                            const newY = gCercle.cy + uy * Math.min(mag, 160);
                            refJoint._effectiveDest = null;
                            refJoint._reachedDest   = false;
                            refJoint._waypoints     = [];
                            refJoint._pfLastCalc    = 0;
                            tousVehJ
                                .filter(vv => vv.groupe_id === groupeId && vv.construit)
                                .forEach(vv => {
                                    const s   = vv.formation_slot ?? 0;
                                    const pos = positionsFormation(GROUPE_MAX, newX, newY)[s] ?? { x: newX, y: newY };
                                    deplacerVehicule(baseDe(vv), vv, pos.x, pos.y);
                                });
                        }
                    }
                }

            } else if (now - v._pendingGroupe.timestamp > 15000) {
                v._pendingGroupe = null;
                v.formation_slot = null;
            }
        });

    }
}

// ── Perte d'une base capturée : remet en neutre + envoie un TT ──
async function _perdreCapturedBase(base) {
    base._perteEnCours = true;

    // Mémoriser si c'est notre propre base avant la mise à jour
    const estLeProprietaire = base.joueur_id == joueur_id;

    // Mise à jour visuelle immédiate (optimiste)
    const ancienJoueurId  = base.joueur_id;
    const ancienPseudo    = base.pseudo;
    const ancienAvaitSams = base._avaitSams;
    base.joueur_id  = null;
    base.neutre     = true;
    base._capturee  = false;
    base.pseudo     = '';
    base._avaitSams = false;
    if (base.vehicules) base.vehicules = base.vehicules.filter(v => v.type !== 'sam');

    const res = await fetch(`/api/joueur/${joueur_id}/perdre-base/${base._neutreId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);

    if (!res) {
        // Erreur réseau : annuler le changement visuel
        base.joueur_id  = ancienJoueurId;
        base.neutre     = false;
        base._capturee  = true;
        base.pseudo     = ancienPseudo;
        base._avaitSams = ancienAvaitSams;
        base._perteEnCours = false;
        return;
    }
    // Si le serveur dit "déjà neutre" ou erreur 4xx, ne pas annuler (état déjà correct)
    const data = await res.json().catch(() => ({}));

    base._perteEnCours = false;

    if (estLeProprietaire && typeof afficherMessageErreur === 'function')
        afficherMessageErreur('Base perdue !');
}
