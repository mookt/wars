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
