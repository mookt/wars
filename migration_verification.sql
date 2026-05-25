-- Migration : ajout de la vérification email sur les comptes
ALTER TABLE joueurs
    ADD COLUMN email_verifie    TINYINT(1)   NOT NULL DEFAULT 0   AFTER mot_de_passe,
    ADD COLUMN code_verification VARCHAR(6)   NULL                 AFTER email_verifie,
    ADD COLUMN code_expiration   DATETIME     NULL                 AFTER code_verification;
