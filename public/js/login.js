// ============================================================
//  LOGIN.JS — Logique de la page de connexion
// ============================================================

let emailEnAttente = null; // email en cours de vérification


// ── Onglets ───────────────────────────────────────────────
function showTab(tab, btn) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.form-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`panel-${tab}`).classList.add('active');
    btn.classList.add('active');
    hideMessage();
}


// ── Messages feedback ──────────────────────────────────────
function showMessage(texte, type) {
    const el = document.getElementById('message');
    el.textContent = texte;
    el.className = `message ${type}`;
    el.style.display = 'block';
}

function hideMessage() {
    const el = document.getElementById('message');
    el.style.display = 'none';
}


// ── Panneau vérification ───────────────────────────────────
function afficherPanneauVerification(email) {
    emailEnAttente = email;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.form-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-verification').classList.add('active');
    document.getElementById('verif-email-affiche').textContent = email;
    document.getElementById('verif-code').value = '';
    hideMessage();
}


// ── Inscription ────────────────────────────────────────────
async function inscription() {
    const pseudo       = document.getElementById('reg-pseudo').value.trim();
    const email        = document.getElementById('reg-email').value.trim();
    const mot_de_passe = document.getElementById('reg-mdp').value;

    if (!pseudo || !email || !mot_de_passe)
        return showMessage('Remplis tous les champs.', 'erreur');

    const res  = await fetch('/api/auth/inscription', {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({ pseudo, email, mot_de_passe })
    });
    const data = await res.json();

    if (res.ok) {
        afficherPanneauVerification(email);
        showMessage('Code envoyé ! Consulte ta boite mail.', 'succes');
    } else {
        showMessage(data.erreur, 'erreur');
    }
}


// ── Vérification du code ───────────────────────────────────
async function verifierCode() {
    const code = document.getElementById('verif-code').value.trim();

    if (!code || code.length !== 6)
        return showMessage('Entre le code à 6 chiffres.', 'erreur');

    const res  = await fetch('/api/auth/verifier', {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({ email: emailEnAttente, code })
    });
    const data = await res.json();

    if (res.ok) {
        showMessage(data.message, 'succes');
        // Bascule vers la connexion après 2 secondes
        setTimeout(() => {
            const btnConnexion = document.querySelector('.tab');
            showTab('connexion', btnConnexion);
        }, 2000);
    } else {
        showMessage(data.erreur, 'erreur');
    }
}


// ── Renvoi du code ─────────────────────────────────────────
async function renvoyerCode() {
    const res  = await fetch('/api/auth/renvoyer-code', {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({ email: emailEnAttente })
    });
    const data = await res.json();

    showMessage(
        res.ok ? 'Nouveau code envoyé !' : data.erreur,
        res.ok ? 'succes' : 'erreur'
    );
}


// ── Connexion ──────────────────────────────────────────────
async function connexion() {
    const email        = document.getElementById('login-email').value.trim();
    const mot_de_passe = document.getElementById('login-mdp').value;

    if (!email || !mot_de_passe)
        return showMessage('Remplis tous les champs.', 'erreur');

    const res  = await fetch('/api/auth/connexion', {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({ email, mot_de_passe })
    });
    const data = await res.json();

    if (res.ok) {
        localStorage.setItem('token',     data.token);
        localStorage.setItem('joueur_id', data.id);
        localStorage.setItem('pseudo',    data.pseudo);
        window.location.href = '/jeu.html';
    } else if (data.nonVerifie) {
        // Email pas encore vérifié → ouvre le panneau de vérification
        afficherPanneauVerification(data.email);
        showMessage('Email non vérifié — entre le code reçu par mail.', 'erreur');
    } else {
        showMessage(data.erreur, 'erreur');
    }
}
