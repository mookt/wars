// ============================================================
//  SERVER.JS — Point d'entrée principal
// ============================================================

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// --- Middleware ---
app.use(cors());
app.use(express.json());

// Sécurité : headers HTTP
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Empêche la mise en cache des fichiers JS (complique la copie du code)
    if (req.path.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Disposition', 'inline');
    }
    next();
});

// Constantes de jeu servies dynamiquement (source unique : constantes.js)
const { VEHICULES: _VEHICULES } = require('./constantes');
app.get('/js/constantes.js', (req, res) => {
    res.type('application/javascript');
    res.send(`const VEHICULES = ${JSON.stringify(_VEHICULES)};`);
});

app.use(express.static('public'));
app.use('/bruit', express.static('Bruit'));
app.use('/assets/bases', express.static('photos pour base'));

// --- Base de données ---
const db = require('./db');
const { demarrerProduction } = require('./production');


// route
const authRoutes      = require('./routes/auth');
const joueurRoutes    = require('./routes/joueur');
const betonRoutes     = require('./routes/beton');
const acierRoutes     = require('./routes/acier');
const charbonRoutes   = require('./routes/charbon');
const carburantRoutes = require('./routes/carburant');
const titaniumRoutes  = require('./routes/titanium');

app.set('io', io);
app.use('/api/auth',   authRoutes);
app.use('/api/joueur', joueurRoutes);
app.use('/api/joueur', betonRoutes);
app.use('/api/joueur', acierRoutes);
app.use('/api/joueur', charbonRoutes);
app.use('/api/joueur', carburantRoutes);
app.use('/api/joueur', titaniumRoutes);

// --- Socket.IO — Serveur autoritaire ---
// Les owners envoient leurs positions → serveur stocke → tick broadcast à TOUS simultanément
// Tous les observateurs reçoivent exactement les mêmes données au même moment → zéro divergence
const gameState = new Map(); // String(vehicleId) → { x, y, a, ownerId, updatedAt }

io.on('connection', (socket) => {
    console.log('🟢 Joueur connecté :', socket.id);

    // Owner envoie ses positions courantes (~50ms, uniquement pendant le mouvement)
    socket.on('owner_positions', (positions) => {
        if (!Array.isArray(positions)) return;
        const now = Date.now();
        for (const { id, x, y, a, type, jid, gid, slot } of positions) {
            // Garder l'id en Number pour que la comparaison === côté client fonctionne
            const nid = Number(id);
            gameState.set(nid, { x, y, a: a ?? 0, type: type ?? null, jid: jid ?? null,
                                  gid: gid ?? null, slot: slot ?? null, ownerId: socket.id, updatedAt: now });
        }
    });

    socket.on('disconnect', () => {
        console.log('🔴 Joueur déconnecté :', socket.id);
        for (const [id, v] of gameState) {
            if (v.ownerId === socket.id) gameState.delete(id);
        }
    });
});

// Tick autoritaire 50ms : un seul io.emit pour TOUS les clients en même temps
setInterval(() => {
    if (gameState.size === 0) return;
    const now      = Date.now();
    const snapshot = [];
    for (const [id, v] of gameState) {
        if (now - v.updatedAt > 3000) { gameState.delete(id); continue; } // stale → purge
        snapshot.push({ id, x: v.x, y: v.y, a: v.a, type: v.type, jid: v.jid, gid: v.gid, slot: v.slot });
    }
    if (snapshot.length > 0) io.emit('tick', { t: now, vehicles: snapshot });
}, 50);

// --- Base neutre (fortification sans joueur) ---
// Migration : colonne titanium
db.query(`ALTER TABLE joueurs_map ADD COLUMN IF NOT EXISTS titanium INT NOT NULL DEFAULT 0`, () => {});

db.query(`CREATE TABLE IF NOT EXISTS bases_neutres (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    pos_x      FLOAT NOT NULL,
    pos_y      FLOAT NOT NULL,
    pseudo     VARCHAR(50) DEFAULT 'FORTIFICATION',
    joueur_id  INT DEFAULT NULL
)`, () => {
    // Ajouter les colonnes si elles n'existent pas (migration)
    db.query(`ALTER TABLE bases_neutres ADD COLUMN IF NOT EXISTS pseudo VARCHAR(50) DEFAULT 'FORTIFICATION'`, () => {});
    db.query(`ALTER TABLE bases_neutres ADD COLUMN IF NOT EXISTS joueur_id INT DEFAULT NULL`, () => {});
    db.query(`ALTER TABLE bases_neutres ADD COLUMN IF NOT EXISTS murs_beton TINYINT(1) NOT NULL DEFAULT 0`, () => {});
    // Colonne mort pour les véhicules déployés (marquer mort au lieu de supprimer)
    db.query(`ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS mort TINYINT(1) NOT NULL DEFAULT 0`, () => {});
});

db.query(`CREATE TABLE IF NOT EXISTS vehicules_neutres (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    base_id        INT NOT NULL,
    type           VARCHAR(20) NOT NULL DEFAULT 'sam',
    x              FLOAT NOT NULL,
    y              FLOAT NOT NULL,
    formation_slot INT,
    pv             INT NOT NULL DEFAULT 800
)`, () => {
    // Fonction réutilisable pour créer une base neutre à position aléatoire
    function creerBaseNeutre(cb) {
        db.query('SELECT pos_x, pos_y FROM joueurs_map', (err2, playerBases) => {
            db.query('SELECT pos_x, pos_y FROM bases_neutres', (err3, neutres) => {
                const toutes = [...(playerBases || []), ...(neutres || [])];
                let px = 500 + Math.random() * 4000;
                let py = 500 + Math.random() * 4000;
                const MIN_DIST = 800;
                let tentatives = 0;
                const tryPos = () => {
                    const ok = toutes.every(b => Math.hypot(px - b.pos_x, py - b.pos_y) >= MIN_DIST);
                    if (!ok && tentatives++ < 100) {
                        px = 500 + Math.random() * 4000;
                        py = 500 + Math.random() * 4000;
                        tryPos(); return;
                    }
                    db.query('INSERT INTO bases_neutres (pos_x, pos_y) VALUES (?, ?)', [px, py], (e, r) => {
                        if (e || !r) return;
                        const bid = r.insertId;
                        db.query('INSERT INTO vehicules_neutres (base_id, type, x, y, formation_slot, pv) VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)',
                            [bid,'sam', px-180, py+100, 0, 800,
                             bid,'sam', px-165, py+102, 1, 800], () => {});
                        console.log(`✅ Base neutre créée en (${Math.round(px)}, ${Math.round(py)})`);
                        if (cb) cb(bid, px, py);
                    });
                };
                tryPos();
            });
        });
    }

    // Créer 2 bases neutres au démarrage si aucune n'existe
    db.query('SELECT COUNT(*) as cnt FROM bases_neutres', (err, rows) => {
        if (err) return;
        const nb = rows[0].cnt;
        if (nb < 1) creerBaseNeutre(() => creerBaseNeutre());
        else if (nb < 2) creerBaseNeutre();
    });
});

// --- Route admin : créer une nouvelle base neutre ---
app.post('/api/admin/base-neutre', (req, res) => {
    creerBaseNeutre((bid, px, py) => {
        res.json({ ok: true, id: bid, pos_x: px, pos_y: py });
    });
});

// --- Production périodique ---
demarrerProduction(db);

// --- Démarrage ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});