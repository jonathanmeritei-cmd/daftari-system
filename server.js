const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to SQLite Database
const db = new sqlite3.Database('./daftari.db', (err) => {
    if (err) console.error("Database connection error:", err.message);
    else console.log("Connected to SQLite database (daftari.db).");
});

// Initialize Database Tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            category TEXT NOT NULL,
            unit TEXT DEFAULT 'pcs',
            stock_qty REAL DEFAULT 0,
            cost_price REAL DEFAULT 0,
            price_retail REAL DEFAULT 0,
            price_wholesale REAL DEFAULT 0
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            posted_by TEXT NOT NULL,
            order_type TEXT CHECK(order_type IN ('retail', 'wholesale')) DEFAULT 'retail',
            status TEXT CHECK(status IN ('pending', 'paid', 'unpaid')) DEFAULT 'pending',
            total_amount REAL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            item_id INTEGER,
            quantity REAL,
            unit_price REAL,
            subtotal REAL,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            FOREIGN KEY(item_id) REFERENCES inventory(id)
        )
    `);

    // Seed Sample Items if Empty
    db.get("SELECT COUNT(*) as count FROM inventory", (err, row) => {
        if (row && row.count === 0) {
            const stmt = db.prepare(`
                INSERT INTO inventory (name, category, unit, stock_qty, cost_price, price_retail, price_wholesale)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const sampleItems = [
                ['Fried Chicken Full', 'Grill', 'PCS', 40, 800, 1200, 1000],
                ['Fried Chicken Quarter', 'Grill', 'PCS', 60, 200, 350, 300],
                ['Chips Regular', 'Sides', 'PORTION', 100, 50, 150, 120],
                ['Soda 500ml', 'Beverages', 'BTL', 120, 40, 70, 60]
            ];
            sampleItems.forEach(item => stmt.run(item));
            stmt.finalize();
            console.log("Sample catalog seeded!");
        }
    });
});

// API Routes
app.get('/api/inventory', (req, res) => {
    db.all("SELECT * FROM inventory ORDER BY category, name", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/orders/post', (req, res) => {
    const { posted_by, order_type, status, items } = req.body;
    if (!items || items.length === 0) {
        return res.status(400).json({ status: 'error', message: 'Order cannot be empty' });
    }

    db.run(
        `INSERT INTO orders (posted_by, order_type, status, total_amount) VALUES (?, ?, ?, 0)`,
        [posted_by || 'Cashier', order_type || 'retail', status || 'pending'],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });

            const orderId = this.lastID;
            let totalAmount = 0;
            let completed = 0;

            items.forEach(line => {
                db.get("SELECT price_retail, price_wholesale FROM inventory WHERE id = ?", [line.item_id], (err, item) => {
                    if (item) {
                        const unitPrice = order_type === 'wholesale' ? item.price_wholesale : item.price_retail;
                        const subtotal = unitPrice * parseFloat(line.qty);
                        totalAmount += subtotal;

                        db.run(
                            `INSERT INTO order_items (order_id, item_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)`,
                            [orderId, line.item_id, line.qty, unitPrice, subtotal]
                        );

                        db.run(
                            `UPDATE inventory SET stock_qty = stock_qty - ? WHERE id = ?`,
                            [line.qty, line.item_id]
                        );
                    }

                    completed++;
                    if (completed === items.length) {
                        db.run(`UPDATE orders SET total_amount = ? WHERE id = ?`, [totalAmount, orderId], () => {
                            res.json({ status: 'success', order_id: orderId, total: totalAmount });
                        });
                    }
                });
            });
        }
    );
});

app.get('/api/orders', (req, res) => {
    db.all("SELECT * FROM orders ORDER BY id DESC LIMIT 20", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.listen(PORT, () => {
    console.log(`Daftari Server running on port ${PORT}`);
});