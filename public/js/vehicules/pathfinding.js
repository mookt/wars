// ============================================================
//  PATHFINDING.JS — Collision dure + A* sur grille virtuelle
// ============================================================

const PF_RAYON_MIN      = 32;
const PF_RECOMPUTE_MS   = 500;
const PF_PROFONDEUR_MAX = 6;
let   _pfLastCalcGlobal = 0; // un seul A* par frame max

// ── Min-heap pour A* (swap par variable temporaire, pas de destructuring) ──
class _PFHeap {
    constructor() { this._f = []; this._i = []; }
    push(f, idx) {
        this._f.push(f); this._i.push(idx);
        let i = this._f.length - 1;
        while (i > 0) {
            const p = (i-1) >> 1;
            if (this._f[p] <= this._f[i]) break;
            let tf = this._f[p]; this._f[p] = this._f[i]; this._f[i] = tf;
            let ti = this._i[p]; this._i[p] = this._i[i]; this._i[i] = ti;
            i = p;
        }
    }
    pop() {
        const topF = this._f[0], topI = this._i[0];
        const lf = this._f.pop(), li = this._i.pop();
        if (this._f.length > 0) {
            this._f[0] = lf; this._i[0] = li;
            let i = 0;
            while (true) {
                let m = i, l = 2*i+1, r = 2*i+2;
                if (l < this._f.length && this._f[l] < this._f[m]) m = l;
                if (r < this._f.length && this._f[r] < this._f[m]) m = r;
                if (m === i) break;
                let tf = this._f[m]; this._f[m] = this._f[i]; this._f[i] = tf;
                let ti = this._i[m]; this._i[m] = this._i[i]; this._i[i] = ti;
                i = m;
            }
        }
        return topI;
    }
    get size() { return this._f.length; }
}

// ── A* sur grille virtuelle ───────────────────────────────────
// obstacles = [{cx, cy, rayon}] déjà gonflés par gcRayon
// Retourne [{x,y},...] ou null si aucun chemin trouvé
function pfAstar(sx, sy, ex, ey, obstacles) {
    // Padding large pour permettre les grands contournements
    const dist = Math.hypot(ex-sx, ey-sy);
    const maxR = obstacles.reduce((m, o) => Math.max(m, o.rayon), 0);
    const PAD  = Math.max(400, dist * 1.2, maxR * 5);
    const minX = Math.min(sx, ex) - PAD, minY = Math.min(sy, ey) - PAD;
    const maxX = Math.max(sx, ex) + PAD, maxY = Math.max(sy, ey) + PAD;

    // Résolution adaptée : max 150×150 cellules
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const res  = Math.max(span / 150, 8);

    const cols = Math.ceil((maxX - minX) / res) + 1;
    const rows = Math.ceil((maxY - minY) / res) + 1;

    // Grille de blocage
    const blocked = new Uint8Array(cols * rows);
    for (const o of obstacles) {
        const ry2 = o.rayonY ?? o.rayon;
        const c0 = Math.max(0, Math.floor((o.cx - o.rayon - minX) / res));
        const c1 = Math.min(cols-1, Math.ceil((o.cx + o.rayon - minX) / res));
        const r0 = Math.max(0, Math.floor((o.cy - ry2 - minY) / res));
        const r1 = Math.min(rows-1, Math.ceil((o.cy + ry2 - minY) / res));
        for (let rr = r0; rr <= r1; rr++)
            for (let cc = c0; cc <= c1; cc++) {
                const wx = minX + cc*res, wy = minY + rr*res;
                if (_pfDansObstacle(wx, wy, o))
                    blocked[rr*cols + cc] = 1;
            }
    }

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
    const sc = clamp((sx-minX)/res, 0, cols-1);
    const sr = clamp((sy-minY)/res, 0, rows-1);
    let ec = clamp((ex-minX)/res, 0, cols-1);
    let er = clamp((ey-minY)/res, 0, rows-1);

    const si = sr*cols + sc;
    if (blocked[si]) blocked[si] = 0; // débloquer départ si coincé

    // Si destination bloquée : BFS depuis la destination → s'arrête à la 1ère cellule libre
    let effectiveDest = null;
    if (blocked[er*cols + ec]) {
        const vis = new Uint8Array(cols*rows);
        const q = [er*cols + ec]; vis[er*cols + ec] = 1;
        let head = 0, found = false;
        const bfsD = [-1,0,1,-1,1,-1,0,1];
        const bfsR = [-1,-1,-1,0,0,1,1,1];
        while (head < q.length && !found) {
            const cur = q[head++];
            const cc = cur % cols, cr = (cur/cols)|0;
            for (let d = 0; d < 8; d++) {
                const nc = cc+bfsD[d], nr = cr+bfsR[d];
                if (nc<0||nc>=cols||nr<0||nr>=rows) continue;
                const ni = nr*cols+nc;
                if (vis[ni]) continue; vis[ni] = 1;
                if (!blocked[ni]) {
                    ec = nc; er = nr;
                    effectiveDest = { x: minX+ec*res, y: minY+er*res };
                    found = true; break;
                }
                q.push(ni);
            }
        }
        if (!found) return null;
    }
    const ei = er*cols + ec;

    const g      = new Float32Array(cols*rows).fill(Infinity);
    const par    = new Int32Array(cols*rows).fill(-1);
    const closed = new Uint8Array(cols*rows); // empêche de traiter un nœud 2 fois
    g[si] = 0;

    const heap = new _PFHeap();
    heap.push(Math.hypot(ec-sc, er-sr)*res, si);

    const dC    = [-1,0,1,-1,1,-1,0,1];
    const dR    = [-1,-1,-1,0,0,1,1,1];
    const dCost = [1.414,1,1.414,1,1,1.414,1,1.414];

    while (heap.size > 0) {
        const idx = heap.pop();
        if (closed[idx]) continue; // déjà traité avec un coût optimal
        closed[idx] = 1;
        if (idx === ei) break;
        const cc = idx % cols, cr = (idx/cols)|0;
        const gc = g[idx];
        for (let d = 0; d < 8; d++) {
            const nc = cc+dC[d], nr = cr+dR[d];
            if (nc<0||nc>=cols||nr<0||nr>=rows) continue;
            const ni = nr*cols + nc;
            if (blocked[ni] || closed[ni]) continue;
            const ng = gc + dCost[d]*res;
            if (ng < g[ni]) {
                g[ni] = ng; par[ni] = idx;
                heap.push(ng + Math.hypot(ec-nc, er-nr)*res, ni);
            }
        }
    }

    if (g[ei] === Infinity) return null;

    // Reconstruction du chemin
    const path = [];
    let idx = ei;
    while (idx !== si && idx !== -1) {
        const cc = idx % cols, cr = (idx/cols)|0;
        path.unshift({ x: minX + cc*res, y: minY + cr*res });
        idx = par[idx];
    }
    // Destination finale : ajustée si bloquée, originale sinon
    const finalDest = effectiveDest ?? { x: ex, y: ey };
    if (path.length === 0 || Math.hypot(path[path.length-1].x - finalDest.x, path[path.length-1].y - finalDest.y) > res)
        path.push(finalDest);

    return { path, effectiveDest };
}

// ── Collision dure ─────────────────────────────────────────────

function pfObstaclesGroupe(obsPathfinding, gid, gcRayon) {
    return obsPathfinding
        .filter(o => o.gid !== Number(gid))
        .map(o => ({
            cx: o.cx, cy: o.cy,
            rayon:  o.rayon  + gcRayon,
            rayonY: o.rayonY ? o.rayonY + gcRayon : null,
            isBase: o.isBase || false
        }));
}

// Teste si (x,y) est dans l'obstacle (cercle ou ellipse)
function _pfDansObstacle(x, y, o) {
    const dx = x - o.cx, dy = y - o.cy;
    if (o.isBase && o.rayonY)
        return dx*dx/(o.rayon*o.rayon) + dy*dy/(o.rayonY*o.rayonY) <= 1;
    return dx*dx + dy*dy <= o.rayon*o.rayon;
}

// Normale sortante en (x,y) sur l'obstacle
function _pfNormale(x, y, o) {
    const dx = x - o.cx, dy = y - o.cy;
    let nx, ny;
    if (o.isBase && o.rayonY) {
        nx = dx / (o.rayon  * o.rayon);
        ny = dy / (o.rayonY * o.rayonY);
    } else {
        nx = dx; ny = dy;
    }
    const len = Math.hypot(nx, ny);
    return len < 1e-9 ? { nx:1, ny:0 } : { nx:nx/len, ny:ny/len };
}

function pfResoudrePenetrations(px, py, obstacles) {
    let x = px, y = py;
    for (let pass = 0; pass < 3; pass++) {
        for (const o of obstacles) {
            if (!_pfDansObstacle(x, y, o)) continue;
            const dx = x - o.cx, dy = y - o.cy;
            if (o.isBase && o.rayonY) {
                // Projeter sur la frontière de l'ellipse
                const t = 1 / Math.sqrt(
                    dx*dx/(o.rayon*o.rayon) + dy*dy/(o.rayonY*o.rayonY)
                );
                x = o.cx + dx * t * 1.02;
                y = o.cy + dy * t * 1.02;
            } else {
                const d = Math.hypot(dx, dy);
                if (d > 0.001) { x = o.cx+(dx/d)*(o.rayon+0.5); y = o.cy+(dy/d)*(o.rayon+0.5); }
            }
        }
    }
    return { x, y };
}

function pfClipperVelocite(px, py, vx, vy, obstacles) {
    let rx = vx, ry = vy;
    for (const o of obstacles) {
        if (!_pfDansObstacle(px+rx, py+ry, o)) continue;
        const { nx: nnx, ny: nny } = _pfNormale(px, py, o);
        const dot = rx*nnx + ry*nny;
        if (dot < 0) { rx -= dot*nnx; ry -= dot*nny; }
    }
    return { vx:rx, vy:ry };
}

// ── Pathfinding par tangentes ──────────────────────────────────

function _pfSegCercle(ax, ay, bx, by, cx, cy, r) {
    const dx=bx-ax, dy=by-ay, fx=ax-cx, fy=ay-cy;
    const a=dx*dx+dy*dy;
    if (a<1e-9) return Math.hypot(fx,fy)<r;
    const b=2*(fx*dx+fy*dy), c=fx*fx+fy*fy-r*r;
    const disc=b*b-4*a*c;
    if (disc<0) return false;
    const sq=Math.sqrt(disc), t1=(-b-sq)/(2*a), t2=(-b+sq)/(2*a);
    return (t1>=0&&t1<=1)||(t2>=0&&t2<=1)||(t1<0&&t2>1);
}

function _pfPremierObstacle(ax, ay, bx, by, obstacles) {
    const dx=bx-ax, dy=by-ay;
    let tMin=Infinity, best=null;
    for (const o of obstacles) {
        const fx=ax-o.cx, fy=ay-o.cy, a=dx*dx+dy*dy;
        if (a<1e-9) continue;
        const b=2*(fx*dx+fy*dy), c=fx*fx+fy*fy-o.rayon*o.rayon;
        const disc=b*b-4*a*c;
        if (disc<0) continue;
        const sq=Math.sqrt(disc);
        const t1=(-b-sq)/(2*a), t2=(-b+sq)/(2*a);
        const t=(t1>=0&&t1<=1)?t1:(t2>=0&&t2<=1)?t2:(t1<0&&t2>1)?0:Infinity;
        if (t<tMin){tMin=t;best=o;}
    }
    return best;
}

function _pfTangentes(px, py, cx, cy, r) {
    const d2=(cx-px)**2+(cy-py)**2, d=Math.sqrt(d2);
    if (d<=r) return null;
    const phi=Math.asin(Math.min(1,r/d)), theta=Math.atan2(cy-py,cx-px);
    const L=Math.sqrt(Math.max(0,d2-r*r));
    return [
        {x:px+L*Math.cos(theta+phi), y:py+L*Math.sin(theta+phi)},
        {x:px+L*Math.cos(theta-phi), y:py+L*Math.sin(theta-phi)}
    ];
}

function _pfLongueur(sx, sy, pts) {
    let l=0, x=sx, y=sy;
    for (const p of pts){l+=Math.hypot(p.x-x,p.y-y);x=p.x;y=p.y;}
    return l;
}

function pfCalculerChemin(sx, sy, ex, ey, obstacles, profondeur) {
    profondeur = profondeur||0;
    const bloquant = _pfPremierObstacle(sx, sy, ex, ey, obstacles);
    if (!bloquant) return [{x:ex,y:ey}];
    if (profondeur >= PF_PROFONDEUR_MAX) return [{x:ex,y:ey}];

    const tgs = _pfTangentes(sx, sy, bloquant.cx, bloquant.cy, bloquant.rayon);
    if (!tgs) {
        // Départ à l'intérieur du cercle fusionné :
        // lancer un rayon DEPUIS S (pas depuis le centre) → exit le plus proche
        const pathLen = Math.hypot(ex-sx, ey-sy);
        if (pathLen < 0.01) return [{x:ex,y:ey}];
        const pxn = (ex-sx)/pathLen, pyn = (ey-sy)/pathLen;

        function rayExit(dirX, dirY) {
            const nx = sx - bloquant.cx, ny = sy - bloquant.cy;
            const dot = nx*dirX + ny*dirY;
            const disc = dot*dot - (nx*nx + ny*ny - bloquant.rayon*bloquant.rayon);
            if (disc < 0) return null;
            const t = -dot + Math.sqrt(disc);
            return { x: sx + dirX*t*1.02, y: sy + dirY*t*1.02 };
        }
        const exitL = rayExit(-pyn,  pxn) ?? { x: bloquant.cx + bloquant.rayon*(-pyn), y: bloquant.cy + bloquant.rayon*pxn };
        const exitR = rayExit( pyn, -pxn) ?? { x: bloquant.cx + bloquant.rayon*pyn,    y: bloquant.cy + bloquant.rayon*(-pxn) };

        // Si les exits sont plus loin que la destination, aller directement
        if (Math.min(Math.hypot(exitL.x-sx, exitL.y-sy),
                     Math.hypot(exitR.x-sx, exitR.y-sy)) > pathLen)
            return [{x:ex,y:ey}];

        const pathL = [exitL, ...pfCalculerChemin(exitL.x, exitL.y, ex, ey, obstacles, profondeur+1)];
        const pathR = [exitR, ...pfCalculerChemin(exitR.x, exitR.y, ex, ey, obstacles, profondeur+1)];
        return _pfLongueur(sx, sy, pathL) <= _pfLongueur(sx, sy, pathR) ? pathL : pathR;
    }

    const sansBloquant = obstacles.filter(o=>o!==bloquant);
    const options = tgs.map(t => [
        ...pfCalculerChemin(sx,sy,t.x,t.y,sansBloquant,profondeur+1),
        ...pfCalculerChemin(t.x,t.y,ex,ey,obstacles,profondeur+1)
    ]);
    return _pfLongueur(sx,sy,options[0]) <= _pfLongueur(sx,sy,options[1])
        ? options[0] : options[1];
}

// ── Fusion des obstacles trop proches ─────────────────────────

function pfFusionnerObstacles(obstacles) {
    const result = obstacles.map(o => ({ cx:o.cx, cy:o.cy, rayon:o.rayon }));
    let changed = true;
    while (changed) {
        changed = false;
        outer: for (let i = 0; i < result.length; i++) {
            for (let j = i+1; j < result.length; j++) {
                const d = Math.hypot(result[i].cx-result[j].cx, result[i].cy-result[j].cy);
                if (d < result[i].rayon + result[j].rayon) {
                    const cx    = (result[i].cx + result[j].cx) / 2;
                    const cy    = (result[i].cy + result[j].cy) / 2;
                    // Rayon plafonné : évite les cercles géants qui créent des détours absurdes
                    const rayonBrut = d / 2 + Math.max(result[i].rayon, result[j].rayon);
                    const rayon = Math.min(rayonBrut, Math.max(result[i].rayon, result[j].rayon) * 1.4);
                    result.splice(j, 1);
                    result[i] = { cx, cy, rayon };
                    changed = true;
                    break outer;
                }
            }
        }
    }
    return result;
}

// ── Lissage du chemin (string pulling) ────────────────────────

function pfOptimiserChemin(sx, sy, waypoints, obstacles) {
    if (waypoints.length <= 1) return [...waypoints];
    const result = [];
    let cx = sx, cy = sy;
    let reste = [...waypoints];
    while (reste.length > 0) {
        let idx = 0;
        for (let j = reste.length - 1; j > 0; j--) {
            if (!_pfPremierObstacle(cx, cy, reste[j].x, reste[j].y, obstacles)) {
                idx = j; break;
            }
        }
        result.push(reste[idx]);
        cx = reste[idx].x; cy = reste[idx].y;
        reste = reste.slice(idx + 1);
    }
    return result;
}

// ── Gestion des waypoints ──────────────────────────────────────

function pfMettreAJourChemin(ref, gcx, gcy, obsElargis, now) {
    const cibleChangee = !ref._pfTarget ||
        Math.hypot(ref._pfTarget.x - ref.x, ref._pfTarget.y - ref.y) > 2;
    if (cibleChangee) ref._reachedDest = false; // nouvelle cible = on repart

    const delaiEcoule = (now - (ref._pfLastCalc || 0)) > PF_RECOMPUTE_MS;
    if (cibleChangee || (delaiEcoule && !ref._effectiveDest && !ref._reachedDest)) {
        // Rate limiter : un seul A* par frame pour éviter les freezes
        if (!cibleChangee && now - _pfLastCalcGlobal < 16) return;
        _pfLastCalcGlobal = now;

        // Filtrer par distance à la ligne start→dest (pas juste au départ)
        const _dx = ref.x - gcx, _dy = ref.y - gcy, _len2 = _dx*_dx + _dy*_dy;
        const obsProches = obsElargis.filter(o => {
            if (_len2 < 1) return Math.hypot(o.cx - gcx, o.cy - gcy) < DISTANCE_MAX_REJOINDRE * 2;
            const t = Math.max(0, Math.min(1, ((o.cx-gcx)*_dx + (o.cy-gcy)*_dy) / _len2));
            const nearX = gcx + t*_dx, nearY = gcy + t*_dy;
            return Math.hypot(o.cx - nearX, o.cy - nearY) < DISTANCE_MAX_REJOINDRE + o.rayon;
        });
        // A* primaire avec budget temps (max 10ms), tangentes en fallback
        const t0 = performance.now();
        const astarResult = pfAstar(gcx, gcy, ref.x, ref.y, obsProches);
        if (performance.now() - t0 > 10)
            console.warn('[PF] A* lent :', Math.round(performance.now()-t0), 'ms');
        let chemin;
        if (astarResult) {
            chemin = astarResult.path;
            ref._effectiveDest = astarResult.effectiveDest; // null si dest originale atteinte
        } else {
            const obsFus = pfFusionnerObstacles(obsProches);
            chemin = pfCalculerChemin(gcx, gcy, ref.x, ref.y, obsFus);
            ref._effectiveDest = null;
        }
        ref._waypoints = pfOptimiserChemin(gcx, gcy, chemin, obsProches);
        ref._pfTarget  = { x: ref.x, y: ref.y };
        ref._pfLastCalc = now;
    }
}

function pfAvancerWaypoints(ref, gcx, gcy, seuil) {
    if (!ref._waypoints) return;
    while (ref._waypoints.length > 1 &&
           Math.hypot(ref._waypoints[0].x-gcx, ref._waypoints[0].y-gcy) < seuil)
        ref._waypoints.shift();
}
