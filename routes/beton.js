// ============================================================
//  ROUTES/BETON.JS — Production de béton
// ============================================================

const express = require('express');
const db      = require('../db');
const router  = express.Router();
const { BETON: C } = require('../constantes');
const { verifierToken } = require('../middleware/auth');
const PROD_PAR_NIVEAU = C.prod;
const MAX_PAR_NIVEAU  = C.max;
const COUT_NIVEAU     = C.cout;

function calculerBeton(beton, niveau, dernierUpdate) {
    if (niveau === 0 || !dernierUpdate) return beton;
    const elapsed = (Date.now() - Number(dernierUpdate)) / 1000;
    return Math.min(MAX_PAR_NIVEAU[niveau], beton + Math.floor(elapsed * PROD_PAR_NIVEAU[niveau]));
}

function etat(beton, niveau) {
    return {
        beton, niveau,
        production : PROD_PAR_NIVEAU[niveau],
        max        : MAX_PAR_NIVEAU[niveau],
        cout_prochain : niveau < 10 ? COUT_NIVEAU[niveau + 1] : null
    };
}

// ── GET /:id/beton — état actuel ────────────────────────────
router.get('/:id/beton', (req, res) => {
    if (!verifierToken(req, res)) return;
    db.query(
        'SELECT beton, beton_niveau, beton_dernier_update FROM joueurs_map WHERE joueur_id = ?',
        [req.params.id],
        (err, rows) => {
            if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
            const { beton, beton_niveau, beton_dernier_update } = rows[0];
            res.json(etat(calculerBeton(beton, beton_niveau, beton_dernier_update), beton_niveau));
        }
    );
});

// ── PATCH /:id/beton/ameliorer — passer au niveau suivant ──
router.patch('/:id/beton/ameliorer', (req, res) => {
    if (!verifierToken(req, res)) return;
    db.query(
        'SELECT beton, beton_niveau, beton_dernier_update FROM joueurs_map WHERE joueur_id = ?',
        [req.params.id],
        (err, rows) => {
            if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
            const { beton, beton_niveau, beton_dernier_update } = rows[0];
            if (beton_niveau >= 10)
                return res.status(400).json({ erreur: 'Niveau maximum atteint' });

            const betonActuel = calculerBeton(beton, beton_niveau, beton_dernier_update);
            const cout = COUT_NIVEAU[beton_niveau + 1];
            if (betonActuel < cout)
                return res.status(400).json({ erreur: 'Béton insuffisant', beton: betonActuel, cout });

            const nouveauNiveau = beton_niveau + 1;
            const nouveauBeton  = betonActuel - cout;
            const now = Date.now();

            db.query(
                'UPDATE joueurs_map SET beton = ?, beton_niveau = ?, beton_dernier_update = ? WHERE joueur_id = ?',
                [nouveauBeton, nouveauNiveau, now, req.params.id],
                (err2) => {
                    if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                    req.app.get('io').emit('beton_niveau', {
                        joueur_id: Number(req.params.id),
                        niveau: nouveauNiveau
                    });
                    res.json(etat(nouveauBeton, nouveauNiveau));
                }
            );
        }
    );
});

module.exports = router;
