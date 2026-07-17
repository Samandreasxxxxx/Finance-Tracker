import express from 'express';
import pg from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const { Pool } = pg;

// Use the database connection string from environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Database Tables Initialization SQL
const INIT_DB_SQL = `
  CREATE TABLE IF NOT EXISTS portfolio (
    id SERIAL PRIMARY KEY,
    bank_balance NUMERIC DEFAULT 0,
    debt_balance NUMERIC DEFAULT -500000,
    stock_investment NUMERIC DEFAULT 0,
    budget_limit NUMERIC DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(50) PRIMARY KEY,
    date DATE NOT NULL,
    type VARCHAR(10) NOT NULL,
    amount NUMERIC NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    auto_adjusted BOOLEAN DEFAULT TRUE
  );

  CREATE TABLE IF NOT EXISTS net_worth_history (
    date DATE PRIMARY KEY,
    net_worth NUMERIC NOT NULL
  );
`;

// Helper to seed initial portfolio and base history if database is empty
async function seedInitialData() {
  const client = await pool.connect();
  try {
    const portRes = await client.query('SELECT COUNT(*) FROM portfolio');
    if (parseInt(portRes.rows[0].count) === 0) {
      await client.query(
        `INSERT INTO portfolio (bank_balance, debt_balance, stock_investment, budget_limit) 
         VALUES (0, -500000, 0, 0)`
      );
      console.log('Seeded default portfolio values.');
    }
    const historyRes = await client.query('SELECT COUNT(*) FROM net_worth_history');
    if (parseInt(historyRes.rows[0].count) === 0) {
      await client.query(
        `INSERT INTO net_worth_history (date, net_worth) 
         VALUES ('2026-07-15', -500000)`
      );
      console.log('Seeded default baseline history.');
    }
  } catch (err) {
    console.error('Error seeding baseline data:', err);
  } finally {
    client.release();
  }
}

// Auto-run DB schema setup on startup
async function initDatabase() {
  try {
    await pool.query(INIT_DB_SQL);
    console.log('Database tables verified/created successfully.');
    await seedInitialData();
  } catch (err) {
    console.error('Database initialization failed:', err);
  }
}
initDatabase();

// Route: Get current app state
app.get('/api/state', async (req, res) => {
  try {
    const portRes = await pool.query('SELECT * FROM portfolio LIMIT 1');
    const transRes = await pool.query('SELECT * FROM transactions ORDER BY date DESC');
    const histRes = await pool.query('SELECT * FROM net_worth_history ORDER BY date ASC');

    const portfolio = portRes.rows[0] || { bank_balance: 0, debt_balance: -500000, stock_investment: 0, budget_limit: 0 };
    
    // Map database columns (snake_case) to client properties (camelCase)
    const state = {
      bankBalance: parseFloat(portfolio.bank_balance),
      debtBalance: parseFloat(portfolio.debt_balance),
      stockInvestment: parseFloat(portfolio.stock_investment),
      budgetLimit: parseFloat(portfolio.budget_limit),
      transactions: transRes.rows.map(t => ({
        id: t.id,
        date: t.date.toISOString().split('T')[0],
        type: t.type,
        amount: parseFloat(t.amount),
        category: t.category,
        description: t.description,
        autoAdjusted: t.auto_adjusted
      })),
      netWorthHistory: histRes.rows.map(h => ({
        date: h.date.toISOString().split('T')[0],
        netWorth: parseFloat(h.net_worth)
      }))
    };

    res.json(state);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve state from Neon database' });
  }
});

// Route: Update Cash Balance, Debt, and Budget Limit
app.post('/api/portfolio', async (req, res) => {
  const { bankBalance, debtBalance, budgetLimit } = req.body;
  try {
    await pool.query(
      `UPDATE portfolio 
       SET bank_balance = $1, debt_balance = $2, budget_limit = $3 
       WHERE id = (SELECT id FROM portfolio LIMIT 1)`,
      [bankBalance, debtBalance, budgetLimit]
    );

    // Recalculate Net Worth and record Snapshot
    const portRes = await pool.query('SELECT stock_investment FROM portfolio LIMIT 1');
    const stockVal = parseFloat(portRes.rows[0]?.stock_investment || 0);
    const netWorth = bankBalance + stockVal + debtBalance;

    const todayStr = new Date().toISOString().split('T')[0];
    await pool.query(
      `INSERT INTO net_worth_history (date, net_worth) 
       VALUES ($1, $2) 
       ON CONFLICT (date) DO UPDATE SET net_worth = EXCLUDED.net_worth`,
      [todayStr, netWorth]
    );

    res.json({ success: true, netWorth });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update portfolio' });
  }
});

// Route: Update Stock Investment Balance
app.post('/api/stock', async (req, res) => {
  const { stockInvestment } = req.body;
  try {
    await pool.query(
      `UPDATE portfolio 
       SET stock_investment = $1 
       WHERE id = (SELECT id FROM portfolio LIMIT 1)`,
      [stockInvestment]
    );

    // Recalculate Net Worth and record Snapshot
    const portRes = await pool.query('SELECT bank_balance, debt_balance FROM portfolio LIMIT 1');
    const bankVal = parseFloat(portRes.rows[0]?.bank_balance || 0);
    const debtVal = parseFloat(portRes.rows[0]?.debt_balance || 0);
    const netWorth = bankVal + stockInvestment + debtVal;

    const todayStr = new Date().toISOString().split('T')[0];
    await pool.query(
      `INSERT INTO net_worth_history (date, net_worth) 
       VALUES ($1, $2) 
       ON CONFLICT (date) DO UPDATE SET net_worth = EXCLUDED.net_worth`,
      [todayStr, netWorth]
    );

    res.json({ success: true, netWorth });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update stock portfolio' });
  }
});

// Route: Log Transaction Entry
app.post('/api/transaction', async (req, res) => {
  const { id, date, type, amount, category, description, autoAdjusted } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Add Transaction entry
    await client.query(
      `INSERT INTO transactions (id, date, type, amount, category, description, auto_adjusted) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, date, type, amount, category, description, autoAdjusted]
    );

    // If autoAdjusted, update portfolio cash balance
    if (autoAdjusted) {
      const delta = type === 'gain' ? amount : -amount;
      await client.query(
        `UPDATE portfolio 
         SET bank_balance = bank_balance + $1 
         WHERE id = (SELECT id FROM portfolio LIMIT 1)`,
        [delta]
      );
    }

    // Recalculate Net Worth and update history
    const portRes = await client.query('SELECT bank_balance, debt_balance, stock_investment FROM portfolio LIMIT 1');
    const bankVal = parseFloat(portRes.rows[0].bank_balance);
    const debtVal = parseFloat(portRes.rows[0].debt_balance);
    const stockVal = parseFloat(portRes.rows[0].stock_investment);
    const netWorth = bankVal + stockVal + debtVal;

    // Use transaction date for history snapshot
    await client.query(
      `INSERT INTO net_worth_history (date, net_worth) 
       VALUES ($1, $2) 
       ON CONFLICT (date) DO UPDATE SET net_worth = EXCLUDED.net_worth`,
      [date, netWorth]
    );

    await client.query('COMMIT');
    res.json({ success: true, netWorth, bankBalance: bankVal });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to log transaction' });
  } finally {
    client.release();
  }
});

// Route: Delete Transaction Entry
app.delete('/api/transaction/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch details of transaction to delete
    const transRes = await client.query('SELECT * FROM transactions WHERE id = $1', [id]);
    if (transRes.rows.length === 0) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }
    const t = transRes.rows[0];

    // Delete transaction
    await client.query('DELETE FROM transactions WHERE id = $1', [id]);

    // Reverse cash balance if autoAdjusted
    if (t.auto_adjusted) {
      const reverseDelta = t.type === 'gain' ? -parseFloat(t.amount) : parseFloat(t.amount);
      await client.query(
        `UPDATE portfolio 
         SET bank_balance = bank_balance + $1 
         WHERE id = (SELECT id FROM portfolio LIMIT 1)`,
        [reverseDelta]
      );
    }

    // Recalculate Net Worth and update history
    const portRes = await client.query('SELECT bank_balance, debt_balance, stock_investment FROM portfolio LIMIT 1');
    const bankVal = parseFloat(portRes.rows[0].bank_balance);
    const debtVal = parseFloat(portRes.rows[0].debt_balance);
    const stockVal = parseFloat(portRes.rows[0].stock_investment);
    const netWorth = bankVal + stockVal + debtVal;

    const tDateStr = t.date.toISOString().split('T')[0];
    await client.query(
      `INSERT INTO net_worth_history (date, net_worth) 
       VALUES ($1, $2) 
       ON CONFLICT (date) DO UPDATE SET net_worth = EXCLUDED.net_worth`,
      [tDateStr, netWorth]
    );

    await client.query('COMMIT');
    res.json({ success: true, netWorth, bankBalance: bankVal });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to delete transaction' });
  } finally {
    client.release();
  }
});

// Run server listening locally if not inside serverless context
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Neon Backend Server running on http://localhost:${PORT}`);
  });
}

export default app;
