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
  console.log('Connected to PG!');
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        user_key VARCHAR(6) NOT NULL,
        id TEXT NOT NULL,
        date TEXT NOT NULL,
        category_type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        merchant TEXT NOT NULL,
        payment_type TEXT NOT NULL,
        card_company TEXT,
        installment_type TEXT NOT NULL,
        installment_months INTEGER DEFAULT 1,
        is_recurring BOOLEAN DEFAULT false,
        created_at TEXT,
        PRIMARY KEY (user_key, id)
      );

      CREATE TABLE IF NOT EXISTS recurring_rules (
        user_key VARCHAR(6) NOT NULL,
        id TEXT NOT NULL,
        day_of_month INTEGER NOT NULL,
        is_daily BOOLEAN DEFAULT false,
        repeat_type TEXT,
        days_of_week TEXT,
        start_date TEXT,
        category_type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        merchant TEXT NOT NULL,
        payment_type TEXT NOT NULL,
        card_company TEXT,
        installment_type TEXT NOT NULL,
        created_at TEXT,
        PRIMARY KEY (user_key, id)
      );

      CREATE TABLE IF NOT EXISTS holidays (
        user_key VARCHAR(6) NOT NULL,
        locdate TEXT NOT NULL,
        date_name TEXT NOT NULL,
        is_holiday BOOLEAN NOT NULL DEFAULT true,
        is_custom BOOLEAN NOT NULL DEFAULT false,
        updated_at TEXT,
        PRIMARY KEY (user_key, locdate)
      );

      CREATE TABLE IF NOT EXISTS app_notifications_raw (
        user_key VARCHAR(6) NOT NULL,
        id TEXT NOT NULL,
        package_name TEXT NOT NULL,
        title TEXT,
        text TEXT,
        big_text TEXT,
        raw_content TEXT NOT NULL,
        post_time TEXT NOT NULL,
        is_bookmarked BOOLEAN DEFAULT false,
        created_at TEXT,
        PRIMARY KEY (user_key, id)
      );

      CREATE TABLE IF NOT EXISTS parse_exceptions (
        user_key VARCHAR(6) NOT NULL,
        keyword TEXT NOT NULL,
        apply_push BOOLEAN DEFAULT true,
        apply_sms BOOLEAN DEFAULT true,
        PRIMARY KEY (user_key, keyword)
      );

      CREATE TABLE IF NOT EXISTS manual_installments (
        user_key VARCHAR(6) NOT NULL,
        year_month TEXT NOT NULL,
        amount INTEGER NOT NULL,
        PRIMARY KEY (user_key, year_month)
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        user_key VARCHAR(6) NOT NULL,
        nickname TEXT,
        monthly_budget INTEGER,
        view_mode TEXT,
        updated_at TEXT,
        PRIMARY KEY (user_key)
      );
    `);
    console.log('Tables created successfully!');
  } catch(err) {
    console.error('Error creating tables:', err);
  } finally {
    client.end();
  }
}).catch(err => {
  console.error('Connection failed:', err.message);
});
