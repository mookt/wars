// ============================================================
//  MIDDLEWARE/AUTH.JS — Vérification JWT centralisée
// ============================================================

const jwt = require('jsonwebtoken');

function verifierToken(req, res) {
    const auth = req.headers.authorization;
    if (!auth) { res.status(401).json({ erreur: 'Non autorisé' }); return null; }
    try {
        const payload = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET);
        if (String(payload.id) !== String(req.params.id))
            { res.status(403).json({ erreur: 'Interdit' }); return null; }
        return payload;
    } catch { res.status(401).json({ erreur: 'Token invalide' }); return null; }
}

// Middleware Express pour les routes sans :id dans l'URL
function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ erreur: 'Non autorisé' });
    try {
        req.joueur = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET);
        next();
    } catch { res.status(401).json({ erreur: 'Token invalide' }); }
}

module.exports = { verifierToken, requireAuth };
