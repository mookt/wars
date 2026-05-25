// ============================================================
//  SERVICES/EMAIL.JS — Envoi d'emails via Gmail
// ============================================================

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

async function envoyerCodeVerification(email, code) {
    await transporter.sendMail({
        from: `"WarZone" <${process.env.SMTP_USER}>`,
        to: email,
        subject: '[WarZone] Code de vérification',
        html: `
            <div style="background:#080c0f;color:#00c850;font-family:monospace;padding:40px;max-width:480px;margin:0 auto;border:1px solid rgba(0,200,80,0.3);border-top:2px solid #00c850;">
                <h1 style="letter-spacing:8px;font-size:1.6em;margin-bottom:8px;">WARZONE</h1>
                <p style="color:#2a6a3a;font-size:0.75em;letter-spacing:4px;margin-bottom:32px;">TACTICAL STRATEGY ONLINE</p>

                <p style="color:#aaa;margin-bottom:16px;">Voici ton code de vérification :</p>

                <div style="background:rgba(0,200,80,0.07);border:1px solid rgba(0,200,80,0.3);border-left:3px solid #00c850;padding:20px;text-align:center;margin-bottom:24px;">
                    <span style="font-size:2.4em;letter-spacing:12px;color:#00c850;font-weight:bold;">${code}</span>
                </div>

                <p style="color:#5a8a65;font-size:0.8em;">Ce code est valable <strong style="color:#00c850;">15 minutes</strong>.</p>
                <p style="color:#5a8a65;font-size:0.8em;margin-top:8px;">Si tu n'as pas créé de compte, ignore cet email.</p>
            </div>
        `,
    });
}

module.exports = { envoyerCodeVerification };
