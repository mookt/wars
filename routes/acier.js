// ============================================================
//  ROUTES/ACIER.JS — Production d'acier
// ============================================================

const express = require('express');
const db      = require('../db');
const router  = express.Router();
const { ACIER: C, BETON: CB } = require('../constantes');
const { verifierToken } = require('../middleware/auth');
const PROD_PAR_NIVEAU = C.prod;
const MAX_PAR_NIVEAU  = C.max;
const COUT_NIVEAU     = C.cout;

function calculer(acier, niveau, dernierUpdate) {
    if (niveau === 0 || !dernierUpdate) return acier;
    const elapsed = (Date.now() - Number(dernierUpdate)) / 1000;
    return Math.min(MAX_PAR_NIVEAU[niveau], acier + Math.floor(elapsed * PROD_PAR_NIVEAU[niveau]));
}

function calculerBeton(beton, niveau, dernierUpdate) {
    if (niveau === 0 || !dernierUpdate) return beton ?? 0;
    const elapsed = (Date.now() - Number(dernierUpdate)) / 1000;
    return Math.min(CB.max[niveau], beton + Math.floor(elapsed * CB.prod[niveau]));
}

function etat(acier, niveau) {
    return {
        acier, niveau,
        production    : PROD_PAR_NIVEAU[niveau],
        max           : MAX_PAR_NIVEAU[niveau],
        cout_prochain : niveau < 10 ? COUT_NIVEAU[niveau + 1] : null
    };
}

router.get('/:id/acier', (req, res) => {
    if (!verifierToken(req, res)) return;
    db.query(
        'SELECT acier, acier_niveau, acier_dernier_update FROM joueurs_map WHERE joueur_id = ?',
        [req.params.id],
        (err, rows) => {
            if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
            const { acier, acier_niveau, acier_dernier_update } = rows[0];
            res.json(etat(calculer(acier, acier_niveau, acier_dernier_update), acier_niveau));
        }
    );
});

router.patch('/:id/acier/ameliorer', (req, res) => {
    if (!verifierToken(req, res)) return;
    db.query(
        'SELECT beton, beton_niveau, beton_dernier_update, acier, acier_niveau, acier_dernier_update FROM joueurs_map WHERE joueur_id = ?',
        [req.params.id],
        (err, rows) => {
            if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
            const { beton, beton_niveau, beton_dernier_update, acier, acier_niveau, acier_dernier_update } = rows[0];
            if (acier_niveau >= 10)
                return res.status(400).json({ erreur: 'Niveau maximum atteint' });

            const cout = COUT_NIVEAU[acier_niveau + 1];
            const betonActuel = calculerBeton(beton, beton_niveau, beton_dernier_update);
            if (betonActuel < cout)
                return res.status(400).json({ erreur: 'Béton insuffisant', beton: betonActuel, cout });

            const acierActuel   = calculer(acier, acier_niveau, acier_dernier_update);
            const nouveauNiveau = acier_niveau + 1;
            const now = Date.now();

            db.query(
                'UPDATE joueurs_map SET beton = ?, beton_dernier_update = ?, acier = ?, acier_niveau = ?, acier_dernier_update = ? WHERE joueur_id = ?',
                [betonActuel - cout, now, acierActuel, nouveauNiveau, now, req.params.id],
                (err2) => {
                    if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                    req.app.get('io').emit('acier_niveau', {
                        joueur_id: Number(req.params.id),
                        niveau: nouveauNiveau
                    });
                    res.json(etat(acierActuel, nouveauNiveau));
                }
            );
        }
    );
});

module.exports = router;
