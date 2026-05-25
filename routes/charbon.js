// ============================================================
//  ROUTES/CHARBON.JS — Production de charbon
// ============================================================

const express = require('express');
const db      = require('../db');
const router  = express.Router();
const { CHARBON: C, BETON: CB } = require('../constantes');
const { verifierToken } = require('../middleware/auth');
const PROD_PAR_NIVEAU = C.prod;
const MAX_PAR_NIVEAU  = C.max;
const COUT_NIVEAU     = C.cout;

function calculer(charbon, niveau, dernierUpdate) {
    if (niveau === 0 || !dernierUpdate) return charbon;
    const elapsed = (Date.now() - Number(dernierUpdate)) / 1000;
    return Math.min(MAX_PAR_NIVEAU[niveau], charbon + Math.floor(elapsed * PROD_PAR_NIVEAU[niveau]));
}

function calculerBeton(beton, niveau, dernierUpdate) {
    if (niveau === 0 || !dernierUpdate) return beton ?? 0;
    const elapsed = (Date.now() - Number(dernierUpdate)) / 1000;
    return Math.min(CB.max[niveau], beton + Math.floor(elapsed * CB.prod[niveau]));
}

function etat(charbon, niveau) {
    return {
        charbon, niveau,
        production    : PROD_PAR_NIVEAU[niveau],
        max           : MAX_PAR_NIVEAU[niveau],
        cout_prochain : niveau < 10 ? COUT_NIVEAU[niveau + 1] : null
    };
}

router.get('/:id/charbon', (req, res) => {
    if (!verifierToken(req, res)) return;
    db.query(
        'SELECT charbon, charbon_niveau, charbon_dernier_update FROM joueurs_map WHERE joueur_id = ?',
        [req.params.id],
        (err, rows) => {
            if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
            const { charbon, charbon_niveau, charbon_dernier_update } = rows[0];
            res.json(etat(calculer(charbon, charbon_niveau, charbon_dernier_update), charbon_niveau));
        }
    );
});

router.patch('/:id/charbon/ameliorer', (req, res) => {
    if (!verifierToken(req, res)) return;
    db.query(
        'SELECT beton, beton_niveau, beton_dernier_update, charbon, charbon_niveau, charbon_dernier_update FROM joueurs_map WHERE joueur_id = ?',
        [req.params.id],
        (err, rows) => {
            if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
            const { beton, beton_niveau, beton_dernier_update, charbon, charbon_niveau, charbon_dernier_update } = rows[0];
            if (charbon_niveau >= 10)
                return res.status(400).json({ erreur: 'Niveau maximum atteint' });

            const cout = COUT_NIVEAU[charbon_niveau + 1];
            const betonActuel = calculerBeton(beton, beton_niveau, beton_dernier_update);
            if (betonActuel < cout)
                return res.status(400).json({ erreur: 'Béton insuffisant', beton: betonActuel, cout });

            const charbonActuel = calculer(charbon, charbon_niveau, charbon_dernier_update);
            const nouveauNiveau = charbon_niveau + 1;
            const now = Date.now();

            db.query(
                'UPDATE joueurs_map SET beton = ?, beton_dernier_update = ?, charbon = ?, charbon_niveau = ?, charbon_dernier_update = ? WHERE joueur_id = ?',
                [betonActuel - cout, now, charbonActuel, nouveauNiveau, now, req.params.id],
                (err2) => {
                    if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });
                    req.app.get('io').emit('charbon_niveau', {
                        joueur_id: Number(req.params.id),
                        niveau: nouveauNiveau
                    });
                    res.json(etat(charbonActuel, nouveauNiveau));
                }
            );
        }
    );
});

module.exports = router;
