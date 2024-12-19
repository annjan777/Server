require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const port = 8001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(morgan('combined'));

// MySQL Database connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

db.connect((err) => {
  if (err) {
    console.error('DB connection failed: ' + err.stack);
    return;
  }
  console.log('Connected to the database');
});

// Login Route
app.post('/login', (req, res) => {
  const { contact_number, password } = req.body;

  if (!contact_number || !password) {
    return res.status(400).json({ message: 'Contact number and password are required' });
  }

  const query = 'SELECT * FROM user_credentials WHERE contact_number = ? AND password = ?';
  db.query(query, [contact_number, password], (err, results) => {
    if (err) {
      console.error('Error during login:', err);
      return res.status(500).json({ message: 'An error occurred during login' });
    }

    if (results.length === 0) {
      return res.status(400).json({ message: 'Invalid username or password' });
    }

    const user = results[0];
    if (!user.enable) {
      return res.status(403).json({ message: 'User account is inactive. Contact admin.' });
    }

    res.json({
      message: 'Login successful',
      user: {
        user_id: user.contact_number,
        contact_number: user.contact_number,
        name: user.name,
        address: user.address,
        role: user.role, // Admin or User
      },
    });
  });
});
// Add New User
app.post('/users', (req, res) => {
  const { contact_number, name, address, password, role, enable } = req.body;

  if (!contact_number || !name || !address || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const query = 'INSERT INTO user_credentials (contact_number, name, address, password, role, enable) VALUES (?, ?, ?, ?, ?, ?)';
  db.query(query, [contact_number, name, address, password, role, enable], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error adding user' });
    res.json({ contact_number, name, address, role, enable });
  });
});

// Delete User
app.delete('/users/:contact_number', (req, res) => {
  const { contact_number } = req.params;

  const query = 'DELETE FROM user_credentials WHERE contact_number = ?';
  db.query(query, [contact_number], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error deleting user' });
    if (results.affectedRows === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User deleted successfully' });
  });
});

// Fetch All Users (Admin Route)
app.get('/users', (req, res) => {
  const query = 'SELECT user_id, contact_number, name, address,role, enable FROM user_credentials';
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching users:', err);
      return res.status(500).json({ message: 'An error occurred while fetching users' });
    }
    res.json(results);
  });
});

// Enable/Disable User (Admin Route)
app.put('/users/:userId/enable', (req, res) => {
  const { userId } = req.params;
  const { enable } = req.body;

  if (typeof enable !== 'boolean') {
    return res.status(400).json({ message: 'Invalid enable value. Must be true or false.' });
  }

  const query = 'UPDATE user_credentials SET enable = ? WHERE user_id = ?';
  db.query(query, [enable, userId], (err, results) => {
    if (err) {
      console.error('Error updating user status:', err);
      return res.status(500).json({ message: 'An error occurred while updating user status' });
    }

    if (results.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: `User ${enable ? 'enabled' : 'disabled'} successfully` });
  });
});

// Campaign Data Update Route
// Campaign Data Update Route
app.put('/update', (req, res) => {
  const { month, state, district, village, block, campaignsData, user_id } = req.body;

  if (!month || !state || !district || !village || !block || !campaignsData || !user_id) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  if (typeof campaignsData !== 'object' || campaignsData === null) {
    return res.status(400).json({ message: 'Invalid campaignsData format' });
  }

  const currentDate = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const queries = Object.entries(campaignsData).map(([campaign_id, details]) => {
    const { quantity, amount } = details;
    if (!quantity && !amount) return null;

    const query = `
      INSERT INTO campaign_data (month, state, district, villageZone, blockName, campaign_id, quantity, amount, date_added, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        quantity = VALUES(quantity),
        amount = VALUES(amount),
        date_added = VALUES(date_added)
    `;
    return {
      query,
      values: [month, state, district, village, block, campaign_id, quantity || 0, amount || 0, currentDate, user_id],
    };
  });

  const validQueries = queries.filter((q) => q !== null);

  if (validQueries.length === 0) {
    return res.status(400).json({ message: 'No valid campaign data to insert' });
  }

  db.beginTransaction((err) => {
    if (err) {
      console.error('Transaction start failed:', err);
      return res.status(500).json({ message: 'Failed to start transaction' });
    }

    let completedQueries = 0;
    let hasErrorOccurred = false;

    validQueries.forEach(({ query, values }) => {
      db.query(query, values, (err, result) => {
        if (err) {
          console.error('Error inserting/updating data:', err);
          if (!hasErrorOccurred) {
            hasErrorOccurred = true;
            db.rollback(() => {
              return res.status(500).json({ message: 'Failed to insert/update some data', error: err.message });
            });
          }
          return;
        }

        completedQueries++;
        if (completedQueries === validQueries.length && !hasErrorOccurred) {
          db.commit((err) => {
            if (err) {
              console.error('Transaction commit failed:', err);
              db.rollback(() => {
                return res.status(500).json({ message: 'Failed to commit transaction' });
              });
            } else {
              res.json({ message: 'All data inserted/updated successfully!' });
            }
          });
        }
      });
    });
  });
});



// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
