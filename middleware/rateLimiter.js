// ============================================================
//  MIDDLEWARE/RATELIMITER.JS — Limitation des tentatives
// ============================================================

const tentatives      = {};
const compteursJoueur = {};

// Limiteur par IP (routes d'authentification)
function rateLimiter(maxTentatives, fenetreMs) {
    return (req, res, next) => {
        const cle = req.ip;
        const now = Date.now();

        if (!tentatives[cle]) tentatives[cle] = [];
        tentatives[cle] = tentatives[cle].filter(t => now - t < fenetreMs);

        if (tentatives[cle].length >= maxTentatives)
            return res.status(429).json({ erreur: 'Trop de tentatives, réessayez plus tard.' });

        tentatives[cle].push(now);
        next();
    };
}

// Limiteur par joueur (actions de jeu) — clé = espace:joueur_id
function rateLimiterParJoueur(maxActions, fenetreMs, espace = 'action') {
    return (req, res, next) => {
        const cle = `${espace}:${req.params.id || req.ip}`;
        const now = Date.now();

        if (!compteursJoueur[cle]) compteursJoueur[cle] = [];
        compteursJoueur[cle] = compteursJoueur[cle].filter(t => now - t < fenetreMs);

        if (compteursJoueur[cle].length >= maxActions)
            return res.status(429).json({ erreur: 'Trop de requêtes, ralentissez.' });

        compteursJoueur[cle].push(now);
        next();
    };
}

// Nettoyage périodique pour éviter les fuites mémoire
setInterval(() => {
    const now = Date.now();
    [tentatives, compteursJoueur].forEach(store => {
        Object.keys(store).forEach(cle => {
            store[cle] = store[cle].filter(t => now - t < 900000);
            if (!store[cle].length) delete store[cle];
        });
    });
}, 60000);

module.exports = { rateLimiter, rateLimiterParJoueur };
