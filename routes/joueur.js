// ============================================================
//  ROUTES/JOUEUR.JS — Données du joueur
// ============================================================

const express = require('express');
const db      = require('../db');
const router  = express.Router();
const { ACIER, CHARBON, CARBURANT, VEHICULES, calculerRessource } = require('../constantes');
const { verifierToken, requireAuth } = require('../middleware/auth');
const { rateLimiterParJoueur } = require('../middleware/rateLimiter');

const limiteAttaque   = rateLimiterParJoueur(10, 1000, 'attaque');   // max 10 destructions/s par joueur
const limiteDegatsNeutre = rateLimiterParJoueur(20, 1000, 'degats'); // max 20 hits/s par joueur

const MAP_MAX = 5000;
function validerCoordonnees(x, y) {
    const nx = Number(x), ny = Number(y);
    return !isNaN(nx) && !isNaN(ny) && nx >= 0 && nx <= MAP_MAX && ny >= 0 && ny <= MAP_MAX;
}

// ── Toutes les bases sur la map (avec véhicules) ──────────────
router.get('/bases', requireAuth, (req, res) => {
    db.query(
        `SELECT j.id as joueur_id, j.pseudo, m.pos_x, m.pos_y, m.murs_beton,
                m.beton_niveau, m.acier_niveau, m.charbon_niveau, m.carburant_niveau,
                v.id as vehicule_id, v.type as vehicule_type, v.x as vehicule_x, v.y as vehicule_y,
                v.groupe_id as vehicule_groupe_id,
                v.formation_slot as vehicule_formation_slot,
                v.construction_fin as vehicule_construction_fin,
                v.base_neutre_id as vehicule_base_neutre_id
         FROM joueurs j
         JOIN joueurs_map m ON m.joueur_id = j.id
         LEFT JOIN vehicules v ON v.joueur_id = j.id AND (v.mort = 0 OR v.mort IS NULL)`,
        (err, results) => {
            if (err) return res.status(500).json({ erreur: 'Erreur serveur' });

            const basesMap = {};
            // Véhicules appartenant à une base capturée (base_neutre_id != null)
            const vehiculesCaptured = {}; // { base_neutre_id: [vehicule, ...] }

            results.forEach(row => {
                const jid = Number(row.joueur_id);
                if (!basesMap[jid]) {
                    basesMap[jid] = {
                        joueur_id: jid,
                        pseudo: row.pseudo,
                        pos_x: row.pos_x,
                        pos_y: row.pos_y,
                        murs_beton: row.murs_beton,
                        beton_niveau:     row.beton_niveau     ?? 0,
                        acier_niveau:     row.acier_niveau     ?? 0,
                        charbon_niveau:   row.charbon_niveau   ?? 0,
                        carburant_niveau: row.carburant_niveau ?? 0,
                        vehicules: []
                    };
                }
                if (row.vehicule_id != null) {
                    const veh = {
                        id: Number(row.vehicule_id),
                        type: row.vehicule_type,
                        x: row.vehicule_x,
                        y: row.vehicule_y,
                        groupe_id: row.vehicule_groupe_id ? Number(row.vehicule_groupe_id) : null,
                        formation_slot: row.vehicule_formation_slot != null ? Number(row.vehicule_formation_slot) : null,
                        construction_fin: row.vehicule_construction_fin ? Number(row.vehicule_construction_fin) : null
                    };
                    if (row.vehicule_base_neutre_id != null) {
                        const bid = Number(row.vehicule_base_neutre_id);
                        // Indexer par (base_id, joueur_id) pour éviter les conflits
                        // quand plusieurs joueurs ont des véhicules avec le même base_neutre_id
                        if (!vehiculesCaptured[bid]) vehiculesCaptured[bid] = {};
                        if (!vehiculesCaptured[bid][jid]) vehiculesCaptured[bid][jid] = [];
                        vehiculesCaptured[bid][jid].push(veh);
                    } else {
                        basesMap[jid].vehicules.push(veh);
                    }
                }
            });

            // Ajouter les bases neutres
            db.query(
                `SELECT bn.id, bn.pos_x, bn.pos_y, bn.pseudo, bn.joueur_id as bn_joueur_id,
                        bn.murs_beton,
                        vn.id as vn_id, vn.type as vn_type, vn.x as vn_x, vn.y as vn_y,
                        vn.formation_slot as vn_slot, vn.pv as vn_pv
                 FROM bases_neutres bn
                 LEFT JOIN vehicules_neutres vn ON vn.base_id = bn.id`,
                (err2, neutres) => {
                    if (!err2 && neutres) {
                        const neutreMap = {};
                        neutres.forEach(row => {
                            const key = `neutre_${row.id}`;
                            if (!neutreMap[key]) {
                                neutreMap[key] = {
                                    joueur_id: row.bn_joueur_id ? Number(row.bn_joueur_id) : `neutre_${row.id}`,
                                    _neutreId: row.id,
                                    _capturee: !!row.bn_joueur_id,
                                    pseudo: row.pseudo,
                                    pos_x: row.pos_x,
                                    pos_y: row.pos_y,
                                    murs_beton: row.murs_beton ?? 0,
                                    beton_niveau: 0, acier_niveau: 0,
                                    charbon_niveau: 0, carburant_niveau: 0,
                                    neutre: !row.bn_joueur_id,
                                    vehicules: []
                                };
                            }
                            if (row.vn_id != null) {
                                neutreMap[key].vehicules.push({
                                    // 'c' = SAM de base capturée, 'n' = SAM de base neutre
                                    id: row.bn_joueur_id ? `c${row.vn_id}` : `n${row.vn_id}`,
                                    type: row.vn_type,
                                    x: row.vn_x, y: row.vn_y,
                                    cur_x: row.vn_x, cur_y: row.vn_y,
                                    groupe_id: null,
                                    formation_slot: row.vn_slot,
                                    construction_fin: null,
                                    pv: row.vn_pv,
                                    construit: 1
                                });
                            }
                        });
                        // Injecter les véhicules construits sur les bases capturées
                        // Structure : vehiculesCaptured[bid][joueurId] = [vehs]
                        Object.entries(vehiculesCaptured).forEach(([bid, parJoueur]) => {
                            const key  = `neutre_${bid}`;
                            const base = neutreMap[key];
                            Object.entries(parJoueur).forEach(([jidStr, vehs]) => {
                                const joueurId = Number(jidStr);
                                // Base appartient encore à ce joueur → dans la base capturée
                                if (base && Number(base.joueur_id) === joueurId) {
                                    base.vehicules.push(...vehs);
                                } else if (basesMap[joueurId]) {
                                    // Base perdue/changée → retour à la base principale
                                    basesMap[joueurId].vehicules.push(...vehs);
                                }
                            });
                        });
                        res.json([...Object.values(basesMap), ...Object.values(neutreMap)]);
                    } else {
                        res.json(Object.values(basesMap));
                    }
                }
            );
        }
    );
});

// ── Mise à jour murs base capturée ───────────────────────────
router.patch('/:id/base-capturee/:base_id/murs', requireAuth, (req, res) => {
    const joueurId = Number(req.params.id);
    const baseId   = Number(req.params.base_id);
    const { murs_beton } = req.body;

    if (!murs_beton) {
        db.query('UPDATE bases_neutres SET murs_beton = 0 WHERE id = ? AND joueur_id = ?',
            [baseId, joueurId], (err) => {
                if (err) return res.status(500).json({ erreur: 'Erreur serveur' });
                res.json({ ok: true });
            }
        );
        return;
    }

    db.query('SELECT titanium FROM joueurs_map WHERE joueur_id = ?', [joueurId], (err, rows) => {
        if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
        if ((rows[0].titanium ?? 0) < 100)
            return res.status(400).json({ erreur: 'Titanium insuffisant' });
        db.query('UPDATE joueurs_map SET titanium = titanium - 100 WHERE joueur_id = ?', [joueurId], (err2) => {
            if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
            db.query('UPDATE bases_neutres SET murs_beton = 1 WHERE id = ? AND joueur_id = ?',
                [baseId, joueurId], (err3) => {
                    if (err3) return res.status(500).json({ erreur: 'Erreur serveur' });
                    res.json({ ok: true });
                }
            );
        });
    });
});

// ── Mise à jour état murs ─────────────────────────────────────
router.patch('/:id/murs', (req, res) => {
    if (!verifierToken(req, res)) return;
    const { murs_beton } = req.body;

    if (!murs_beton) {
        db.query('UPDATE joueurs_map SET murs_beton = 0 WHERE joueur_id = ?', [req.params.id], (err) => {
            if (err) return res.status(500).json({ erreur: 'Erreur serveur' });
            res.json({ ok: true });
        });
        return;
    }

    db.query('SELECT titanium FROM joueurs_map WHERE joueur_id = ?', [req.params.id], (err, rows) => {
        if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
        if ((rows[0].titanium ?? 0) < 100)
            return res.status(400).json({ erreur: 'Titanium insuffisant' });
        db.query(
            'UPDATE joueurs_map SET murs_beton = 1, titanium = titanium - 100 WHERE joueur_id = ?',
            [req.params.id],
            (err2) => {
                if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                res.json({ ok: true });
            }
        );
    });
});

// ── Construire un véhicule (helper partagé) ───────────────────
function construireVehicule(type, req, res) {
    const cout = VEHICULES[type];
    // Une seule construction à la fois (tous types confondus)
    db.query(
        'SELECT COUNT(*) as cnt FROM vehicules WHERE joueur_id = ? AND base_neutre_id IS NULL AND construction_fin > ?',
        [req.params.id, Date.now()],
        (errC, cntRows) => {
            if (!errC && cntRows[0]?.cnt > 0)
                return res.status(400).json({ erreur: 'already_building' });
            _construireVehiculeInterne(type, req, res, cout);
        }
    );
}
function _construireVehiculeInterne(type, req, res, cout) {
    db.query(
        `SELECT pos_x, pos_y,
                acier, acier_niveau, acier_dernier_update,
                charbon, charbon_niveau, charbon_dernier_update
         FROM joueurs_map WHERE joueur_id = ?`,
        [req.params.id],
        (err, rows) => {
            if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
            const r = rows[0];

            const acierActuel   = calculerRessource(r.acier,   r.acier_niveau,   r.acier_dernier_update,   ACIER);
            const charbonActuel = calculerRessource(r.charbon, r.charbon_niveau, r.charbon_dernier_update, CHARBON);

            if (acierActuel < cout.cout_acier)
                return res.status(400).json({ erreur: `Acier insuffisant (${acierActuel}/${cout.cout_acier})` });
            if (charbonActuel < cout.cout_charbon)
                return res.status(400).json({ erreur: `Charbon insuffisant (${charbonActuel}/${cout.cout_charbon})` });

            const now              = Date.now();
            const construction_fin = now + cout.temps_construction;

            const inserer = (pos_x, pos_y) => {
                db.query(
                    `UPDATE joueurs_map
                     SET acier = ?, acier_dernier_update = ?,
                         charbon = ?, charbon_dernier_update = ?
                     WHERE joueur_id = ?`,
                    [acierActuel - cout.cout_acier, now, charbonActuel - cout.cout_charbon, now, req.params.id],
                    (err2) => {
                        if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                        db.query(
                            'INSERT INTO vehicules (joueur_id, type, x, y, construction_fin) VALUES (?, ?, ?, ?, ?)',
                            [req.params.id, type, pos_x, pos_y, construction_fin],
                            (err3, result) => {
                                if (err3) return res.status(500).json({ erreur: 'Erreur serveur' });
                                const vid = Number(result.insertId);
                                req.app.get('io').emit('vehicle_built', { joueur_id: Number(req.params.id), id: vid, type, x: pos_x, y: pos_y, construction_fin });
                                res.json({ id: vid, jeep_x: pos_x, jeep_y: pos_y, construction_fin });
                            }
                        );
                    }
                );
            };

            if (type === 'sam') {
                // Trouver le premier slot libre parmi les SAMs vivants
                db.query(
                    'SELECT formation_slot FROM vehicules WHERE joueur_id = ? AND type = "sam" AND (mort = 0 OR mort IS NULL)',
                    [req.params.id],
                    (errC, slotRows) => {
                        const occupes = new Set(errC ? [] : slotRows.map(s => s.formation_slot).filter(s => s != null));
                        let n = 0;
                        while (occupes.has(n)) n++;
                        const pos_x = r.pos_x - 180 + n * 15;
                        const pos_y = r.pos_y + 100 + n * 2;
                        // Insert avec formation_slot pour mémoriser le slot
                        db.query(
                            `UPDATE joueurs_map SET acier = ?, acier_dernier_update = ?, charbon = ?, charbon_dernier_update = ? WHERE joueur_id = ?`,
                            [acierActuel - cout.cout_acier, now, charbonActuel - cout.cout_charbon, now, req.params.id],
                            (err2) => {
                                if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                                db.query(
                                    'INSERT INTO vehicules (joueur_id, type, x, y, construction_fin, formation_slot) VALUES (?, ?, ?, ?, ?, ?)',
                                    [req.params.id, type, pos_x, pos_y, construction_fin, n],
                                    (err3, result) => {
                                        if (err3) return res.status(500).json({ erreur: 'Erreur serveur' });
                                        const vid = Number(result.insertId);
                                        req.app.get('io').emit('vehicle_built', { joueur_id: Number(req.params.id), id: vid, type, x: pos_x, y: pos_y, construction_fin });
                                        res.json({ id: vid, jeep_x: pos_x, jeep_y: pos_y, construction_fin });
                                    }
                                );
                            }
                        );
                    }
                );
            } else {
                inserer(r.pos_x - 250, r.pos_y + 71.875);
            }
        }
    );
}


router.patch('/:id/jeep/construire',   (req, res) => { if (!verifierToken(req, res)) return; construireVehicule('jeep',   req, res); });
router.patch('/:id/humvet/construire', (req, res) => { if (!verifierToken(req, res)) return; construireVehicule('humvet', req, res); });
router.patch('/:id/sam/construire',    (req, res) => { if (!verifierToken(req, res)) return; construireVehicule('sam',    req, res); });
router.patch('/:id/tt/construire',     (req, res) => { if (!verifierToken(req, res)) return; construireVehicule('tt',     req, res); });

// ── File d'attente de construction ───────────────────────────

function parseQueue(raw) {
    try { return JSON.parse(raw || '[]'); } catch { return []; }
}

// GET — lire la file
router.get('/:id/construction/queue', requireAuth, (req, res) => {
    db.query('SELECT construction_queue FROM joueurs_map WHERE joueur_id = ?',
        [req.params.id], (err, rows) => {
            if (err || !rows.length) return res.json({ queue: [], count: 0 });
            const queue = parseQueue(rows[0].construction_queue);
            res.json({ queue, count: queue.length });
        }
    );
});

// POST — ajouter N fois un type à la file (vérifie carburant tous les 10)
router.post('/:id/construction/queue', requireAuth, (req, res) => {
    const { type, count = 1 } = req.body;
    const n = Math.max(1, Math.min(50, Number(count) || 1));
    if (!['jeep', 'humvet', 'sam'].includes(type))
        return res.status(400).json({ erreur: 'Type invalide' });

    db.query(
        `SELECT construction_queue,
                carburant, carburant_niveau, carburant_dernier_update
         FROM joueurs_map WHERE joueur_id = ?`,
        [req.params.id], (err, rows) => {
            if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
            const r = rows[0];
            const queue = parseQueue(r.construction_queue);

            if (queue.length + n > 50)
                return res.status(400).json({ erreur: `File pleine — max 50 (${50 - queue.length} places restantes)` });

            // Coût carburant : 1000 pour chaque tranche de 10 franchie
            const oldCount = queue.length;
            const newCount = oldCount + n;
            const fuelCost = (Math.floor(newCount / 10) - Math.floor(oldCount / 10)) * 1000;
            const carburantAct = calculerRessource(
                r.carburant, r.carburant_niveau, r.carburant_dernier_update, CARBURANT);

            if (fuelCost > 0 && carburantAct < fuelCost)
                return res.status(400).json({ erreur: `Carburant insuffisant — il faut ${fuelCost} carburant pour cette file` });

            for (let i = 0; i < n; i++) queue.push(type);
            const now = Date.now();
            const queueJson = JSON.stringify(queue);

            if (fuelCost > 0) {
                db.query(
                    'UPDATE joueurs_map SET construction_queue = ?, carburant = ?, carburant_dernier_update = ? WHERE joueur_id = ?',
                    [queueJson, carburantAct - fuelCost, now, req.params.id], (err2) => {
                        if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                        res.json({ queue, count: queue.length, fuel_paid: fuelCost });
                    }
                );
            } else {
                db.query(
                    'UPDATE joueurs_map SET construction_queue = ? WHERE joueur_id = ?',
                    [queueJson, req.params.id], (err2) => {
                        if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                        res.json({ queue, count: queue.length, fuel_paid: 0 });
                    }
                );
            }
        }
    );
});

// DELETE /first — consommer le premier élément de la file
router.delete('/:id/construction/queue/first', requireAuth, (req, res) => {
    db.query('SELECT construction_queue FROM joueurs_map WHERE joueur_id = ?',
        [req.params.id], (err, rows) => {
            if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
            const queue = parseQueue(rows[0].construction_queue);
            if (queue.length === 0) return res.json({ type: null, remaining: 0 });
            const type = queue.shift();
            db.query('UPDATE joueurs_map SET construction_queue = ? WHERE joueur_id = ?',
                [JSON.stringify(queue), req.params.id], (err2) => {
                    if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                    res.json({ type, remaining: queue.length });
                }
            );
        }
    );
});

// PATCH — déduire du carburant pour la file d'attente
router.patch('/:id/construction/fuel', requireAuth, (req, res) => {
    const { amount } = req.body;
    const n = Number(amount);
    // Valide uniquement : entier positif, multiple de 1000, max 5000
    if (!Number.isInteger(n) || n <= 0 || n % 1000 !== 0 || n > 5000)
        return res.status(400).json({ erreur: 'Montant invalide' });
    db.query(
        `SELECT carburant, carburant_niveau, carburant_dernier_update FROM joueurs_map WHERE joueur_id = ?`,
        [req.params.id], (err, rows) => {
            if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
            const r = rows[0];
            const actuel = calculerRessource(r.carburant, r.carburant_niveau, r.carburant_dernier_update, CARBURANT);
            if (actuel < n) return res.status(400).json({ erreur: `Carburant insuffisant (${Math.floor(actuel)}/${n})` });
            const now = Date.now();
            db.query('UPDATE joueurs_map SET carburant = ?, carburant_dernier_update = ? WHERE joueur_id = ?',
                [actuel - n, now, req.params.id], (err2) => {
                    if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                    res.json({ ok: true, carburant_restant: actuel - n });
                });
        });
});

// DELETE — annuler la construction en cours (sans remboursement)
// Query param optionnel : ?base_id=X pour une base capturée, absent pour la base principale
router.delete('/:id/construction/current', requireAuth, (req, res) => {
    const baseId = req.query.base_id ? Number(req.query.base_id) : null;
    // construction_fin > now = encore en construction (colonne construit n'existe pas en DB)
    const [sql, params] = baseId
        ? ['DELETE FROM vehicules WHERE joueur_id = ? AND base_neutre_id = ? AND construction_fin > ? LIMIT 1',
           [req.params.id, baseId, Date.now()]]
        : ['DELETE FROM vehicules WHERE joueur_id = ? AND base_neutre_id IS NULL AND construction_fin > ? LIMIT 1',
           [req.params.id, Date.now()]];
    db.query(sql, params,
        (err, result) => {
            if (err) return res.status(500).json({ erreur: 'Erreur serveur' });
            res.json({ ok: true, annule: result.affectedRows > 0 });
        }
    );
});

// Rate limit déplacements : max 1 ordre de mouvement par véhicule toutes les 200ms
const _derniersDeplacements = {};

// ── Déplacer un véhicule ──────────────────────────────────────
router.patch('/:id/jeep/deplacer', requireAuth, (req, res) => {
    const { x, y, vehicule_id } = req.body;
    if (!validerCoordonnees(x, y))
        return res.status(400).json({ erreur: 'Coordonnées invalides' });
    const vid = Number(vehicule_id);
    if (!Number.isInteger(vid) || vid <= 0)
        return res.status(400).json({ erreur: 'Véhicule invalide' });

    // Rate limit par véhicule
    const now = Date.now();
    if (now - (_derniersDeplacements[vid] ?? 0) < 200)
        return res.json({ ok: true }); // silencieux : le client renverra
    _derniersDeplacements[vid] = now;

    db.query(
        'UPDATE vehicules SET x = ?, y = ?, en_mouvement = 1 WHERE id = ? AND joueur_id = ?',
        [Number(x), Number(y), vid, req.params.id],
        (err, result) => {
            if (err) return res.status(500).json({ erreur: 'Erreur serveur' });
            if (result.affectedRows > 0)
                req.app.get('io').emit('vehicle_moved', { vehicule_id: vid, x: Number(x), y: Number(y) });
            res.json({ ok: true });
        }
    );
});

// ── Véhicule arrivé à destination ────────────────────────────
router.patch('/:id/jeep/arrive', (req, res) => {
    if (!verifierToken(req, res)) return;
    const { vehicule_id, x, y } = req.body;
    if (!Number.isInteger(Number(vehicule_id)) || Number(vehicule_id) <= 0)
        return res.status(400).json({ erreur: 'Véhicule invalide' });
    const savePos = x != null && y != null && validerCoordonnees(x, y);
    if (savePos) {
        db.query(
            'UPDATE vehicules SET en_mouvement = 0, x = ?, y = ? WHERE id = ? AND joueur_id = ?',
            [Number(x), Number(y), vehicule_id, req.params.id],
            (err) => {
                if (err) return res.status(500).json({ erreur: 'Erreur serveur' });
                req.app.get('io').emit('vehicle_arrived', { vehicule_id: Number(vehicule_id), x: Number(x), y: Number(y) });
                res.json({ ok: true });
            }
        );
    } else {
        db.query(
            'UPDATE vehicules SET en_mouvement = 0 WHERE id = ? AND joueur_id = ?',
            [vehicule_id, req.params.id],
            (err) => {
                if (err) return res.status(500).json({ erreur: 'Erreur serveur' });
                res.json({ ok: true });
            }
        );
    }
});

// Cooldowns serveur par véhicule attaquant (anti-cheat)
const _cooldownsVehicules = {};

// ── Détruire un véhicule ennemi ───────────────────────────────
router.patch('/:id/jeep/attaquer', limiteAttaque, requireAuth, (req, res) => {
    const joueurId   = Number(req.params.id);
    const { vehicule_id, attaquant_id } = req.body;
    const vidNum = Number(vehicule_id), aidNum = Number(attaquant_id);
    if (!Number.isInteger(vidNum) || vidNum <= 0 || !Number.isInteger(aidNum) || aidNum <= 0)
        return res.status(400).json({ erreur: 'Paramètres invalides' });

    const now = Date.now();

    // 1. Vérifier que l'attaquant existe, appartient au joueur et est construit
    db.query(
        'SELECT type, x, y, construction_fin FROM vehicules WHERE id = ? AND joueur_id = ? AND (mort = 0 OR mort IS NULL)',
        [aidNum, joueurId],
        (err, attRows) => {
            if (err || !attRows.length)
                return res.status(403).json({ erreur: 'Attaquant invalide' });
            const att = attRows[0];
            if (att.construction_fin && att.construction_fin > now)
                return res.status(403).json({ erreur: 'Attaquant encore en construction' });

            const cfg = VEHICULES[att.type];
            if (!cfg) return res.status(400).json({ erreur: 'Type inconnu' });

            // 2. Cooldown serveur par véhicule
            const lastAtk = _cooldownsVehicules[aidNum] ?? 0;
            if (now - lastAtk < cfg.cooldown * 0.8) // tolérance 20%
                return res.status(429).json({ erreur: 'Cooldown' });
            _cooldownsVehicules[aidNum] = now;

            // 3. Vérifier la cible (appartient à un autre joueur, vivante)
            db.query(
                'SELECT id, x, y FROM vehicules WHERE id = ? AND joueur_id != ? AND (mort = 0 OR mort IS NULL) AND (construction_fin IS NULL OR construction_fin <= ?)',
                [vidNum, joueurId, now],
                (err2, tgtRows) => {
                    if (err2 || !tgtRows.length)
                        return res.status(403).json({ erreur: 'Cible invalide' });
                    const tgt = tgtRows[0];

                    // 4. Vérification de portée (positions approximatives en unités map)
                    const dist = Math.hypot(att.x - tgt.x, att.y - tgt.y);
                    if (dist > cfg.portee * 3) // ×3 tolérance pour le mouvement en cours
                        return res.status(403).json({ erreur: 'Hors de portée' });

                    // 5. Marquer mort et notifier
                    db.query('UPDATE vehicules SET mort = 1 WHERE id = ? AND mort = 0', [vidNum], (err3, result) => {
                        if (err3) return res.status(500).json({ erreur: 'Erreur serveur' });
                        if (result.affectedRows > 0)
                            req.app.get('io').emit('vehicle_destroyed', { vehicule_id: vidNum });
                        res.json({ ok: true });
                    });
                }
            );
        }
    );
});

// ── Créer / rejoindre un groupe ───────────────────────────────
router.post('/:id/groupe', (req, res) => {
    if (!verifierToken(req, res)) return;
    const { vehicule_ids, groupe_id: groupeIdForce } = req.body;
    if (!Array.isArray(vehicule_ids) || vehicule_ids.length < 1)
        return res.status(400).json({ erreur: 'Au moins 1 véhicule requis' });

    const assignerGroupe = (groupe_id) => {
                // Identifier les véhicules déjà membres du groupe (ne pas toucher leur slot)
                db.query(
                    'SELECT id FROM vehicules WHERE id IN (?) AND groupe_id = ?',
                    [vehicule_ids, groupe_id],
                    (err2, existingRows) => {
                        if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                        const existingIds = new Set(existingRows.map(r => Number(r.id)));
                        const nouveaux = vehicule_ids.filter(vid => !existingIds.has(Number(vid)));
                        if (nouveaux.length === 0) return res.json({ groupe_id });

                        // Trouver le slot max actuel pour assigner la suite
                        db.query(
                            'SELECT COALESCE(MAX(formation_slot), -1) as maxSlot FROM vehicules WHERE groupe_id = ?',
                            [groupe_id],
                            (err3, slotRows) => {
                                if (err3) return res.status(500).json({ erreur: 'Erreur serveur' });
                                let nextSlot = slotRows[0].maxSlot + 1;
                                let remaining = nouveaux.length, errored = false;
                                nouveaux.forEach((vid, i) => {
                                    db.query(
                                        'UPDATE vehicules SET groupe_id = ?, formation_slot = ? WHERE id = ? AND joueur_id = ?',
                                        [groupe_id, nextSlot + i, vid, req.params.id],
                                        (err4) => {
                                            if (errored) return;
                                            if (err4) { errored = true; return res.status(500).json({ erreur: 'Erreur serveur' }); }
                                            if (--remaining === 0) res.json({ groupe_id });
                                        }
                                    );
                                });
                            }
                        );
                    }
                );
            };

    // groupe_id explicitement fourni (ex: jonction depuis mouvement.js) : pas de SELECT ambigu
    if (groupeIdForce) {
        assignerGroupe(Number(groupeIdForce));
        return;
    }

    // Sinon : déduire le groupe depuis les véhicules (création ou rejoindre)
    db.query(
        'SELECT groupe_id FROM vehicules WHERE id IN (?) AND joueur_id = ? AND groupe_id IS NOT NULL LIMIT 1',
        [vehicule_ids, req.params.id],
        (err, rows) => {
            if (err) return res.status(500).json({ erreur: 'Erreur serveur' });
            if (rows.length > 0) {
                assignerGroupe(Number(rows[0].groupe_id));
            } else {
                db.query('INSERT INTO groupes (joueur_id) VALUES (?)', [req.params.id], (err2, result) => {
                    if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                    assignerGroupe(Number(result.insertId));
                });
            }
        }
    );
});

// ── Supprimer son propre véhicule (nettoyage après destruction) ──
router.delete('/:id/vehicule/:vid/supprimer', (req, res) => {
    if (!verifierToken(req, res)) return;
    db.query(
        'DELETE FROM vehicules WHERE id = ? AND joueur_id = ?',
        [req.params.vid, req.params.id],
        (err, result) => {
            if (err) return res.status(500).json({ erreur: 'Erreur serveur' });
            if (result.affectedRows > 0)
                req.app.get('io').emit('vehicle_destroyed', { vehicule_id: Number(req.params.vid) });
            res.json({ ok: true });
        }
    );
});

// ── Dissoudre un groupe ────────────────────────────────────────
router.delete('/:id/groupe/:gid', (req, res) => {
    if (!verifierToken(req, res)) return;
    db.query(
        'UPDATE vehicules SET groupe_id = NULL WHERE groupe_id = ? AND joueur_id = ?',
        [req.params.gid, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ erreur: 'Erreur serveur' });
            db.query('DELETE FROM groupes WHERE id = ? AND joueur_id = ?', [req.params.gid, req.params.id], () => {});
            res.json({ ok: true });
        }
    );
});

// ── Retirer un véhicule de son groupe ────────────────────────
router.patch('/:id/vehicule/:vid/quitter-groupe', (req, res) => {
    if (!verifierToken(req, res)) return;
    db.query(
        'UPDATE vehicules SET groupe_id = NULL, formation_slot = NULL WHERE id = ? AND joueur_id = ?',
        [req.params.vid, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ erreur: 'Erreur serveur' });
            res.json({ ok: true });
        }
    );
});

// ── Infos joueur ──────────────────────────────────────────────
router.get('/:id', (req, res) => {
    db.query(
        'SELECT id, pseudo, email, points, date_inscription FROM joueurs WHERE id = ?',
        [req.params.id],
        (err, results) => {
            if (err || results.length === 0)
                return res.status(404).json({ erreur: 'Joueur introuvable' });
            res.json(results[0]);
        }
    );
});

// ── Position sur la map ───────────────────────────────────────
router.get('/:id/map', (req, res) => {
    db.query(
        'SELECT * FROM joueurs_map WHERE joueur_id = ?',
        [req.params.id],
        (err, results) => {
            if (err || results.length === 0)
                return res.status(404).json({ erreur: 'Position introuvable' });
            res.json(results[0]);
        }
    );
});

// ── Capture d'une base neutre par un TT ──────────────────────
router.post('/:id/capturer-base/:base_id', (req, res) => {
    if (!verifierToken(req, res)) return;
    const joueurId = Number(req.params.id);
    const baseId   = Number(req.params.base_id);

    db.query('SELECT pos_x, pos_y FROM bases_neutres WHERE id = ?', [baseId], (errB, baseRows) => {
        if (errB || !baseRows.length) return res.status(404).json({ erreur: 'Base introuvable' });
        const { pos_x, pos_y } = baseRows[0];

        // Anti-triche : vérifier qu'un TT du joueur est bien à portée de la niche
        const nicheX = pos_x - 250, nicheY = pos_y + 72;
        const RAYON  = 120;
        db.query(
            'SELECT COUNT(*) as cnt FROM vehicules WHERE joueur_id = ? AND type = "tt" AND (mort = 0 OR mort IS NULL) AND (construction_fin IS NULL OR construction_fin <= ?) AND ABS(x - ?) <= ? AND ABS(y - ?) <= ?',
            [joueurId, Date.now(), nicheX, RAYON, nicheY, RAYON],
            (errTT, ttRows) => {
                if (errTT || !(ttRows[0]?.cnt > 0))
                    return res.status(403).json({ erreur: 'Aucun TT à portée' });

                db.query('SELECT pseudo FROM joueurs WHERE id = ?', [joueurId], (errP, joueurs) => {
                    const pseudo = joueurs?.[0]?.pseudo ?? 'Joueur';

                    db.query('UPDATE bases_neutres SET joueur_id = ?, pseudo = ? WHERE id = ?',
                        [joueurId, pseudo, baseId],
                        (err2) => {
                            if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });

                            db.query('DELETE FROM vehicules_neutres WHERE base_id = ? AND type = "sam"', [baseId], () => {
                                const sx1 = pos_x - 180, sy1 = pos_y + 100;
                                const sx2 = pos_x - 165, sy2 = pos_y + 102;
                                db.query(
                                    'INSERT INTO vehicules_neutres (base_id, type, x, y, formation_slot, pv) VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)',
                                    [baseId, 'sam', sx1, sy1, 0, 800, baseId, 'sam', sx2, sy2, 1, 800],
                                    (errI, insRes) => {
                                        if (errI) return res.status(500).json({ erreur: 'Erreur serveur' });
                                        const id1 = insRes.insertId, id2 = insRes.insertId + 1;
                                        const sams = [
                                            { id: `c${id1}`, type: 'sam', x: sx1, y: sy1, cur_x: sx1, cur_y: sy1, formation_slot: 0, pv: 800, construit: 1, groupe_id: null, construction_fin: null, lastAttack: 0, target: null, frameIndex: 0 },
                                            { id: `c${id2}`, type: 'sam', x: sx2, y: sy2, cur_x: sx2, cur_y: sy2, formation_slot: 1, pv: 800, construit: 1, groupe_id: null, construction_fin: null, lastAttack: 0, target: null, frameIndex: 0 }
                                        ];
                                        req.app.get('io').emit('base_capturee', { base_id: baseId, joueur_id: joueurId, pseudo, sams });
                                        res.json({ ok: true, pseudo });
                                    }
                                );
                            });
                        }
                    );
                });
            }
        );
    });
});

// ── Construire un véhicule sur une base capturée ─────────────
router.patch('/:id/base-capturee/:base_id/construire', (req, res) => {
    if (!verifierToken(req, res)) return;
    const joueurId = Number(req.params.id);
    const baseId   = Number(req.params.base_id);
    const { type } = req.body;
    const cout = VEHICULES[type];
    if (!cout) return res.status(400).json({ erreur: 'Type invalide' });

    db.query('SELECT pos_x, pos_y FROM bases_neutres WHERE id = ? AND joueur_id = ?',
        [baseId, joueurId],
        (err, rows) => {
            if (err || !rows.length) return res.status(403).json({ erreur: 'Base non autorisée' });
            const { pos_x, pos_y } = rows[0];

            // Vérifier qu'aucune construction n'est en cours sur cette base capturée
            db.query(
                'SELECT COUNT(*) as cnt FROM vehicules WHERE joueur_id = ? AND base_neutre_id = ? AND construction_fin > ?',
                [joueurId, baseId, Date.now()],
                (errC, cRows) => {
                    if (errC) return res.status(500).json({ erreur: 'Erreur serveur' });
                    if (cRows[0].cnt > 0) return res.status(400).json({ erreur: 'already_building' });

                    const construction_fin = Date.now() + cout.temps_construction;
                    // Position : comme la base principale mais décalée
                    if (type === 'sam') {
                        // Compter TOUS les SAMs de la base : vehicules_neutres + vehicules construits
                        db.query(
                            `SELECT (SELECT COUNT(*) FROM vehicules_neutres WHERE base_id = ? AND type = 'sam')
                                  + (SELECT COUNT(*) FROM vehicules    WHERE base_neutre_id = ? AND type = 'sam' AND joueur_id = ? AND (mort = 0 OR mort IS NULL)) AS cnt`,
                            [baseId, baseId, joueurId],
                            (errS, sRows) => {
                                const n = errS ? 2 : (sRows[0]?.cnt ?? 2);
                                const x = pos_x - 180 + n * 15, y = pos_y + 100 + n * 2;
                                db.query(
                                    'INSERT INTO vehicules (joueur_id, type, x, y, construction_fin, base_neutre_id) VALUES (?,?,?,?,?,?)',
                                    [joueurId, type, x, y, construction_fin, baseId],
                                    (err3, result) => {
                                        if (err3) return res.status(500).json({ erreur: 'Erreur serveur' });
                                        res.json({ id: Number(result.insertId), jeep_x: x, jeep_y: y, construction_fin });
                                    }
                                );
                            }
                        );
                    } else {
                        const x = pos_x - 250, y = pos_y + 71.875;
                        db.query(
                            'INSERT INTO vehicules (joueur_id, type, x, y, construction_fin, base_neutre_id) VALUES (?,?,?,?,?,?)',
                            [joueurId, type, x, y, construction_fin, baseId],
                            (err3, result) => {
                                if (err3) return res.status(500).json({ erreur: 'Erreur serveur' });
                                res.json({ id: Number(result.insertId), jeep_x: x, jeep_y: y, construction_fin });
                            }
                        );
                    }
                }
            );
        }
    );
});

// ── Helper : nettoyage complet quand une base est perdue ─────
function _nettoyerBasePrise(db, io, baseId, proprietaire, cb) {
    const now = Date.now();
    // 1. Remettre la base en neutre
    db.query('UPDATE bases_neutres SET joueur_id = NULL, pseudo = NULL WHERE id = ?', [baseId], () => {
        // 2a. Supprimer TOUS les SAMs de vehicules_neutres (y compris ceux non encore supprimés par sam-capture)
        db.query('DELETE FROM vehicules_neutres WHERE base_id = ? AND type = "sam"', [baseId], () => {
            // 2b. Supprimer les SAMs de vehicules (construits par le joueur)
            db.query('DELETE FROM vehicules WHERE base_neutre_id = ? AND type = "sam"', [baseId], () => {
                // 3. Supprimer les véhicules encore en construction
                db.query('DELETE FROM vehicules WHERE base_neutre_id = ? AND construction_fin > ?', [baseId, now], () => {
                    // 4. Libérer les véhicules déjà déployés (ils restent au joueur mais sans attache)
                    db.query('UPDATE vehicules SET base_neutre_id = NULL WHERE base_neutre_id = ?', [baseId], () => {
                        io.emit('base_perdue', { base_id: baseId, joueur_id: proprietaire });
                        if (cb) cb();
                    });
                });
            });
        });
    });
}

// ── Perte d'une base capturée (tous les SAMs détruits) ───────
// Accepte l'appel de n'importe quel joueur authentifié
router.post('/:id/perdre-base/:base_id', requireAuth, (req, res) => {
    const baseId = Number(req.params.base_id);

    db.query('SELECT joueur_id AS proprietaire FROM bases_neutres WHERE id = ? AND joueur_id IS NOT NULL',
        [baseId],
        (err, rows) => {
            if (err || !rows.length) return res.json({ ok: true, dejaNeutre: true });
            const proprietaire = rows[0].proprietaire;
            _nettoyerBasePrise(db, req.app.get('io'), baseId, proprietaire, () => res.json({ ok: true }));
        }
    );
});

// ── Destruction d'un SAM sur une base capturée ───────────────
const _samCaptureLastKill = {}; // base_id → timestamp (rate limit 1/sec par base)

router.patch('/:id/sam-capture/:sam_id/degats', requireAuth, (req, res) => {
    const samId = Number(req.params.sam_id);
    if (!Number.isInteger(samId) || samId <= 0)
        return res.status(400).json({ erreur: 'SAM invalide' });

    // Trouver le SAM et sa base dans vehicules_neutres
    db.query('SELECT vn.id, vn.base_id, bn.joueur_id FROM vehicules_neutres vn JOIN bases_neutres bn ON bn.id = vn.base_id WHERE vn.id = ? AND vn.type = "sam"',
        [samId],
        (err, rows) => {
            if (err || !rows.length) return res.status(404).json({ erreur: 'SAM introuvable' });
            const { base_id, joueur_id: proprietaire } = rows[0];
            if (!proprietaire) return res.status(400).json({ erreur: 'Base non capturée' });

            // Rate limit : 1 destruction max par seconde par base
            const now = Date.now();
            if (_samCaptureLastKill[base_id] && now - _samCaptureLastKill[base_id] < 1000)
                return res.json({ ok: true, rateLimit: true });
            _samCaptureLastKill[base_id] = now;

            const io = req.app.get('io');

            // Supprimer ce SAM
            db.query('DELETE FROM vehicules_neutres WHERE id = ?', [samId], (err2) => {
                if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });

                // Notifier tous les clients (ID avec préfixe 'c' pour correspondre au client)
                io.emit('vehicle_destroyed', { vehicule_id: `c${samId}` });

                // Vérifier s'il reste des SAMs sur cette base
                db.query('SELECT COUNT(*) as cnt FROM vehicules_neutres WHERE base_id = ? AND type = "sam"',
                    [base_id],
                    (err3, cntRows) => {
                        if (!err3 && cntRows[0].cnt === 0) {
                            _nettoyerBasePrise(db, io, base_id, proprietaire, null);
                        }
                        res.json({ ok: true });
                    }
                );
            });
        }
    );
});

// ── Dégâts sur un SAM neutre ─────────────────────────────────
// Le client envoie l'ID de son véhicule attaquant ; le serveur recalcule les dégâts.
router.patch('/:id/sam-neutre/:sam_id/degats', limiteDegatsNeutre, (req, res) => {
    if (!verifierToken(req, res)) return;
    const { attaquant_id } = req.body;
    const samId = Number(req.params.sam_id);

    if (!Number.isInteger(samId) || samId <= 0)
        return res.status(400).json({ erreur: 'SAM invalide' });
    if (!Number.isInteger(Number(attaquant_id)) || Number(attaquant_id) <= 0)
        return res.status(400).json({ erreur: 'Attaquant invalide' });

    // Vérifier que le véhicule appartient bien au joueur et est construit
    db.query(
        'SELECT type FROM vehicules WHERE id = ? AND joueur_id = ? AND construction_fin < ?',
        [attaquant_id, req.params.id, Date.now()],
        (err, rows) => {
            if (err || !rows.length)
                return res.status(403).json({ erreur: 'Véhicule attaquant invalide' });

            const type = rows[0].type;
            if (!VEHICULES[type])
                return res.status(400).json({ erreur: 'Type de véhicule inconnu' });

            const degats = VEHICULES[type].attaque;
            db.query(
                'UPDATE vehicules_neutres SET pv = GREATEST(0, pv - ?) WHERE id = ?',
                [degats, samId],
                (err2) => {
                    if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                    res.json({ ok: true });
                }
            );
        }
    );
});

module.exports = router;
