require('dotenv').config();
const mysql = require('mysql2');
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
db.connect(err => {
  if (err) {
    console.error('DB connect error', err.message);
    process.exit(1);
  }
  db.query('SHOW COLUMNS FROM joueurs', (err, rows) => {
    if (err) {
      console.error('SHOW COLUMNS error', err.message);
      process.exit(1);
    }
    console.log(JSON.stringify(rows, null, 2));
    db.end();
  });
});
