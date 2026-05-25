// ============================================================
//  ROUTES/AUTH.JS — Inscription & Connexion
// ============================================================

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { rateLimiter }            = require('../middleware/rateLimiter');
const { envoyerCodeVerification } = require('../services/email');

const router = express.Router();

const limiterAuth = rateLimiter(10, 60000); // 10 tentatives par minute par IP

function genererCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

// ── Inscription ──────────────────────────────────────────────
// Crée le compte (non vérifié) et envoie un code par email
router.post('/inscription', limiterAuth, async (req, res) => {
    const { pseudo, email, mot_de_passe } = req.body;

    if (!pseudo || !email || !mot_de_passe)
        return res.status(400).json({ erreur: 'Tous les champs sont requis' });
    if (pseudo.length < 2 || pseudo.length > 20)
        return res.status(400).json({ erreur: 'Pseudo : 2 à 20 caractères' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return res.status(400).json({ erreur: 'Email invalide' });
    if (mot_de_passe.length < 6)
        return res.status(400).json({ erreur: 'Mot de passe : 6 caractères minimum' });

    try {
        const db   = require('../db');
        const hash = await bcrypt.hash(mot_de_passe, 10);
        const code = genererCode();
        const expiration = new Date(Date.now() + 15 * 60 * 1000); // +15 min

        db.query(
            `INSERT INTO joueurs (pseudo, email, mot_de_passe, email_verifie, code_verification, code_expiration)
             VALUES (?, ?, ?, 0, ?, ?)`,
            [pseudo, email, hash, code, expiration],
            async (err) => {
                if (err) {
                    console.log('Erreur INSERT joueurs:', err);
                    return res.status(400).json({ erreur: 'Pseudo ou email déjà utilisé' });
                }

                try {
                    await envoyerCodeVerification(email, code);
                } catch (mailErr) {
                    console.error('Erreur envoi email:', mailErr);
                    return res.status(500).json({ erreur: 'Compte créé mais impossible d\'envoyer l\'email. Contacte le support.' });
                }

                res.json({ message: 'Code envoyé', email });
            }
        );
    } catch (e) {
        console.error(e);
        res.status(500).json({ erreur: 'Erreur serveur' });
    }
});

// ── Vérification du code ─────────────────────────────────────
router.post('/verifier', limiterAuth, (req, res) => {
    const { email, code } = req.body;

    if (!email || !code)
        return res.status(400).json({ erreur: 'Email et code requis' });

    const db = require('../db');

    db.query(
        'SELECT id, code_verification, code_expiration, email_verifie FROM joueurs WHERE email = ?',
        [email],
        (err, results) => {
            if (err || results.length === 0)
                return res.status(400).json({ erreur: 'Compte introuvable' });

            const joueur = results[0];

            if (joueur.email_verifie)
                return res.status(400).json({ erreur: 'Email déjà vérifié' });

            if (joueur.code_verification !== code)
                return res.status(400).json({ erreur: 'Code incorrect' });

            if (new Date() > new Date(joueur.code_expiration))
                return res.status(400).json({ erreur: 'Code expiré — renvoie-en un nouveau' });

            // Code valide : marquer comme vérifié et créer la map
            db.query(
                'UPDATE joueurs SET email_verifie = 1, code_verification = NULL, code_expiration = NULL WHERE id = ?',
                [joueur.id],
                (err2) => {
                    if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });

                    const x = Math.floor(Math.random() * 4000);
                    const y = Math.floor(Math.random() * 4000);

                    db.query(
                        'INSERT INTO joueurs_map (joueur_id, pos_x, pos_y) VALUES (?, ?, ?)',
                        [Number(joueur.id), x, y],
                        (err3) => {
                            if (err3) {
                                console.log('Erreur INSERT joueurs_map:', err3);
                                return res.status(500).json({ erreur: 'Erreur création map' });
                            }
                            res.json({ message: '✅ Compte vérifié ! Tu peux maintenant te connecter.' });
                        }
                    );
                }
            );
        }
    );
});

// ── Renvoi du code ───────────────────────────────────────────
router.post('/renvoyer-code', limiterAuth, async (req, res) => {
    const { email } = req.body;

    if (!email)
        return res.status(400).json({ erreur: 'Email requis' });

    const db = require('../db');

    db.query(
        'SELECT id, email_verifie FROM joueurs WHERE email = ?',
        [email],
        async (err, results) => {
            if (err || results.length === 0)
                return res.status(400).json({ erreur: 'Compte introuvable' });

            if (results[0].email_verifie)
                return res.status(400).json({ erreur: 'Email déjà vérifié' });

            const code       = genererCode();
            const expiration = new Date(Date.now() + 15 * 60 * 1000);

            db.query(
                'UPDATE joueurs SET code_verification = ?, code_expiration = ? WHERE id = ?',
                [code, expiration, results[0].id],
                async (err2) => {
                    if (err2) return res.status(500).json({ erreur: 'Erreur serveur' });

                    try {
                        await envoyerCodeVerification(email, code);
                        res.json({ message: 'Nouveau code envoyé' });
                    } catch (mailErr) {
                        console.error('Erreur renvoi email:', mailErr);
                        res.status(500).json({ erreur: 'Impossible d\'envoyer l\'email' });
                    }
                }
            );
        }
    );
});

// ── Connexion ────────────────────────────────────────────────
router.post('/connexion', limiterAuth, async (req, res) => {
    const { email, mot_de_passe } = req.body;

    if (!email || !mot_de_passe)
        return res.status(400).json({ erreur: 'Email et mot de passe requis' });

    const db = require('../db');

    db.query(
        'SELECT * FROM joueurs WHERE email = ?',
        [email],
        async (err, results) => {
            if (err || results.length === 0)
                return res.status(400).json({ erreur: 'Email introuvable' });

            const joueur = results[0];

            if (!joueur.email_verifie)
                return res.status(403).json({ erreur: 'Email non vérifié — vérifie ta boite mail', nonVerifie: true, email });

            const valide = await bcrypt.compare(mot_de_passe, joueur.mot_de_passe);
            if (!valide)
                return res.status(400).json({ erreur: 'Mot de passe incorrect' });

            const joueurId = Number(joueur.id);
            const token    = jwt.sign(
                { id: joueurId, pseudo: joueur.pseudo },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            res.json({ token, id: joueurId, pseudo: joueur.pseudo });
        }
    );
});

module.exports = router;
