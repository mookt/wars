// ============================================================
//  PRODUCTION.JS — Flush périodique des ressources en base
// ============================================================

const { BETON, ACIER, CHARBON, CARBURANT, VEHICULES, calculerRessource } = require('./constantes');

function demarrerProduction(db) {

    // ── Production des ressources (toutes les 5s) ─────────────
    setInterval(() => {
        const now = Date.now();
        db.query(
            `SELECT joueur_id,
                    beton,     beton_niveau,     beton_dernier_update,
                    acier,     acier_niveau,     acier_dernier_update,
                    charbon,   charbon_niveau,   charbon_dernier_update,
                    carburant, carburant_niveau, carburant_dernier_update
             FROM joueurs_map`,
            (err, rows) => {
                if (err) { console.error('❌ production flush:', err.message); return; }
                rows.forEach(row => {
                    const beton     = calculerRessource(row.beton,     row.beton_niveau,     row.beton_dernier_update,     BETON);
                    const acier     = calculerRessource(row.acier,     row.acier_niveau,     row.acier_dernier_update,     ACIER);
                    const charbon   = calculerRessource(row.charbon,   row.charbon_niveau,   row.charbon_dernier_update,   CHARBON);
                    const carburant = calculerRessource(row.carburant, row.carburant_niveau, row.carburant_dernier_update, CARBURANT);

                    db.query(
                        `UPDATE joueurs_map
                         SET beton = ?, beton_dernier_update = ?,
                             acier = ?, acier_dernier_update = ?,
                             charbon = ?, charbon_dernier_update = ?,
                             carburant = ?, carburant_dernier_update = ?
                         WHERE joueur_id = ?`,
                        [beton, now, acier, now, charbon, now, carburant, now, row.joueur_id]
                    );
                });
            }
        );
    }, 5000);

    // ── Consommation carburant (toutes les 2s si véhicules en mouvement) ─
    setInterval(() => {
        const now = Date.now();
        db.query(
            `SELECT jm.joueur_id,
                    jm.carburant, jm.carburant_niveau, jm.carburant_dernier_update,
                    COALESCE(SUM(v.type = 'jeep'   AND v.en_mouvement = 1), 0) AS nb_jeep,
                    COALESCE(SUM(v.type = 'humvet' AND v.en_mouvement = 1), 0) AS nb_humvet
             FROM joueurs_map jm
             LEFT JOIN vehicules v ON v.joueur_id = jm.joueur_id
             GROUP BY jm.joueur_id, jm.carburant, jm.carburant_niveau, jm.carburant_dernier_update`,
            (err, rows) => {
                if (err) { console.error('❌ conso carburant:', err.message); return; }
                rows.forEach(row => {
                    if (!row.nb_jeep && !row.nb_humvet) return;

                    const drain = row.nb_jeep   * VEHICULES.jeep.conso_carburant
                                + row.nb_humvet * VEHICULES.humvet.conso_carburant;
                    const carburant = Math.max(0,
                        calculerRessource(row.carburant, row.carburant_niveau, row.carburant_dernier_update, CARBURANT) - drain
                    );

                    db.query(
                        'UPDATE joueurs_map SET carburant = ?, carburant_dernier_update = ? WHERE joueur_id = ?',
                        [carburant, now, row.joueur_id]
                    );
                });
            }
        );
    }, 2000);
}

module.exports = { demarrerProduction };
