const { Client } = require('pg');
const client = new Client({
  host: '218.234.55.78',
  port: 5432,
  user: 'buget',
  password: 'buget123$%^',
  database: 'buget',
  connectionTimeoutMillis: 5000
});

client.connect().then(async () => {
  try {
    await client.query(`set password_encryption = 'md5'`);
    await client.query(`ALTER USER buget WITH PASSWORD 'buget123$%^'`);
    console.log('Password encryption changed to md5 successfully!');
  } catch(err) {
    console.error('Error:', err);
  } finally {
    client.end();
  }
}).catch(err => {
  console.error('Connection failed:', err.message);
});
