// ── Zones occupées (obstacles pathfinding) ────────────────────
function dessinerZonesOccupees() {
    const echelle = MAP_W / 5000; // map units → pixels écran

    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;

    // Zones des groupes de véhicules : même bounding box que le contour vert
    const bbGroupes = {};
    bases.forEach(base => {
        if (!base.vehicules) return;
        base.vehicules.forEach(v => {
            if (!v.construit || v.cur_x == null || v.type === 'sam') return;
            const pos = getVehicleScreenPos(v);
            if (!pos) return;
            const img = getVehicleImg(v);
            const { frameWidth, frameHeight } = getVehicleSpriteSize(img);
            const hw = (frameWidth  * VEHICLE_SCALE) / 2;
            const hh = (frameHeight * VEHICLE_SCALE) / 2;
            const cle = v.groupe_id ? `g${v.groupe_id}` : `s${v.id}`;
            if (!bbGroupes[cle]) bbGroupes[cle] = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
            const b = bbGroupes[cle];
            b.minX = Math.min(b.minX, pos.sx - hw);
            b.maxX = Math.max(b.maxX, pos.sx + hw);
            b.minY = Math.min(b.minY, pos.sy - hh);
            b.maxY = Math.max(b.maxY, pos.sy + hh);
        });
    });
    const PAD_RED = 4;
    Object.values(bbGroupes).forEach(b => {
        const x = b.minX - PAD_RED, y = b.minY - PAD_RED;
        const w = b.maxX - b.minX + PAD_RED * 2;
        const h = b.maxY - b.minY + PAD_RED * 2;
        ctx.fillStyle   = 'rgba(255, 50, 50, 0.07)';
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.35)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
    });

    // Portée des SAMs (cercle par base)
    ctx.setLineDash([8, 6]);
    bases.forEach(base => {
        if (!base.vehicules) return;
        const sams = base.vehicules.filter(v => v.type === 'sam' && v.construit && v.pv > 0 && v.cur_x != null);
        if (!sams.length) return;
        // Centre = moyenne des SAMs vivants
        const cx = sams.reduce((s, v) => s + v.cur_x, 0) / sams.length;
        const cy = sams.reduce((s, v) => s + v.cur_y, 0) / sams.length;
        const { mx, my } = posToMapPx(cx, cy);
        const sx = mx - camX, sy = my - camY;
        const r = vcfg(sams[0]).portee * echelle;
        const estMoi = base.joueur_id == joueur_id;
        ctx.fillStyle   = estMoi ? 'rgba(0, 180, 255, 0.04)' : 'rgba(255, 80, 0, 0.04)';
        ctx.strokeStyle = estMoi ? 'rgba(0, 180, 255, 0.4)'  : 'rgba(255, 80, 0, 0.4)';
        ctx.lineWidth   = 1;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
    });

    // Zones des bases (ellipse : largeur parfaite, hauteur réduite pour l'isométrique)
    const BASE_RAYON_X = 380;
    const BASE_RAYON_Y = 190;
    bases.forEach(b => {
        const rx = BASE_RAYON_X * echelle;
        const ry = BASE_RAYON_Y * echelle;
        const { mx, my } = posToMapPx(b.pos_x, b.pos_y);
        const sx = mx - camX, sy = my - camY;
        ctx.fillStyle   = 'rgba(255, 140, 0, 0.07)';
        ctx.strokeStyle = 'rgba(255, 140, 0, 0.4)';
        ctx.beginPath(); ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI*2);
        ctx.fill(); ctx.stroke();
    });

    ctx.setLineDash([]);
    ctx.restore();
}

// ── Rendu des véhicules, épaves et groupes ────────────────────
function dessinerEpaves() {
    const now = Date.now();
    epaves.forEach(e => {
        const { mx, my } = posToMapPx(e.x, e.y);
        const sx = mx - camX, sy = my - camY;
        if (sx < -100 || sx > canvas.width + 100 || sy < -100 || sy > canvas.height + 100) return;

        const elapsed = now - e.start;
        const alpha   = elapsed < EXPLOSION_DURATION
            ? 1
            : 1 - (elapsed - EXPLOSION_DURATION) / (WRECK_DURATION - EXPLOSION_DURATION);
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

        try {
            if (imgVehiculeCasse.complete && imgVehiculeCasse.naturalWidth > 0) {
                ctx.drawImage(imgVehiculeCasse,
                    sx - imgVehiculeCasse.naturalWidth  / 2,
                    sy - imgVehiculeCasse.naturalHeight / 2);
            } else {
                ctx.strokeStyle = '#555'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(sx - 15, sy - 15); ctx.lineTo(sx + 15, sy + 15); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(sx + 15, sy - 15); ctx.lineTo(sx - 15, sy + 15); ctx.stroke();
            }
        } finally {
            ctx.globalAlpha = 1;
        }
    });
}

function dessinerLignesGroupe() {
    const groupes = {};
    bases.forEach(base => {
        if (!base.vehicules) return;
        base.vehicules.forEach(v => {
            if (!v.groupe_id || !v.construit) return;
            const pos = getVehicleScreenPos(v);
            if (!pos) return;
            if (!groupes[v.groupe_id]) groupes[v.groupe_id] = [];
            groupes[v.groupe_id].push(pos);
        });
    });
    ctx.strokeStyle = 'rgba(0,200,255,0.45)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([5, 4]);
    Object.values(groupes).forEach(positions => {
        if (positions.length < 2) return;
        for (let i = 1; i < positions.length; i++) {
            ctx.beginPath();
            ctx.moveTo(positions[0].sx, positions[0].sy);
            ctx.lineTo(positions[i].sx, positions[i].sy);
            ctx.stroke();
        }
    });
    ctx.setLineDash([]);
}

function dessinerVehicules() {
    // État canvas propre avant tout rendu de véhicules
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    dessinerEpaves();
    dessinerLignesGroupe();
    const now = Date.now();

    bases.forEach(base => {
        if (!base.vehicules) return;
        base.vehicules.forEach(vehicle => {
            // Réinitialiser l'état canvas à chaque véhicule
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';

            // Ne pas afficher les véhicules morts sans explosion
            if (!vehicle.explosion && vehicle.construit && vehicle.pv != null && vehicle.pv <= 0) return;

            const img = getVehicleImg(vehicle);
            if (!img.complete || !img.naturalWidth) return;
            const { frameWidth, frameHeight } = getVehicleSpriteSize(img);
            const dw  = frameWidth  * VEHICLE_SCALE;
            const dh  = frameHeight * VEHICLE_SCALE;
            const pos = getVehicleScreenPos(vehicle);
            if (!pos) return;
            const { sx, sy } = pos;
            if (!isFinite(sx) || !isFinite(sy)) return;
            if (sx < -200 || sx > canvas.width + 200 || sy < -200 || sy > canvas.height + 200) return;

            if (vehicle.explosion) {
                const elapsed = Math.min(now - vehicle.explosion.start, EXPLOSION_DURATION - 1);
                if ((vehicle.type === 'jeep' || vehicle.type === 'sam') && imgBoom.complete && imgBoom.naturalWidth) {
                    const fw    = imgBoom.naturalWidth / BOOM_FRAMES;
                    const fh    = imgBoom.naturalHeight;
                    const frame = Math.min(BOOM_FRAMES - 1,
                        Math.floor(elapsed / (EXPLOSION_DURATION / BOOM_FRAMES)));
                    ctx.drawImage(imgBoom, frame * fw, 0, fw, fh,
                        sx - fw * 2, sy - fh * 2 - 30, fw * 4, fh * 4);
                } else if (imgFeuMort.complete && imgFeuMort.naturalWidth) {
                    const fw    = imgFeuMort.naturalWidth / EXPLOSION_FRAMES;
                    const fh    = imgFeuMort.naturalHeight;
                    const frame = Math.min(EXPLOSION_FRAMES - 1,
                        Math.floor(elapsed / (EXPLOSION_DURATION / EXPLOSION_FRAMES)));
                    ctx.drawImage(imgFeuMort, frame * fw, 0, fw, fh,
                        sx - fw / 2 - 15, sy - fh / 2 - 20, fw, fh);
                }
                return;
            }

            let frame;
            if (vehicle.type === 'sam') {
                const tgt = vehicle.target;
                if (tgt && tgt.cur_x != null) {
                    const tdx = tgt.cur_x - (vehicle.cur_x ?? vehicle.x);
                    const tdy = tgt.cur_y - (vehicle.cur_y ?? vehicle.y);
                    const targetAngle = Math.atan2(tdx, -tdy);
                    if (vehicle._turretAngle == null) vehicle._turretAngle = targetAngle;
                    else {
                        let delta = targetAngle - vehicle._turretAngle;
                        if (delta >  Math.PI) delta -= 2 * Math.PI;
                        if (delta < -Math.PI) delta += 2 * Math.PI;
                        vehicle._turretAngle += delta * 0.15;
                    }
                }
                if (vehicle._turretAngle != null) {
                    const norm = (vehicle._turretAngle + 2 * Math.PI) % (2 * Math.PI);
                    const step = 2 * Math.PI / VEHICLE_FRAMES;
                    frame = Math.floor((norm + step / 2) / step) % VEHICLE_FRAMES;
                } else {
                    frame = 0;
                }
            } else {
                frame = (Number.isInteger(vehicle.frameIndex) && vehicle.frameIndex >= 0) ? vehicle.frameIndex : 0;
            }
            const frameX = (frame % VEHICLE_SPRITE_COLS) * frameWidth;
            const frameY = Math.floor(frame / VEHICLE_SPRITE_COLS) * frameHeight;

            // En construction : semi-transparent + pulsation lente
            if (!vehicle.construit) {
                ctx.globalAlpha = 0.35 + 0.2 * Math.abs(Math.sin(now / 600));
            }
            ctx.drawImage(img, frameX, frameY, frameWidth, frameHeight, sx - dw / 2, sy - dh / 2, dw, dh);

            const mitraImg = vehicle.type === 'jeep' ? imgMitraJeep : vehicle.type === 'humvet' ? imgMitraHumvet : null;
            if (mitraImg && mitraImg.complete && mitraImg.naturalWidth) {
                const mfw = mitraImg.naturalWidth / VEHICLE_SPRITE_COLS;
                const mfh = mitraImg.naturalHeight;

                let turretFrame = frame;
                const tgt = vehicle.target;
                if (tgt && tgt.cur_x != null) {
                    const tdx = tgt.cur_x - (vehicle.cur_x ?? vehicle.x);
                    const tdy = tgt.cur_y - (vehicle.cur_y ?? vehicle.y);
                    const targetAngle = Math.atan2(tdx, -tdy);
                    if (vehicle._turretAngle == null) vehicle._turretAngle = targetAngle;
                    else {
                        let delta = targetAngle - vehicle._turretAngle;
                        if (delta >  Math.PI) delta -= 2 * Math.PI;
                        if (delta < -Math.PI) delta += 2 * Math.PI;
                        vehicle._turretAngle += delta * 0.15;
                    }
                    const norm = (vehicle._turretAngle + 2 * Math.PI) % (2 * Math.PI);
                    const step = 2 * Math.PI / VEHICLE_FRAMES;
                    turretFrame = Math.floor((norm + step / 2) / step) % VEHICLE_FRAMES;
                } else {
                    vehicle._turretAngle = null;
                }

                ctx.drawImage(mitraImg, turretFrame * mfw, 0, mfw, mfh,
                    sx - mfw * VEHICLE_SCALE / 2, sy - mfh * VEHICLE_SCALE / 2 - 10,
                    mfw * VEHICLE_SCALE, mfh * VEHICLE_SCALE);

                // Effet fumée/flash au bout du canon
                if (vehicle._muzzleFlash) {
                    const FLASH_DUR = 250;
                    const fe = now - vehicle._muzzleFlash.start;
                    if (fe > FLASH_DUR) {
                        vehicle._muzzleFlash = null;
                    } else {
                        const ang = vehicle._muzzleFlash.angle;
                        const barrelLen = 22;
                        const tipX = sx + Math.sin(ang) * barrelLen;
                        const tipY = sy - Math.cos(ang) * barrelLen;

                        ctx.save();
                        // Flash lumineux au bout du canon (0–80ms)
                        if (fe < 80) {
                            const fa = fe < 40 ? fe / 40 : 1 - (fe - 40) / 40;
                            ctx.globalAlpha = fa;
                            ctx.fillStyle   = '#ffee88';
                            ctx.shadowColor = '#ff8800';
                            ctx.shadowBlur  = 18;
                            ctx.beginPath();
                            ctx.arc(tipX, tipY, 7, 0, Math.PI * 2);
                            ctx.fill();
                        }
                        // Fumée : plusieurs puffs avec dégradé radial
                        if (fe > 30 && vehicle._muzzleFlash?.puffs) {
                            const sp = (fe - 30) / (FLASH_DUR - 30);
                            const baseR = dw * 0.35 + sp * dw * 0.65;
                            ctx.shadowBlur = 0;
                            vehicle._muzzleFlash.puffs.forEach(p => {
                                const cx = sx + p.ox + Math.sin(ang) * sp * 6;
                                const cy = sy + p.oy - Math.cos(ang) * sp * 6;
                                const r  = baseR * p.r;
                                const a  = (1 - sp) * 0.55;
                                const g  = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                                g.addColorStop(0,   `rgba(160,110,60,${a})`);
                                g.addColorStop(0.5, `rgba(120,75,35,${a * 0.5})`);
                                g.addColorStop(1,   `rgba(80,45,15,0)`);
                                ctx.globalAlpha = 1;
                                ctx.fillStyle   = g;
                                ctx.beginPath();
                                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                                ctx.fill();
                            });
                        }
                        ctx.restore();
                    }
                }
            }

            ctx.globalAlpha = 1;
            if (vehicle.construit) {
                const pvMax = vcfg(vehicle).pv_max;
                if (vehicle.pv < pvMax) {
                    const barW = dw * 0.8, barH = 4;
                    const barX = sx - barW / 2, barY = sy - dh / 2 - 8;
                    ctx.fillStyle = 'rgba(255,0,0,0.8)';
                    ctx.fillRect(barX, barY, barW, barH);
                    ctx.fillStyle = 'rgba(0,255,0,0.8)';
                    ctx.fillRect(barX, barY, barW * (vehicle.pv / pvMax), barH);
                }
            }
        });
    });
    dessinerTirs();
    dessinerContoursGroupes();
}

function dessinerTirs() {
    const now = Date.now();

    bases.forEach(base => {
        if (!base.vehicules) return;
        base.vehicules.forEach(vehicle => {
            if (!vehicle._tir) return;
            const tir     = vehicle._tir;
            const DUREE   = (tir.type === 'jeep' || tir.type === 'sam') ? 700 : 150;
            const elapsed = now - tir.start;
            if (elapsed < 0) return; // décalage SAM : pas encore démarré
            if (elapsed > DUREE) { vehicle._tir = null; return; }

            const t = elapsed / DUREE;

            // Source : position live du véhicule tirant
            const srcX = vehicle.cur_x ?? vehicle.x;
            const srcY = vehicle.cur_y ?? vehicle.y;
            // Cible : position live si encore en vie, sinon fallback coords au moment du tir
            const tgtV = tir.targetVehicle;
            const dstX = (tgtV && tgtV.cur_x != null && !tgtV.explosion) ? tgtV.cur_x : tir.tx;
            const dstY = (tgtV && tgtV.cur_y != null && !tgtV.explosion) ? tgtV.cur_y : tir.ty;

            const { mx: smx, my: smy } = posToMapPx(srcX, srcY);
            const { mx: tmx, my: tmy } = posToMapPx(dstX, dstY);
            const ssx = smx - camX, ssy = smy - camY;
            const tsx = tmx - camX, tsy = tmy - camY;

            const hx = ssx + (tsx - ssx) * t;
            const hy = ssy + (tsy - ssy) * t;

            ctx.save();

            if (tir.type === 'jeep' || tir.type === 'sam') {
                // ── Missile lent : trajectoire arquée (Bézier quadratique) ──
                const TRAIL = 0.12;

                // Point de contrôle : perpendiculaire gauche au milieu du trajet
                const len = Math.max(Math.hypot(tsx - ssx, tsy - ssy), 1);
                const arcH = len * 0.2;
                const cpx = (ssx + tsx) / 2;
                const cpy = (ssy + tsy) / 2 - arcH;

                // Position sur la courbe de Bézier quadratique
                const qbez = (u, a, cp, b) => { const v = 1 - u; return v*v*a + 2*v*u*cp + u*u*b; };
                const tailT = Math.max(0, t - TRAIL);
                const qx = qbez(tailT, ssx, cpx, tsx), qy = qbez(tailT, ssy, cpy, tsy);

                // Recalculer hx/hy sur la courbe (pas sur la ligne droite)
                const mhx = qbez(t, ssx, cpx, tsx), mhy = qbez(t, ssy, cpy, tsy);

                // Traîne fumée
                ctx.strokeStyle = `rgba(180,140,80,${0.4 * (1 - t)})`;
                ctx.lineWidth   = 3;
                ctx.shadowBlur  = 0;
                ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(mhx, mhy); ctx.stroke();

                // Corps du missile (orange vif)
                ctx.strokeStyle = '#ff8800';
                ctx.lineWidth   = 3;
                ctx.shadowColor = '#ff4400';
                ctx.shadowBlur  = 12;
                ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(mhx, mhy); ctx.stroke();

                // Tête brillante
                ctx.fillStyle   = '#ffffff';
                ctx.shadowColor = '#ffaa00';
                ctx.shadowBlur  = 18;
                ctx.beginPath(); ctx.arc(mhx, mhy, 2.5, 0, Math.PI * 2); ctx.fill();

            } else {
                // ── Traçant rapide humvet : trait fin lumineux ──
                const TRAIL = 0.15;
                const qx = ssx + (tsx - ssx) * Math.max(0, t - TRAIL);
                const qy = ssy + (tsy - ssy) * Math.max(0, t - TRAIL);

                ctx.strokeStyle = '#ffff99';
                ctx.lineWidth   = 1.5;
                ctx.shadowColor = '#ffff00';
                ctx.shadowBlur  = 15;
                ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(hx, hy); ctx.stroke();

                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth   = 0.5;
                ctx.shadowBlur  = 5;
                ctx.stroke();
            }

            ctx.restore();
        });
    });
}

function dessinerContoursGroupes() {
    const groupes = {};
    bases.forEach(base => {
        if (!base.vehicules) return;
        base.vehicules.forEach(v => {
            if (!v.construit || v.cur_x == null || v.type === 'sam') return;
            const pos = getVehicleScreenPos(v);
            if (!pos) return;
            // Demi-taille réelle du sprite à l'écran
            const img = getVehicleImg(v);
            const { frameWidth, frameHeight } = getVehicleSpriteSize(img);
            const hw = (frameWidth  * VEHICLE_SCALE) / 2;
            const hh = (frameHeight * VEHICLE_SCALE) / 2;
            const cle = v.groupe_id ? `${base.joueur_id}_g${v.groupe_id}` : `${base.joueur_id}_s${v.id}`;
            if (!groupes[cle]) groupes[cle] = {
                pseudo: base.pseudo, joueur_id: base.joueur_id, groupe_id: v.groupe_id,
                type: v.type ?? 'jeep',
                count: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity
            };
            const g = groupes[cle];
            g.count++;
            // Utiliser les bords réels du sprite, pas le centre
            g.minX = Math.min(g.minX, pos.sx - hw);
            g.maxX = Math.max(g.maxX, pos.sx + hw);
            g.minY = Math.min(g.minY, pos.sy - hh);
            g.maxY = Math.max(g.maxY, pos.sy + hh);
        });
    });

    const PAD = 4; // marge minimale autour des sprites
    Object.values(groupes).forEach(g => {
        const estMoi   = g.joueur_id == joueur_id;
        const estSelec = estMoi && g.groupe_id &&
            selectedVehicles.some(s => s.vehicle.groupe_id === g.groupe_id);
        const couleur  = estMoi ? '#00c850' : '#ff6622';
        const x = g.minX - PAD, y = g.minY - PAD;
        const w = g.maxX - g.minX + PAD * 2;
        const h = g.maxY - g.minY + PAD * 2;

        ctx.strokeStyle = couleur;
        ctx.lineWidth   = estSelec ? 2 : 1;
        ctx.globalAlpha = estSelec ? 0.9 : 0.5;
        ctx.setLineDash(estSelec ? [6, 3] : [4, 5]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        const cx     = x + w / 2;
        const ligneH = 16;
        const labelW = 130, labelH = ligneH * 2 + 8;
        const labelX = cx - labelW / 2, labelY = y - labelH - 4;
        ctx.globalAlpha = estSelec ? 1 : 0.75;
        ctx.textAlign   = 'center';
        ctx.fillStyle   = 'rgba(0,0,0,0.55)';
        ctx.fillRect(labelX, labelY, labelW, labelH);
        ctx.strokeStyle = couleur; ctx.lineWidth = 1;
        ctx.strokeRect(labelX, labelY, labelW, labelH);

        ctx.fillStyle = couleur;
        ctx.font      = `bold 13px 'Share Tech Mono', monospace`;
        ctx.fillText(g.pseudo, cx, labelY + ligneH);
        ctx.font = `12px 'Share Tech Mono', monospace`;
        ctx.fillText(`${g.count} ${(g.type ?? 'jeep').toUpperCase()}${g.count > 1 ? 'S' : ''}`, cx, labelY + ligneH * 2);
        ctx.globalAlpha = 1;
    });

    dessinerCheminsGroupes();
    dessinerCheminsTT();
}

function dessinerCheminsTT() {
    bases.forEach(base => {
        if (!base.vehicules) return;
        base.vehicules.forEach(v => {
            if (v.type !== 'tt' || !v._baseCaptureCible || v.cur_x == null) return;
            const bc    = v._baseCaptureCible;
            const nicheX = bc.pos_x - 250, nicheY = bc.pos_y + 72;

            const { mx: sx0, my: sy0 } = posToMapPx(v.cur_x, v.cur_y);
            const startSX = sx0 - camX, startSY = sy0 - camY;
            const { mx: ndx, my: ndy } = posToMapPx(nicheX, nicheY);
            const nicheSX = ndx - camX, nicheSY = ndy - camY;

            ctx.save();

            // Ligne vers la niche (toujours)
            ctx.strokeStyle = v._captureStage === 2 ? '#00ffff' : '#ffcc00';
            ctx.lineWidth   = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(startSX, startSY); ctx.lineTo(nicheSX, nicheSY); ctx.stroke();
            ctx.setLineDash([]);

            // Point de destination staging (phase 1 uniquement)
            if (v._captureStage === 1 && v.x != null) {
                const { mx: sx1, my: sy1 } = posToMapPx(v.x, v.y);
                ctx.fillStyle = '#ffcc00';
                ctx.beginPath(); ctx.arc(sx1 - camX, sy1 - camY, 5, 0, Math.PI*2); ctx.fill();
            }

            // Croix sur la niche
            ctx.strokeStyle = '#ff8800'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(nicheSX-8, nicheSY-8); ctx.lineTo(nicheSX+8, nicheSY+8);
            ctx.moveTo(nicheSX+8, nicheSY-8); ctx.lineTo(nicheSX-8, nicheSY+8); ctx.stroke();

            // Label
            ctx.fillStyle = '#ffcc00'; ctx.font = 'bold 11px monospace';
            ctx.fillText(`TT STAGE ${v._captureStage ?? '?'}`, startSX + 10, startSY - 10);
            ctx.restore();
        });
    });
}

function dessinerCheminsGroupes() {
    if (!selectedVehicles || selectedVehicles.length === 0) return;
    const groupesVus = new Set();
    selectedVehicles.forEach(({ vehicle }) => {
        const gid = vehicle.groupe_id;
        if (!gid || groupesVus.has(gid)) return;
        groupesVus.add(gid);
        const maBase = bases.find(b => b.joueur_id == joueur_id);
        if (!maBase?.vehicules) return;

        // Toujours utiliser le ref (slot 0) — lui seul a les bons waypoints et la vraie destination
        const ref = maBase.vehicules.find(v => v.groupe_id === gid && v.construit && v.formation_slot === 0)
                 ?? maBase.vehicules.find(v => v.groupe_id === gid && v.construit);
        if (!ref || ref._reachedDest) return;

        const destX = ref._effectiveDest?.x ?? ref.x;
        const destY = ref._effectiveDest?.y ?? ref.y;
        if (!isFinite(destX) || !isFinite(destY)) return;

        const gc = typeof _tousLescercles !== 'undefined' ? _tousLescercles[gid] : null;
        let startSx, startSy;
        if (gc) {
            const { mx, my } = posToMapPx(gc.cx, gc.cy);
            startSx = mx - camX; startSy = my - camY;
        } else {
            const sp = getVehicleScreenPos(ref);
            if (!sp) return;
            startSx = sp.sx; startSy = sp.sy;
        }

        const { mx: dmx, my: dmy } = posToMapPx(destX, destY);
        const dsx = dmx - camX, dsy = dmy - camY;

        ctx.save();
        ctx.strokeStyle = 'rgba(0,200,80,0.7)';
        ctx.lineWidth   = 2;
        ctx.setLineDash([8, 6]);
        ctx.shadowColor = '#00c850';
        ctx.shadowBlur  = 6;
        ctx.beginPath();
        ctx.moveTo(startSx, startSy);
        if (ref._waypoints && ref._waypoints.length > 0) {
            ref._waypoints.forEach(wp => {
                const { mx, my } = posToMapPx(wp.x, wp.y);
                ctx.lineTo(mx - camX, my - camY);
            });
        }
        ctx.lineTo(dsx, dsy);
        ctx.stroke();

        // Croix à la vraie destination finale
        ctx.setLineDash([]);
        ctx.shadowBlur  = 10;
        ctx.strokeStyle = '#00c850';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(dsx - 8, dsy); ctx.lineTo(dsx + 8, dsy);
        ctx.moveTo(dsx, dsy - 8); ctx.lineTo(dsx, dsy + 8);
        ctx.stroke();
        ctx.restore();
    });
}
