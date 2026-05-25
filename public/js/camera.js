// ── Caméra ───────────────────────────────────────────────────
function clampCamera() {
    camX = clamp(camX, 0, Math.max(0, MAP_W - canvas.width));
    camY = clamp(camY, 0, Math.max(0, MAP_H - canvas.height));
}

function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    clampCamera();
}
window.addEventListener('resize', resize);

// ── Clic GAUCHE : boîte de sélection ─────────────────────────
let selBox   = null;

canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    selBox = { x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY };
});

window.addEventListener('mousemove', e => {
    if (selBox) { selBox.x2 = e.clientX; selBox.y2 = e.clientY; }
});

window.addEventListener('mouseup', e => {
    if (e.button !== 0 || !selBox) return;
    const dist = Math.hypot(selBox.x2 - selBox.x1, selBox.y2 - selBox.y1);
    if (dist > 10) {
        selectionnerDansZone(selBox);  // glissé → sélection de zone
    } else {
        gererClicJeepSimple(e);        // clic simple → sélection directe
    }
    selBox = null;
});

// ── Clic DROIT : déplacer la caméra + ordonner mouvement ─────
let dragMoved = false;

canvas.addEventListener('mousedown', e => {
    if (e.button !== 2) return;
    drag = true; dragMoved = false;
    dragSX = e.clientX; dragSY = e.clientY;
    camSX  = camX;      camSY  = camY;
    document.body.classList.add('grabbing');
});

window.addEventListener('mousemove', e => {
    if (!drag) return;
    if (Math.hypot(e.clientX - dragSX, e.clientY - dragSY) > 5) dragMoved = true;
    camX = camSX - (e.clientX - dragSX);
    camY = camSY - (e.clientY - dragSY);
    clampCamera();
});

window.addEventListener('mouseup', e => {
    if (e.button !== 2) return;
    const wasDragging = dragMoved;
    drag = false; dragMoved = false;
    document.body.classList.remove('grabbing');
    if (!wasDragging) {
        const hit = findVehicleUnderCursor(e.clientX, e.clientY);

        // Clic droit sur une base neutre/ennemie → tenter capture avec TT
        if (selectedVehicles.length > 0 && selectedVehicles.every(s => s.vehicle.type === 'tt')) {
            // Détecter le clic sur le sprite de la niche (position écran exacte)
            const nw = (typeof imgNiche !== 'undefined' && imgNiche.naturalWidth) ? imgNiche.naturalWidth  * 0.15 : 60;
            const nh = (typeof imgNiche !== 'undefined' && imgNiche.naturalHeight) ? imgNiche.naturalHeight * 0.15 : 60;
            const baseCiblee = bases.find(b => {
                if (b.joueur_id == joueur_id) return false;
                const { mx, my } = posToMapPx(b.pos_x, b.pos_y);
                const bsx = mx - camX, bsy = my - camY;
                // La niche est dessinée à (bsx - 400, bsy + 115) dans renderer.js
                const nicheSX = bsx - 400, nicheSY = bsy + 115;
                return Math.abs(e.clientX - nicheSX) < nw / 2 + 10
                    && Math.abs(e.clientY - nicheSY) < nh / 2 + 10;
            });
            if (baseCiblee) {
                const samVivant = baseCiblee.vehicules?.some(v =>
                    v.type === 'sam' && v.construit && v.pv > 0
                );
                if (samVivant) {
                    afficherMessageErreur('Détruisez les SAMs pour capturer cette base !');
                } else {
                    // Envoyer tous les TTs sélectionnés vers la niche
                    const stagingX = baseCiblee.pos_x - 350;
                    const stagingY = baseCiblee.pos_y + 100;
                    const maBase = bases.find(b => b.joueur_id == joueur_id);
                    selectedVehicles.forEach(({ base, vehicle }) => {
                        vehicle._baseCaptureCible = baseCiblee;
                        vehicle._captureStage     = 1;
                        // Forcer arrêt immédiat pour que planifierCheminGroupe s'applique directement
                        if (vehicle.groupe_id && typeof _refsGroupes !== 'undefined') {
                            const r = _refsGroupes[vehicle.groupe_id];
                            if (r) { r._reachedDest = true; r._pendingOrder = null; r._currentSpd = 0; }
                        }
                        deplacerVehicule(base ?? maBase, vehicle, stagingX, stagingY);
                        if (vehicle.groupe_id && typeof planifierCheminGroupe !== 'undefined')
                            planifierCheminGroupe(vehicle.groupe_id, stagingX, stagingY);
                    });
                    clickFlashs.push({ sx: e.clientX, sy: e.clientY, start: Date.now(), couleur: '#ffcc00' });
                }
                return;
            }
        }

        // Clic droit sur un ennemi avec une sélection → forcer l'attaque
        if (hit && hit.base.joueur_id != joueur_id && selectedVehicles.length > 0) {
            const cibleGroupe = hit.vehicle.groupe_id;
            selectedVehicles.forEach(({ vehicle }) => {
                vehicle._forceTarget      = hit.vehicle;
                vehicle._forceTargetGroupe = cibleGroupe ?? null;
                vehicle._forceTargetUntil = Date.now() + 30000; // 30s max
            });
            // Flash rouge à la position du clic
            const pos = getVehicleScreenPos(hit.vehicle);
            if (pos) clickFlashs.push({ sx: pos.sx, sy: pos.sy, start: Date.now(), couleur: '#ff2200' });
            return;
        }

        if (hit && hit.base.joueur_id == joueur_id && selectedVehicles.length > 0) {
            if (!selectedVehicles.some(s => s.vehicle === hit.vehicle)) {
                // Flash bleu : action de regroupement
                const posHit = getVehicleScreenPos(hit.vehicle);
                if (posHit) clickFlashs.push({ sx: posHit.sx, sy: posHit.sy, start: Date.now(), couleur: '#44aaff' });

                const maBase = bases.find(b => b.joueur_id == joueur_id);

                // Détecter si toute la sélection est un seul et même groupe
                const tousMembresMemeGroupe = selectedVehicles.length > 1 &&
                    selectedVehicles[0].vehicle.groupe_id != null &&
                    selectedVehicles.every(s => s.vehicle.groupe_id === selectedVehicles[0].vehicle.groupe_id);

                if (tousMembresMemeGroupe) {
                    // ── Groupe sélectionné → seul le dernier véhicule (slot max) rejoint la cible ──
                    // Centre = formation_slot = 0 (premier véhicule sur lequel le groupe a été formé)
                    const centreEntry = selectedVehicles.reduce((min, s) => {
                        const sSlot = s.vehicle.formation_slot ?? Infinity;
                        const mSlot = min.vehicle.formation_slot ?? Infinity;
                        return sSlot < mSlot ? s : min;
                    }, selectedVehicles[0]);
                    const cx = centreEntry.vehicle.cur_x ?? centreEntry.vehicle.x;
                    const cy = centreEntry.vehicle.cur_y ?? centreEntry.vehicle.y;
                    // Dernier = véhicule le plus éloigné du centre (= le plus périphérique)
                    const dernier = selectedVehicles.reduce((max, s) => {
                        const dMax = Math.hypot((max.vehicle.cur_x ?? max.vehicle.x) - cx, (max.vehicle.cur_y ?? max.vehicle.y) - cy);
                        const dCur = Math.hypot((s.vehicle.cur_x ?? s.vehicle.x) - cx, (s.vehicle.cur_y ?? s.vehicle.y) - cy);
                        return dCur > dMax ? s : max;
                    }, selectedVehicles[0]);

                    // Vérifier AVANT toute modification d'état : limite et compatibilité de type
                    if (hit.vehicle.groupe_id) {
                        const membresTarget = (maBase?.vehicules || [])
                            .filter(v => v.groupe_id === hit.vehicle.groupe_id && v.construit);
                        const pendingTarget = (maBase?.vehicules || [])
                            .filter(v => v._pendingGroupe?.groupeId === hit.vehicle.groupe_id).length;
                        if (membresTarget.length + pendingTarget >= GROUPE_MAX) {
                            afficherMessageErreur(`Groupe complet ! Maximum ${GROUPE_MAX} véhicules.`);
                            return;
                        }
                        if (typeVehicule(dernier.vehicle) !== typeVehicule(hit.vehicle)) {
                            afficherMessageErreur(`Type incompatible ! Ce groupe n'accepte que des ${typeVehicule(hit.vehicle)}s.`);
                            return;
                        }
                    } else {
                        if (typeVehicule(dernier.vehicle) !== typeVehicule(hit.vehicle)) {
                            afficherMessageErreur(`Type incompatible ! Impossible de grouper des véhicules différents.`);
                            return;
                        }
                    }

                    // Bloquer creerGroupeSolo pendant le transit async (race condition)
                    if (hit.vehicle.groupe_id) {
                        dernier.vehicle._pendingGroupe = { groupeId: hit.vehicle.groupe_id, slot: -1, timestamp: Date.now() };
                    }
                    // Retirer le dernier du groupe en mémoire
                    const ancienGroupeId = dernier.vehicle.groupe_id;
                    dernier.vehicle.groupe_id = null;
                    dernier.vehicle.formation_slot = null;
                    selectedVehicles = selectedVehicles.filter(s => s.vehicle !== dernier.vehicle);
                    canvas.style.cursor = selectedVehicles.length > 0 ? 'crosshair' : '';
                    // Bloquer l'auto-merge pour les véhicules intentionnellement laissés seuls
                    if (ancienGroupeId) {
                        (maBase?.vehicules || [])
                            .filter(vv => vv.groupe_id === ancienGroupeId && vv.construit)
                            .forEach(vv => { vv._blockAutoMerge = true; });
                    }

                    // Quitter le groupe en DB, puis se déplacer vers la cible
                    fetch(`/api/joueur/${joueur_id}/vehicule/${dernier.vehicle.id}/quitter-groupe`, {
                        method: 'PATCH',
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).then(() => {
                        if (hit.vehicle.groupe_id) {
                            // Rejoindre le groupe existant : se déplacer vers le slot, rejoindre à l'arrivée
                            const groupeId = hit.vehicle.groupe_id;
                            const membres = (maBase?.vehicules || [])
                                .filter(v => v.groupe_id === groupeId && v.construit)
                                .sort((a, b) => (a.formation_slot ?? 0) - (b.formation_slot ?? 0));
                            const pendingMax = (maBase?.vehicules || [])
                                .filter(v => v._pendingGroupe?.groupeId === groupeId)
                                .reduce((m, v) => Math.max(m, v._pendingGroupe.slot), -1);
                            const slotMax = Math.max(
                                membres.reduce((m, v) => Math.max(m, v.formation_slot ?? -1), -1),
                                pendingMax
                            );
                            const centreV = membres[0];
                            const cx = centreV ? (centreV.cur_x ?? centreV.x) : hit.vehicle.cur_x ?? hit.vehicle.x;
                            const cy = centreV ? (centreV.cur_y ?? centreV.y) : hit.vehicle.cur_y ?? hit.vehicle.y;
                            const slot = slotMax + 1;
                            const positions = positionsFormation(slot + 1, cx, cy);
                            deplacerVehicule(dernier.base, dernier.vehicle, positions[slot].x, positions[slot].y);
                            dernier.vehicle._pendingGroupe = { groupeId, slot, timestamp: Date.now() };
                        } else {
                            // Cible solo → nouveau groupe : hit = centre (slot 0), dernier rejoint en _pendingGroupe
                            const cx = hit.vehicle.cur_x ?? hit.vehicle.x;
                            const cy = hit.vehicle.cur_y ?? hit.vehicle.y;
                            const positions = positionsFormation(2, cx, cy);
                            deplacerVehicule(dernier.base, dernier.vehicle, positions[1].x, positions[1].y);
                            hit.vehicle.formation_slot = 0;
                            dernier.vehicle.formation_slot = 1;
                            fetch(`/api/joueur/${joueur_id}/groupe`, {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ vehicule_ids: [hit.vehicle.id] })
                            }).then(r => r.json()).then(data => {
                                if (data.groupe_id) {
                                    hit.vehicle.groupe_id = data.groupe_id;
                                    dernier.vehicle._pendingGroupe = { groupeId: data.groupe_id, slot: 1, timestamp: Date.now() };
                                }
                            }).catch(() => null);
                        }
                    }).catch(() => null);

                } else if (hit.vehicle.groupe_id) {
                    // ── Sélection simple → rejoindre le groupe existant de la cible ──
                    const groupeId = hit.vehicle.groupe_id;
                    const aAjouter = selectedVehicles.filter(s =>
                        s.vehicle.groupe_id !== groupeId && typeVehicule(s.vehicle) === typeVehicule(hit.vehicle)
                    );
                    if (aAjouter.length === 0) {
                        afficherMessageErreur(`Type incompatible ! Ce groupe n'accepte que des ${typeVehicule(hit.vehicle)}s.`);
                        return;
                    }

                    const membres = (maBase?.vehicules || [])
                        .filter(v => v.groupe_id === groupeId && v.construit)
                        .sort((a, b) => (a.formation_slot ?? 0) - (b.formation_slot ?? 0));
                    const pendingCount = (maBase?.vehicules || [])
                        .filter(v => v._pendingGroupe?.groupeId === groupeId).length;
                    if (membres.length + pendingCount + aAjouter.length > GROUPE_MAX) {
                        afficherMessageErreur(`Groupe complet ! Maximum ${GROUPE_MAX} véhicules.`);
                        return;
                    }
                    const pendingMax = (maBase?.vehicules || [])
                        .filter(v => v._pendingGroupe?.groupeId === groupeId)
                        .reduce((m, v) => Math.max(m, v._pendingGroupe.slot), -1);
                    const slotMax = Math.max(
                        membres.reduce((m, v) => Math.max(m, v.formation_slot ?? -1), -1),
                        pendingMax
                    );
                    const centreV = membres[0];
                    const cx = centreV ? (centreV.cur_x ?? centreV.x) : hit.vehicle.cur_x ?? hit.vehicle.x;
                    const cy = centreV ? (centreV.cur_y ?? centreV.y) : hit.vehicle.cur_y ?? hit.vehicle.y;

                    aAjouter.forEach((s, i) => {
                        const oldGroupe = s.vehicle.groupe_id;
                        s.vehicle.groupe_id = null;
                        s.vehicle.formation_slot = null;
                        const slot = slotMax + 1 + i;
                        const positions = positionsFormation(slot + 1, cx, cy);
                        deplacerVehicule(s.base, s.vehicle, positions[slot].x, positions[slot].y);
                        s.vehicle._pendingGroupe = { groupeId, slot, timestamp: Date.now() };
                        if (oldGroupe) {
                            fetch(`/api/joueur/${joueur_id}/vehicule/${s.vehicle.id}/quitter-groupe`, {
                                method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }
                            }).catch(() => null);
                        }
                    });

                    const membresSelection = membres.map(v => ({ base: maBase, vehicle: v }));
                    selectedVehicles = [...membresSelection, ...aAjouter];
                    canvas.style.cursor = 'crosshair';

                } else {
                    // ── Formation d'un nouveau groupe ──
                    if (selectedVehicles.length >= GROUPE_MAX) {
                        afficherMessageErreur(`Groupe complet ! Maximum ${GROUPE_MAX} véhicules.`);
                        return;
                    }
                    if (selectedVehicles.some(s => typeVehicule(s.vehicle) !== typeVehicule(hit.vehicle))) {
                        afficherMessageErreur(`Type incompatible ! Impossible de grouper des véhicules différents.`);
                        return;
                    }
                    // hit = centre (slot 0), les véhicules déjà sélectionnés prennent les slots suivants
                    const cx = hit.vehicle.cur_x ?? hit.vehicle.x;
                    const cy = hit.vehicle.cur_y ?? hit.vehicle.y;
                    const positions = positionsFormation(selectedVehicles.length + 1, cx, cy);

                    selectedVehicles.forEach((s, i) => {
                        s.vehicle.formation_slot = i + 1;
                        deplacerVehicule(s.base, s.vehicle, positions[i + 1].x, positions[i + 1].y);
                    });
                    hit.vehicle.formation_slot = 0;

                    selectedVehicles.push(hit);
                    canvas.style.cursor = 'crosshair';

                    // Créer le groupe avec hit uniquement — les autres rejoignent en _pendingGroupe à l'arrivée
                    fetch(`/api/joueur/${joueur_id}/groupe`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ vehicule_ids: [hit.vehicle.id] })
                    }).then(r => r.json()).then(data => {
                        if (data.groupe_id) {
                            hit.vehicle.groupe_id = data.groupe_id;
                            selectedVehicles.slice(0, -1).forEach((s, i) => {
                                s.vehicle._pendingGroupe = { groupeId: data.groupe_id, slot: i + 1, timestamp: Date.now() };
                            });
                        }
                    }).catch(() => null);
                }
            }
        } else if (selectedVehicles.length > 0) {
            const mapX = (e.clientX + camX) * 5000 / MAP_W;
            const mapY = (e.clientY + camY) * 5000 / MAP_H;
            // Annuler tout join en attente pour les véhicules déplacés manuellement
            selectedVehicles.forEach(({ vehicle }) => {
                vehicle._pendingGroupe   = null;
                vehicle._blockAutoMerge  = false;
                // Si le véhicule était en transit (pas de groupe), libérer formation_slot
                // pour que creerGroupeSolo puisse s'exécuter
                if (!vehicle.groupe_id) vehicle.formation_slot = null;
            });
            const memeGroupe = selectedVehicles.length > 1 &&
                selectedVehicles[0].vehicle.groupe_id != null &&
                selectedVehicles.every(s => s.vehicle.groupe_id === selectedVehicles[0].vehicle.groupe_id);
            // Flash gris : destination de mouvement
            clickFlashs.push({ sx: e.clientX, sy: e.clientY, start: Date.now(), couleur: '#aaaaaa', type: 'move', duree: 1000 });

            if (memeGroupe) {
                const tries = [...selectedVehicles].sort((a, b) =>
                    (a.vehicle.formation_slot ?? Infinity) - (b.vehicle.formation_slot ?? Infinity));
                normaliserParPosition(tries);
                const maxSlot = tries.reduce((m, s) => Math.max(m, s.vehicle.formation_slot ?? 0), 0);
                const positions = positionsFormation(Math.max(tries.length, maxSlot + 1), mapX, mapY);
                const leaderPos = positions[0] ?? { x: mapX, y: mapY };
                tries.forEach(({ base, vehicle }) => {
                    const slot = vehicle.formation_slot ?? 0;
                    const pos = positions[Math.min(slot, positions.length - 1)];
                    deplacerVehicule(base, vehicle, pos.x, pos.y);
                });
                const gidSel = tries[0]?.vehicle.groupe_id;
                if (gidSel != null && typeof planifierCheminGroupe !== 'undefined')
                    planifierCheminGroupe(gidSel, leaderPos.x, leaderPos.y);
            } else {
                const nbGroupes = new Set(selectedVehicles.map(s => s.vehicle.groupe_id).filter(Boolean)).size;
                if (nbGroupes > 1) {
                    deplacerVersPoint(selectedVehicles, mapX, mapY);
                } else {
                    deplacerGroupesVers(selectedVehicles, mapX, mapY);
                }
            }
        }
    }
});

// Bloquer le menu contextuel du navigateur
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ── Tooltip + survol niche ───────────────────────────────────
canvas.addEventListener('mousemove', e => {
    if (drag) return;

    // Curseur sur le véhicule du joueur
    const maBase = bases.find(b => b.joueur_id == joueur_id);
    if (maBase && selectedVehicles.length === 0) {
        if (!maBase.vehicules) ensureBaseVehicles(maBase);
        const { frameWidth } = getVehicleSpriteSize();
        const surVehicule = maBase.vehicules.some(v => {
            const jp = getVehicleScreenPos(v);
            return jp && Math.hypot(e.clientX - jp.sx, e.clientY - jp.sy) < frameWidth / 2 + 15;
        });
        canvas.style.cursor = surVehicule ? 'pointer' : '';
    }

    // ── Détection niche unifiée (principale + capturées) ─────────
    // Vérifier la niche de la base principale
    const r = getNicheRect();
    const surNichePrincipale = r &&
        e.clientX >= r.x && e.clientX <= r.x + r.w &&
        e.clientY >= r.y && e.clientY <= r.y + r.h;

    // Vérifier les niches des bases capturées
    let baseSurvol = null;
    if (!surNichePrincipale && imgNiche.complete && imgNiche.naturalWidth) {
        const nw = imgNiche.naturalWidth  * NICHE_SCALE;
        const nh = imgNiche.naturalHeight * NICHE_SCALE;
        baseSurvol = bases.find(b => {
            if (b._neutreId == null || b.joueur_id != joueur_id) return false;
            const { mx, my } = posToMapPx(b.pos_x, b.pos_y);
            const sx = mx - camX, sy = my - camY;
            const cx = sx + NICHE_OFFSET_X, cy = sy + NICHE_OFFSET_Y;
            return Math.hypot(e.clientX - cx, e.clientY - cy) < nw;
        });
    }

    if (surNichePrincipale) {
        afficherNiche();
    } else if (baseSurvol) {
        afficherNiche(baseSurvol);
    } else {
        // La souris n'est sur aucune niche → laisser le panneau gérer sa propre fermeture
        // masquerNiche() est déjà appelé par le onmouseleave du panneau
        // On appelle ici uniquement si le panneau n'est pas survolé
        const panneauNiche = document.getElementById('panneau-niche');
        if (!panneauNiche?.matches(':hover')) {
            masquerNiche();
        }
    }
});

// ── Clic minimap ─────────────────────────────────────────────
miniCanvas.addEventListener('click', e => {
    const rect = miniCanvas.getBoundingClientRect();
    camX = (e.clientX - rect.left) / MW * MAP_W - canvas.width  / 2;
    camY = (e.clientY - rect.top)  / MH * MAP_H - canvas.height / 2;
    clampCamera();
});
