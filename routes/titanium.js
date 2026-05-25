// ============================================================
//  ROUTES/TITANIUM.JS — Stock de titanium
// ============================================================

const express = require('express');
const db      = require('../db');
const router  = express.Router();
const { verifierToken } = require('../middleware/auth');

router.get('/:id/titanium', (req, res) => {
    if (!verifierToken(req, res)) return;
    db.query(
        'SELECT titanium FROM joueurs_map WHERE joueur_id = ?',
        [req.params.id],
        (err, rows) => {
            if (err || !rows.length) return res.status(500).json({ erreur: 'Erreur serveur' });
            res.json({ titanium: rows[0].titanium ?? 0 });
        }
    );
});

module.exports = router;
