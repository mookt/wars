// ============================================================
//  DB.JS — Pool de connexions MySQL
// ============================================================

const mysql = require('mysql2');

const pool = mysql.createPool({
    host            : process.env.DB_HOST,
    user            : process.env.DB_USER,
    password        : process.env.DB_PASSWORD,
    database        : process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit : 10,
    queueLimit      : 0,
});

pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Erreur MySQL :', err.message);
    } else {
        console.log('✅ Pool MySQL connecté');
        connection.release();
    }
});

module.exports = pool;
