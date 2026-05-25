// ============================================================
//  ROUTES/CARBURANT.JS — Production de carburant
// ============================================================

const express = require('express');
const db      = require('../db');
const router  = express.Router();
const { CARBURANT: C, BETON: CB } = require('../constantes');
const { verifierToken } = require('../middleware/auth');
const PROD_PAR_NIVEAU = C.prod;
const MAX_PAR_NIVEAU  = C.max;
const COUT_NIVEAU     = C.cout;

function calculer(carburant, niveau, dernierUpdate) {
    if (niveau === 0 || !dernierUpdate) return carburant;
    const elapsed = (Date.now() - Number(dernierUpdate)) / 1000;
    return Math.min(MAX_PAR_NIVEAU[niveau], carburant + Math.floor(elapsed * PROD_PAR_NIVEAU[niveau]));
}

function calculerBeton(beton, niveau, dernierUpdate) {
    if (niveau === 0 || !dernierUpdate) return beton ?? 0;
    const elapsed = (Date.now() - Number(dernierUpdate)) / 1000;
    return Math.min(CB.max[niveau], beton + Math.floor(elapsed * CB.prod[niveau]));
}

function etat(carburant, niveau) {
    return {
        carburant, niveau,
        production    : PROD_PAR_NIVEAU[niveau],
        max           : MAX_PAR_NIVEAU[niveau],
        cout_prochain : niveau < 10 ? COUT_NIVEAU[niveau + 1] : null
    };
}

router.get('/:id/carburant', (req, res) => {
    if (!verifierToken(req, res)) return;
    db.query(
        'SELECT carburant, carburant_niveau, carburant_dernier_update FROM joueurs_map WHERE joueur_id = ?',
        [req.params.id],
        (err, rows) => {
            if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
            const { carburant, carburant_niveau, carburant_dernier_update } = rows[0];
            res.json(etat(calculer(carburant, carburant_niveau, carburant_dernier_update), carburant_niveau));
        }
    );
});

router.patch('/:id/carburant/ameliorer', (req, res) => {
    if (!verifierToken(req, res)) return;
    db.query(
        'SELECT beton, beton_niveau, beton_dernier_update, carburant, carburant_niveau, carburant_dernier_update FROM joueurs_map WHERE joueur_id = ?',
        [req.params.id],
        (err, rows) => {
            if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
            const { beton, beton_niveau, beton_dernier_update, carburant, carburant_niveau, carburant_dernier_update } = rows[0];
            if (carburant_niveau >= 10)
                return res.status(400).json({ erreur: 'Niveau maximum atteint' });

            const cout = COUT_NIVEAU[carburant_niveau + 1];
            const betonActuel = calculerBeton(beton, beton_niveau, beton_dernier_update);
            if (betonActuel < cout)
                return res.status(400).json({ erreur: 'Béton insuffisant', beton: betonActuel, cout });

            const carburantActuel = calculer(carburant, carburant_niveau, carburant_dernier_update);
            const nouveauNiveau   = carburant_niveau + 1;
            const now = Date.now();

            db.query(
                'UPDATE joueurs_map SET beton = ?, beton_dernier_update = ?, carburant = ?, carburant_niveau = ?, carburant_dernier_update = ? WHERE joueur_id = ?',
                [betonActuel - cout, now, carburantActuel, nouveauNiveau, now, req.params.id],
                (err2) => {
                    if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                    req.app.get('io').emit('carburant_niveau', {
                        joueur_id: Number(req.params.id),
                        niveau: nouveauNiveau
                    });
                    res.json(etat(carburantActuel, nouveauNiveau));
                }
            );
        }
    );
});

module.exports = router;
