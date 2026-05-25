// ── Images de la base ────────────────────────────────────────
const imgBaseBeton = new Image();
imgBaseBeton.onload  = () => console.log('✅ base_beton.png chargée :', imgBaseBeton.naturalWidth, 'x', imgBaseBeton.naturalHeight);
imgBaseBeton.onerror = () => console.error('❌ base_beton.png introuvable');
imgBaseBeton.src = '/assets/bases/base_beton.png';
const BETON_FRAMES = 10;
const BETON_OFFSET_X = -175, BETON_OFFSET_Y = +80, BETON_SCALE = 1;

const imgBaseAcier = new Image();
imgBaseAcier.src = '/assets/bases/base_acier.png';
const ACIER_FRAMES = 10;
const ACIER_OFFSET_X = +100, ACIER_OFFSET_Y = +50, ACIER_SCALE = 1;

const imgBaseCharbon = new Image();
imgBaseCharbon.src = '/assets/bases/base_charbon.png';
const CHARBON_FRAMES = 10;
const CHARBON_OFFSET_X = -175, CHARBON_OFFSET_Y = -100, CHARBON_SCALE = 1;

const imgBaseCarburant = new Image();
imgBaseCarburant.src = '/assets/bases/base_carburant.png';
const CARBURANT_FRAMES = 10;
const CARBURANT_OFFSET_X = +200, CARBURANT_OFFSET_Y = -100, CARBURANT_SCALE = 1;


const imgBase      = new Image();
const imgMur1      = new Image(); imgMur1.src      = '/assets/bases/mur1.png';
const imgMur2      = new Image(); imgMur2.src      = '/assets/bases/mur2.png';
const imgMur1Beton = new Image(); imgMur1Beton.src = '/assets/bases/mur1Beton.png';
const imgMur2Beton = new Image(); imgMur2Beton.src = '/assets/bases/mur2Beton.png';
const imgNiche     = new Image(); imgNiche.src     = '/assets/bases/niche.png';

// Canvas pré-rendu de la base avec fondu sur les bords
let maskedBase = null;

function preparerBaseMasquee() {
    const bw = imgBase.naturalWidth, bh = imgBase.naturalHeight;
    const tmp = document.createElement('canvas');
    tmp.width = bw; tmp.height = bh;
    const t = tmp.getContext('2d');

    // Dessine l'image originale
    t.drawImage(imgBase, 0, 0);

    // Applique un masque elliptique pour fondre les bords dans la transparence
    t.globalCompositeOperation = 'destination-in';
    t.save();
    t.translate(bw / 2, bh / 2);
    t.scale(bw / bh, 1); // étire horizontalement pour avoir une ellipse
    const r = bh / 2;
    const grad = t.createRadialGradient(0, 0, r * 0.85, 0, 0, r * 0.99);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    t.fillStyle = grad;
    t.fillRect(-bw, -bh, bw * 2, bh * 2);
    t.restore();

    maskedBase = tmp;
}

imgBase.onload = preparerBaseMasquee;
imgBase.src = '/assets/bases/base1.png';

// ── Minimap ──────────────────────────────────────────────────
const miniCanvas = document.getElementById('minimap-canvas');
const miniCtx    = miniCanvas.getContext('2d');
const MW = 200, MH = 200;

function posToMapPx(px, py) {
    return { mx: (px / 5000) * MAP_W, my: (py / 5000) * MAP_H };
}

// ── Dessin d'une base ────────────────────────────────────────
function dessinerBase(sx, sy, estMoi, nom, murs_beton, beton_niveau, acier_niveau, charbon_niveau, carburant_niveau, neutre) {
    const bw = maskedBase ? maskedBase.width  : (imgBase.naturalWidth  || 400);
    const bh = maskedBase ? maskedBase.height : (imgBase.naturalHeight || 400);
    const hw = bw / 2, hh = bh / 2;
    const marge = Math.max(bw, bh);

    if (sx < -marge || sx > canvas.width + marge || sy < -marge || sy > canvas.height + marge) return;

    const couleur = neutre ? '#aaaaaa' : (estMoi ? '#00c850' : '#ff6622');

    // Halo
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, marge * 0.7);
    grad.addColorStop(0, estMoi ? 'rgba(0,200,80,0.18)' : 'rgba(255,102,34,0.18)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(sx, sy, marge * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Intérieur (avec fondu de bords si disponible)
    if (maskedBase) {
        ctx.drawImage(maskedBase, sx - hw, sy - hh, bw, bh);
    } else if (imgBase.complete && imgBase.naturalWidth > 0) {
        ctx.drawImage(imgBase, sx - hw, sy - hh, bw, bh);
    } else {
        ctx.beginPath();
        ctx.arc(sx, sy, hw, 0, Math.PI * 2);
        ctx.fillStyle = estMoi ? '#0c1e12' : '#20100a';
        ctx.fill();
    }

    // Murs (normal ou béton selon état en BDD)
    const beton = !!murs_beton;
    const src1  = (beton && imgMur1Beton.complete && imgMur1Beton.naturalWidth > 0) ? imgMur1Beton : imgMur1;
    const src2  = (beton && imgMur2Beton.complete && imgMur2Beton.naturalWidth > 0) ? imgMur2Beton : imgMur2;

    if (src1.complete && src1.naturalWidth > 0) {
        const mw = src1.naturalWidth, mh = src1.naturalHeight;
        ctx.drawImage(src1, sx - mw / 2 - 550, sy - mh / 2 + 50, mw, mh);
    }
    if (src2.complete && src2.naturalWidth > 0) {
        const mw = src2.naturalWidth, mh = src2.naturalHeight;
        ctx.drawImage(src2, sx - mw / 2 - 150, sy - mh / 2 + 200, mw, mh);
    }

    // Niche
    if (imgNiche.complete && imgNiche.naturalWidth > 0) {
        const nw = imgNiche.naturalWidth * 0.15, nh = imgNiche.naturalHeight * 0.15;
        ctx.drawImage(imgNiche, sx - nw / 2 -400, sy - nh / 2 + 115, nw, nh);
    }

    // Bâtiment béton
    {
        const niv = Math.min(10, Math.max(0, beton_niveau ?? 0));
        const bx = sx + BETON_OFFSET_X, by = sy + BETON_OFFSET_Y;
        if (imgBaseBeton.complete && imgBaseBeton.naturalWidth > 0) {
            const fw = imgBaseBeton.naturalWidth / BETON_FRAMES;
            const fh = imgBaseBeton.naturalHeight;
            const bw = fw * BETON_SCALE, bh = fh * BETON_SCALE;
            const frameIdx = niv === 0 ? 0 : niv - 1;
            ctx.drawImage(imgBaseBeton, frameIdx * fw, 0, fw, fh, bx - bw / 2, by - bh / 2, bw, bh);
        } else {
            ctx.fillStyle = niv > 0 ? 'rgba(200,168,50,0.8)' : 'rgba(100,80,20,0.5)';
            ctx.fillRect(bx - 20, by - 20, 40, 40);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`B${niv}`, bx, by + 4);
        }
    }

    // Bâtiment acier
    {
        const niv = Math.min(10, Math.max(0, acier_niveau ?? 0));
        const bx = sx + ACIER_OFFSET_X, by = sy + ACIER_OFFSET_Y;
        if (imgBaseAcier.complete && imgBaseAcier.naturalWidth > 0) {
            const fw = imgBaseAcier.naturalWidth / ACIER_FRAMES;
            const fh = imgBaseAcier.naturalHeight;
            const bw = fw * ACIER_SCALE, bh = fh * ACIER_SCALE;
            const frameIdx = niv === 0 ? 0 : niv - 1;
            ctx.drawImage(imgBaseAcier, frameIdx * fw, 0, fw, fh, bx - bw / 2, by - bh / 2, bw, bh);
        } else {
            ctx.fillStyle = niv > 0 ? 'rgba(138,184,216,0.8)' : 'rgba(60,90,110,0.5)';
            ctx.fillRect(bx - 20, by - 20, 40, 40);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`A${niv}`, bx, by + 4);
        }
    }

    // Bâtiment charbon
    {
        const niv = Math.min(10, Math.max(0, charbon_niveau ?? 0));
        const bx = sx + CHARBON_OFFSET_X, by = sy + CHARBON_OFFSET_Y;
        if (imgBaseCharbon.complete && imgBaseCharbon.naturalWidth > 0) {
            const fw = imgBaseCharbon.naturalWidth / CHARBON_FRAMES;
            const fh = imgBaseCharbon.naturalHeight;
            const bw = fw * CHARBON_SCALE, bh = fh * CHARBON_SCALE;
            const frameIdx = niv === 0 ? 0 : niv - 1;
            ctx.drawImage(imgBaseCharbon, frameIdx * fw, 0, fw, fh, bx - bw / 2, by - bh / 2, bw, bh);
        } else {
            ctx.fillStyle = niv > 0 ? 'rgba(144,144,144,0.8)' : 'rgba(60,60,60,0.5)';
            ctx.fillRect(bx - 20, by - 20, 40, 40);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`C${niv}`, bx, by + 4);
        }
    }

    // Bâtiment carburant
    {
        const niv = Math.min(10, Math.max(0, carburant_niveau ?? 0));
        const bx = sx + CARBURANT_OFFSET_X, by = sy + CARBURANT_OFFSET_Y;
        if (imgBaseCarburant.complete && imgBaseCarburant.naturalWidth > 0) {
            const fw = imgBaseCarburant.naturalWidth / CARBURANT_FRAMES;
            const fh = imgBaseCarburant.naturalHeight;
            const bw = fw * CARBURANT_SCALE, bh = fh * CARBURANT_SCALE;
            const frameIdx = niv === 0 ? 0 : niv - 1;
            ctx.drawImage(imgBaseCarburant, frameIdx * fw, 0, fw, fh, bx - bw / 2, by - bh / 2, bw, bh);
        } else {
            ctx.fillStyle = niv > 0 ? 'rgba(232,136,32,0.8)' : 'rgba(110,60,10,0.5)';
            ctx.fillRect(bx - 20, by - 20, 40, 40);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`F${niv}`, bx, by + 4);
        }
    }

    // Nom
    ctx.font = `bold 14px 'Rajdhani', sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = couleur;
    ctx.shadowBlur  = 8;
    ctx.fillStyle   = couleur;
    ctx.fillText(nom, sx, sy - hh - 10);
    ctx.shadowBlur  = 0;

}

function _dessinerLosange(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x,     y - r);
    ctx.lineTo(x + r, y    );
    ctx.lineTo(x,     y + r);
    ctx.lineTo(x - r, y    );
    ctx.closePath();
}

function dessinerMinimap() {
    // ── Fond tactique uni (évite le bruit visuel du terrain 8000→200) ──
    const grad = miniCtx.createRadialGradient(MW/2, MH/2, 0, MW/2, MH/2, MW * 0.7);
    grad.addColorStop(0, '#0d1a0e');
    grad.addColorStop(1, '#060d07');
    miniCtx.fillStyle = grad;
    miniCtx.fillRect(0, 0, MW, MH);

    // ── Grille tactique (subtile) ──────────────────────────────
    miniCtx.strokeStyle = 'rgba(0,200,80,0.08)';
    miniCtx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const x = i * MW / 4, y = i * MH / 4;
        miniCtx.beginPath(); miniCtx.moveTo(x, 0); miniCtx.lineTo(x, MH); miniCtx.stroke();
        miniCtx.beginPath(); miniCtx.moveTo(0, y); miniCtx.lineTo(MW, y); miniCtx.stroke();
    }

    // ── Bases ─────────────────────────────────────────────────
    bases.forEach(b => {
        const bx = b.pos_x / 5000 * MW;
        const by = b.pos_y / 5000 * MH;
        const estMoi    = b.joueur_id == joueur_id;
        const estNeutre = !b.joueur_id || b.neutre;
        const couleur   = estNeutre ? '#888888' : (estMoi ? '#00ff66' : '#ff3333');
        const r         = estMoi ? 5 : 4;

        miniCtx.save();
        // Halo lumineux
        miniCtx.shadowColor = couleur;
        miniCtx.shadowBlur  = estNeutre ? 4 : 10;

        // Losange rempli
        _dessinerLosange(miniCtx, bx, by, r);
        miniCtx.fillStyle = couleur + (estNeutre ? '88' : 'cc');
        miniCtx.fill();

        // Bordure blanche fine
        miniCtx.shadowBlur  = 0;
        _dessinerLosange(miniCtx, bx, by, r);
        miniCtx.strokeStyle = estNeutre ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.6)';
        miniCtx.lineWidth   = 0.8;
        miniCtx.stroke();

        miniCtx.restore();
    });

    // ── Groupes de véhicules ──────────────────────────────────
    if (typeof _tousLescercles !== 'undefined') {
        const groupesVus = new Set();
        bases.forEach(base => {
            if (!base.vehicules) return;
            base.vehicules.forEach(v => {
                if (!v.construit || !v.groupe_id || v.cur_x == null || v.type === 'sam') return;
                if (groupesVus.has(v.groupe_id)) return;
                groupesVus.add(v.groupe_id);
                const gc = _tousLescercles[v.groupe_id];
                if (!gc) return;
                const { mx, my } = posToMapPx(gc.cx, gc.cy);
                const mmx = mx / MAP_W * MW, mmy = my / MAP_H * MH;
                const estMoi  = base.joueur_id == joueur_id;
                const couleur = estMoi ? '#00ff88' : '#ff4444';
                miniCtx.save();
                miniCtx.shadowColor = couleur;
                miniCtx.shadowBlur  = 6;
                miniCtx.beginPath();
                miniCtx.arc(mmx, mmy, estMoi ? 2.5 : 2, 0, Math.PI * 2);
                miniCtx.fillStyle = couleur;
                miniCtx.fill();
                miniCtx.restore();
            });
        });
    }

    // ── Rectangle de vue caméra ───────────────────────────────
    const vx = camX / MAP_W * MW, vy = camY / MAP_H * MH;
    const vw = canvas.width / MAP_W * MW, vh = canvas.height / MAP_H * MH;
    miniCtx.save();
    miniCtx.strokeStyle = 'rgba(0,255,100,0.5)';
    miniCtx.lineWidth   = 0.8;
    miniCtx.setLineDash([3, 2]);
    miniCtx.strokeRect(vx, vy, vw, vh);
    miniCtx.restore();

    // ── Bordure extérieure de la minimap ──────────────────────
    miniCtx.strokeStyle = 'rgba(0,200,80,0.3)';
    miniCtx.lineWidth   = 1;
    miniCtx.setLineDash([]);
    miniCtx.strokeRect(0.5, 0.5, MW - 1, MH - 1);
}

// ── Compteur SAMs par base (sur la carte) ────────────────────
function dessinerCompteursSams() {
    bases.forEach(b => {
        if (!b.vehicules || !b.joueur_id) return;
        const sams   = b.vehicules.filter(v => v.type === 'sam' && v.construit);
        if (sams.length === 0) return;
        const vivant = sams.filter(v => (v.pv ?? 0) > 0).length;
        const { mx, my } = posToMapPx(b.pos_x, b.pos_y);
        const sx = mx - camX, sy = my - camY;
        const tx = sx + NICHE_OFFSET_X;
        const ty = sy + NICHE_OFFSET_Y - 28;
        const label = `🪖 ${vivant}/${sams.length}`;
        ctx.save();
        ctx.font = 'bold 11px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 4;
        const couleur = vivant === 0 ? '#ff4444' : vivant < sams.length ? '#ffaa00' : '#00c850';
        ctx.shadowColor = couleur;
        ctx.fillStyle   = couleur;
        ctx.fillText(label, tx, ty);
        ctx.restore();
    });
}

// ── Flashs de clic (cercles animés) ─────────────────────────
const clickFlashs = [];
function dessinerClickFlashs() {
    const now = Date.now();
    for (let i = clickFlashs.length - 1; i >= 0; i--) {
        const f    = clickFlashs[i];
        const dur  = f.duree ?? 600;
        const t    = (now - f.start) / dur;
        if (t > 1) { clickFlashs.splice(i, 1); continue; }
        ctx.save();
        if (f.type === 'move') {
            // Cercle gris mouvement : cercle qui s'agrandit + croix centrale
            const r = 6 + t * 28;
            ctx.globalAlpha = (1 - t) * 0.9;
            ctx.strokeStyle = f.couleur;
            ctx.lineWidth   = 2 * (1 - t * 0.5);
            ctx.shadowColor = f.couleur;
            ctx.shadowBlur  = 8;
            ctx.beginPath(); ctx.arc(f.sx, f.sy, r, 0, Math.PI * 2);
            ctx.stroke();
            // Petite croix au centre (fixe)
            const cr = 5 * (1 - t);
            ctx.globalAlpha = (1 - t) * 0.7;
            ctx.lineWidth   = 1.5;
            ctx.beginPath();
            ctx.moveTo(f.sx - cr, f.sy); ctx.lineTo(f.sx + cr, f.sy);
            ctx.moveTo(f.sx, f.sy - cr); ctx.lineTo(f.sx, f.sy + cr);
            ctx.stroke();
        } else {
            const r = 10 + t * 40;
            ctx.globalAlpha = (1 - t) * 0.85;
            ctx.strokeStyle = f.couleur;
            ctx.lineWidth   = 2.5 * (1 - t);
            ctx.shadowColor = f.couleur;
            ctx.shadowBlur  = 12;
            ctx.beginPath(); ctx.arc(f.sx, f.sy, r, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }
}

// ── Boucle principale ────────────────────────────────────────
function dessiner() {
    const W = canvas.width, H = canvas.height;
    ctx.drawImage(offscreen, camX, camY, W, H, 0, 0, W, H);

    bases.forEach(b => {
        const { mx, my } = posToMapPx(b.pos_x, b.pos_y);
        dessinerBase(mx - camX, my - camY, b.joueur_id == joueur_id, b.pseudo, b.murs_beton, b.beton_niveau, b.acier_niveau, b.charbon_niveau, b.carburant_niveau, b.neutre);
    });

    animerVehicules();
    dessinerZonesOccupees();
    dessinerVehicules();
    dessinerCompteursSams();
    dessinerClickFlashs();

    // Repositionner l'indicateur de construction (suit la caméra)
    if (typeof majIndicateurConstruction === 'function') majIndicateurConstruction();

    // Boîte de sélection (clic gauche drag)
    if (typeof selBox !== 'undefined' && selBox) {
        const x = Math.min(selBox.x1, selBox.x2), y = Math.min(selBox.y1, selBox.y2);
        const w = Math.abs(selBox.x2 - selBox.x1), h = Math.abs(selBox.y2 - selBox.y1);
        ctx.fillStyle   = 'rgba(0,200,80,0.06)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(0,200,80,0.75)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
    }

    dessinerMinimap();
    document.getElementById('hud-pos').textContent        = `X:${Math.round(camX)} Y:${Math.round(camY)}`;
    document.getElementById('minimap-coords').textContent = `X:${Math.round(camX)} Y:${Math.round(camY)}`;
    requestAnimationFrame(dessiner);
}
