// ── Chargement des données API ───────────────────────────────
async function chargerDonnees() {
    try {
        const resJ = await fetch(`/api/joueur/${joueur_id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (resJ.ok) {
            const j = await resJ.json();
            document.getElementById('hud-points').textContent = j.points || 0;
        }

        const resB = await fetch('/api/joueur/bases', { headers: { 'Authorization': `Bearer ${token}` } });
        if (resB.ok) {
            bases = await resB.json();
            const maBase = bases.find(b => b.joueur_id == joueur_id);
            if (maBase) {
                const { mx, my } = posToMapPx(maBase.pos_x, maBase.pos_y);
                camX = mx - canvas.width  / 2;
                camY = my - canvas.height / 2;
                clampCamera();
            }
            ensureAllVehicles();
            planifierActivationsInitiales();
            chargerBeton();
            chargerAcier();
            chargerCharbon();
            chargerCarburant();
        } else {
            bases = [{ joueur_id: parseInt(joueur_id), pseudo, pos_x: 2500, pos_y: 2500 }];
            centrerCarte();
        }
    } catch (e) {
        console.warn('API indisponible :', e.message);
        bases = [{ joueur_id: parseInt(joueur_id), pseudo, pos_x: 2500, pos_y: 2500 }];
        centrerCarte();
    }
}

function centrerCarte() {
    camX = MAP_W / 2 - canvas.width  / 2;
    camY = MAP_H / 2 - canvas.height / 2;
    clampCamera();
}

// ── Sync périodique des autres joueurs (rattrapage si événement manqué) ──
async function syncTiers() {
    try {
        const res = await fetch('/api/joueur/bases', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        data.forEach(nb => {
            if (nb.joueur_id == joueur_id) return;
            const base = bases.find(b =>
                b.joueur_id == nb.joueur_id ||
                (b._neutreId != null && b._neutreId === nb._neutreId)
            );
            if (!base) return;
            (nb.vehicules || []).forEach(nv => {
                const existing = (base.vehicules || []).find(v => v.id === nv.id);
                if (existing) {
                    existing.x = nv.x; existing.y = nv.y;
                    if (existing.cur_x == null) { existing.cur_x = nv.x; existing.cur_y = nv.y; }
                    if (existing.construit == null)
                        existing.construit = (!existing.construction_fin || Date.now() >= existing.construction_fin) ? 1 : 0;
                } else {
                    if (!base.vehicules) base.vehicules = [];
                    const newV = { ...nv, cur_x: nv.x, cur_y: nv.y };
                    if (newV.construit == null)
                        newV.construit = (!newV.construction_fin || Date.now() >= newV.construction_fin) ? 1 : 0;
                    base.vehicules.push(newV);
                }
            });
            if (base.vehicules) {
                const idsServeur = new Set((nb.vehicules || []).map(v => v.id));
                base.vehicules = base.vehicules.filter(v =>
                    typeof v.id === 'string' || idsServeur.has(v.id)
                );
            }
        });
    } catch (e) {}
}
setInterval(syncTiers, 10000);

// ── Démarrage ────────────────────────────────────────────────
resize();
setLoading(15);

setTimeout(async () => {
    await genererTerrain();
    await chargerDonnees();
    setTimeout(() => {
        document.getElementById('loading').style.display = 'none';
        dessiner();
    }, 200);
}, 60);
