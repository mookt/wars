// ============================================================
//  FORMATION.JS — Positions de formation et déplacement en bloc
//  GROUPE_MAX est défini dans config.js
// ============================================================

// Source unique de vérité pour les positions de slots
function positionsFormation(n, cx, cy) {
    const d = 40;
    const slots = [
        { x:    0, y:    0 },
        { x:    0, y:   -d }, { x:    0, y:    d },
        { x:    d, y:    0 }, { x:   -d, y:    0 },
        { x:    d, y:   -d }, { x:   -d, y:   -d },
        { x:    d, y:    d }, { x:   -d, y:    d },
        { x:    0, y: -2*d }, { x:    0, y:  2*d },
        { x:  2*d, y:    0 }, { x: -2*d, y:    0 },
        { x:    d, y: -2*d }, { x:   -d, y: -2*d },
        { x:  2*d, y:   -d }, { x: -2*d, y:   -d },
        { x:  2*d, y:    d }, { x: -2*d, y:    d },
        { x:    d, y:  2*d }, { x:   -d, y:  2*d },
        { x:  2*d, y: -2*d }, { x: -2*d, y: -2*d },
        { x:  2*d, y:  2*d }, { x: -2*d, y:  2*d },
    ];
    return slots.slice(0, Math.min(n, GROUPE_MAX)).map(s => ({ x: cx + s.x, y: cy + s.y }));
}

// Position cible d'un membre selon son slot et la position du leader
function cibleMembre(ref, slot) {
    const positions = positionsFormation(slot + 1, ref.cur_x, ref.cur_y);
    return positions[slot] ?? { x: ref.cur_x, y: ref.cur_y };
}

const capsGroupes = {}; // conservé pour compatibilité, non utilisé

// Reassigne les formation_slot d'après la position physique réelle de chaque véhicule.
function normaliserParPosition(tries) {
    if (tries.length === 0) return;
    const leader = tries.reduce((min, s) =>
        (s.vehicle.formation_slot ?? Infinity) < (min.vehicle.formation_slot ?? Infinity) ? s : min, tries[0]);
    const lx = leader.vehicle.cur_x ?? leader.vehicle.x;
    const ly = leader.vehicle.cur_y ?? leader.vehicle.y;
    if (!isFinite(lx) || !isFinite(ly)) return;
    const offsets = positionsFormation(GROUPE_MAX, 0, 0);
    const assigned = new Set();
    tries.forEach(s => {
        const dx = (s.vehicle.cur_x ?? s.vehicle.x) - lx;
        const dy = (s.vehicle.cur_y ?? s.vehicle.y) - ly;
        let best = -1, bestDist = Infinity;
        offsets.forEach((off, i) => {
            if (assigned.has(i)) return;
            const d = Math.hypot(dx - off.x, dy - off.y);
            if (d < bestDist) { bestDist = d; best = i; }
        });
        if (best >= 0) { assigned.add(best); s.vehicle.formation_slot = best; }
    });
}

// Déplace chaque groupe (et chaque solo) vers le même point cible, indépendamment.
function deplacerGroupesVers(selectedVehicles, cx, cy) {
    const groupeIds = new Set();
    selectedVehicles.forEach(s => {
        const gid = s.vehicle.groupe_id;
        if (gid != null) {
            if (!groupeIds.has(gid)) {
                groupeIds.add(gid);
                const membres = selectedVehicles.filter(sv => sv.vehicle.groupe_id === gid);
                const tries = [...membres].sort((a, b) =>
                    (a.vehicle.formation_slot ?? Infinity) - (b.vehicle.formation_slot ?? Infinity));
                normaliserParPosition(tries);
                const maxSl = tries.reduce((m, s) => Math.max(m, s.vehicle.formation_slot ?? 0), 0);
                const fpos = positionsFormation(Math.max(tries.length, maxSl + 1), cx, cy);
                const leaderPos = fpos[0] ?? { x: cx, y: cy };
                tries.forEach(({ base, vehicle }) => {
                    const sl = vehicle.formation_slot ?? 0;
                    deplacerVehicule(base, vehicle,
                        fpos[Math.min(sl, fpos.length - 1)].x,
                        fpos[Math.min(sl, fpos.length - 1)].y);
                });
                if (typeof planifierCheminGroupe !== 'undefined')
                    planifierCheminGroupe(gid, leaderPos.x, leaderPos.y);
            }
        } else {
            deplacerVehicule(s.base, s.vehicle, cx, cy);
        }
    });
}

// Déplace plusieurs groupes vers un point en grille 2D compacte.
// ceil(sqrt(n)) colonnes × rangées, centré sur le point :
// 2 groupes → côte à côte, 4 → carré 2×2, 6 → 3×2, etc.
// Rangée 0 = la plus proche du point (groupes les plus proches de la destination).
function deplacerVersPoint(selectedVehicles, cx, cy) {
    const groupesMap = new Map();
    const solos = [];

    selectedVehicles.forEach(s => {
        const gid = s.vehicle.groupe_id;
        if (gid != null) {
            if (!groupesMap.has(gid)) groupesMap.set(gid, { membres: [] });
            groupesMap.get(gid).membres.push(s);
        } else {
            solos.push(s);
        }
    });

    // Direction d'approche (centroïde → destination)
    let centX = 0, centY = 0, ng = 0;
    groupesMap.forEach(({ membres }) =>
        membres.forEach(({ vehicle: v }) => { centX += v.cur_x ?? v.x; centY += v.cur_y ?? v.y; ng++; })
    );
    if (ng) { centX /= ng; centY /= ng; }
    const ad = Math.hypot(cx - centX, cy - centY);
    const ux = ad > 1 ? (cx - centX) / ad : 1;
    const uy = ad > 1 ? (cy - centY) / ad : 0;
    const px = -uy, py = ux; // axe perpendiculaire

    // Préparer les groupes avec position latérale et distance
    const groups = [...groupesMap.entries()].map(([gid, data]) => {
        const v = data.membres[0]?.vehicle;
        const vx = v?.cur_x ?? v?.x ?? cx, vy = v?.cur_y ?? v?.y ?? cy;
        const dist    = Math.hypot(vx - cx, vy - cy);
        const lateral = (vx - cx) * px + (vy - cy) * py; // position perpendiculaire
        const rayon   = (typeof _tousLescercles !== 'undefined' && _tousLescercles[Number(gid)])
            ? _tousLescercles[Number(gid)].rayon : data.membres.length * 25;
        return { gid: Number(gid), data, dist, lateral, rayon };
    });

    const n = groups.length + solos.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const maxRadius = groups.reduce((m, g) => Math.max(m, g.rayon), 50);
    const gap = maxRadius * 2;

    // Assigner les colonnes par position latérale (gauche → col 0, droite → col max)
    // → évite les croisements de chemins
    const byLateral = [...groups].sort((a, b) => a.lateral - b.lateral);
    byLateral.forEach((g, i) => {
        g.col = groups.length > 1 ? Math.floor(i * cols / groups.length) : 0;
    });

    // Dans chaque colonne, trier par distance → le plus proche = rangée 0
    const byCol = {};
    groups.forEach(g => { (byCol[g.col] ??= []).push(g); });
    Object.values(byCol).forEach(col => {
        col.sort((a, b) => a.dist - b.dist);
        col.forEach((g, row) => { g.row = row; });
    });

    // Position dans la grille (centrée par rangée)
    const gridPos = (row, col, rowTotal) => {
        const offset = col - (rowTotal - 1) / 2;
        return {
            x: cx - ux * row * gap + px * offset * gap,
            y: cy - uy * row * gap + py * offset * gap
        };
    };

    const placeGroupe = (membres, posX, posY, gid) => {
        const tries = [...membres].sort((a, b) =>
            (a.vehicle.formation_slot ?? Infinity) - (b.vehicle.formation_slot ?? Infinity));
        normaliserParPosition(tries);
        const maxSl = tries.reduce((m, s) => Math.max(m, s.vehicle.formation_slot ?? 0), 0);
        const fpos = positionsFormation(Math.max(tries.length, maxSl + 1), posX, posY);
        const leaderPos = fpos[0] ?? { x: posX, y: posY };
        tries.forEach(({ base, vehicle }) => {
            const sl = vehicle.formation_slot ?? 0;
            deplacerVehicule(base, vehicle,
                fpos[Math.min(sl, fpos.length - 1)].x,
                fpos[Math.min(sl, fpos.length - 1)].y);
        });
        if (gid != null && typeof planifierCheminGroupe !== 'undefined')
            planifierCheminGroupe(gid, leaderPos.x, leaderPos.y);
    };

    // Nombre de groupes par rangée (pour centrage)
    const rowCounts = {};
    groups.forEach(g => { rowCounts[g.row] = (rowCounts[g.row] ?? 0) + 1; });

    groups.forEach(g => {
        const { x, y } = gridPos(g.row, g.col, rowCounts[g.row] ?? 1);
        placeGroupe(g.data.membres, x, y, g.gid);
    });

    // Solos à la suite
    const maxRow = groups.length ? Math.max(...groups.map(g => g.row)) + 1 : 0;
    solos.forEach((s, i) => {
        const { x, y } = gridPos(maxRow + Math.floor(i / cols), i % cols, Math.min(cols, solos.length - Math.floor(i / cols) * cols));
        deplacerVehicule(s.base, s.vehicle, x, y);
    });
}
