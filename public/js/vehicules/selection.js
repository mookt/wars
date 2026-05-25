// ── Sélection & déplacement par le joueur ────────────────────
function findVehicleUnderCursor(x, y) {
    for (const base of bases) {
        if (!base.vehicules) continue;
        for (const vehicle of base.vehicules) {
            if (vehicle.explosion) continue;
            if (vehicle.type === 'sam') continue;
            if (vehicle._ancreEnNiche) continue;
            const pos = getVehicleScreenPos(vehicle);
            if (!pos) continue;
            const { frameWidth } = getVehicleSpriteSize(getVehicleImg(vehicle));
            if (Math.hypot(x - pos.sx, y - pos.sy) < frameWidth / 2 + 15)
                return { base, vehicle };
        }
    }
    return null;
}

function gererClicJeepSimple(e) {
    const mesBasesJ = bases.filter(b => b.joueur_id == joueur_id);
    if (!mesBasesJ.length) return;
    const tousVehJ = mesBasesJ.flatMap(b => b.vehicules ?? []);
    const baseDe   = v => mesBasesJ.find(b => b.vehicules?.includes(v)) ?? mesBasesJ[0];

    const hit = findVehicleUnderCursor(e.clientX, e.clientY);
    if (hit && hit.base.joueur_id == joueur_id) {
        const dejaSel = selectedVehicles.some(s => s.vehicle === hit.vehicle);

        if (hit.vehicle.groupe_id) {
            // Sélectionner tout le groupe, quelle que soit la base d'origine
            selectedVehicles = tousVehJ
                .filter(v => v.groupe_id === hit.vehicle.groupe_id && v.construit)
                .sort((a, b) => (a.formation_slot ?? Infinity) - (b.formation_slot ?? Infinity))
                .map(v => ({ base: baseDe(v), vehicle: v }));
        } else {
            selectedVehicles = dejaSel ? [] : [hit];
        }
        canvas.style.cursor = selectedVehicles.length > 0 ? 'crosshair' : '';
        return;
    }

    if (selectedVehicles.length > 0) {
        const mapX = (e.clientX + camX) * 5000 / MAP_W;
        const mapY = (e.clientY + camY) * 5000 / MAP_H;
        const memeGroupe = selectedVehicles.length > 1 &&
            selectedVehicles[0].vehicle.groupe_id != null &&
            selectedVehicles.every(s => s.vehicle.groupe_id === selectedVehicles[0].vehicle.groupe_id);
        if (memeGroupe) {
            const tries = [...selectedVehicles].sort((a, b) =>
                (a.vehicle.formation_slot ?? Infinity) - (b.vehicle.formation_slot ?? Infinity));
            normaliserParPosition(tries);
            const positions = positionsFormation(tries.length, mapX, mapY);
            tries.forEach(({ base, vehicle }, i) =>
                deplacerVehicule(base, vehicle, positions[i].x, positions[i].y));
        } else {
            deplacerGroupesVers(selectedVehicles, mapX, mapY);
        }
    }
}

function selectionnerDansZone(box) {
    const minX = Math.min(box.x1, box.x2), maxX = Math.max(box.x1, box.x2);
    const minY = Math.min(box.y1, box.y2), maxY = Math.max(box.y1, box.y2);
    const mesBasesJ = bases.filter(b => b.joueur_id == joueur_id);
    if (!mesBasesJ.length) return;
    const tousVehJ = mesBasesJ.flatMap(b => b.vehicules ?? []);
    const baseDe   = v => mesBasesJ.find(b => b.vehicules?.includes(v)) ?? mesBasesJ[0];

    const dansZone = new Set();
    for (const vehicle of tousVehJ) {
        if (vehicle._ancreEnNiche) continue;
        const pos = getVehicleScreenPos(vehicle);
        if (!pos) continue;
        if (pos.sx >= minX && pos.sx <= maxX && pos.sy >= minY && pos.sy <= maxY)
            dansZone.add(vehicle);
    }
    const groupesTouches = new Set([...dansZone].filter(v => v.groupe_id != null).map(v => v.groupe_id));
    for (const vehicle of tousVehJ) {
        if (vehicle.groupe_id && groupesTouches.has(vehicle.groupe_id)) dansZone.add(vehicle);
    }
    selectedVehicles = [...dansZone]
        .sort((a, b) => (a.formation_slot ?? Infinity) - (b.formation_slot ?? Infinity))
        .map(v => ({ base: baseDe(v), vehicle: v }));
    canvas.style.cursor = selectedVehicles.length > 0 ? 'crosshair' : '';
}
