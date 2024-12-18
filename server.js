const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const cors = require('cors');

const app = express();
const port = 8001;

// Set up CORS (allow requests from React frontend)
app.use(cors());

// Body parser to handle PUT requests
app.use(bodyParser.json());

// MySQL Database connection to AWS RDS
const db = mysql.createConnection({
  host: "service-campaign-dss.cty60kiw4xkh.ap-south-1.rds.amazonaws.com",
  user: "Harjeet",
  password: "MSGdss777",
  database: "service_campaigns",
  connectTimeout: 10000, // 10 seconds timeout
});
db.connect((err) => {
  if (err) {
    console.error('DB connection failed: ' + err.stack);
    return;
  }
  console.log('Connected to the database');
});

// Route to handle PUT request
app.put('/update', (req, res) => {
  const { month, state, district, village, block, campaignsData } = req.body;

  // Validate basic fields
  if (!month || !state || !district || !village || !block || !campaignsData) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  // Get the current date
  const currentDate = new Date().toISOString().slice(0, 19).replace('T', ' '); // Format to 'YYYY-MM-DD HH:MM:SS'

  // Loop through campaignsData and insert/update each campaign
  const queries = Object.entries(campaignsData).map(([campaign_id, details]) => {
    const { quantity, amount } = details;

    if (!quantity && !amount) return null; // Skip campaigns with no data

    const query = `
      INSERT INTO campaign_data (month, state, district, villageZone, blockName, campaign_id, quantity, amount, date_added)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        month = VALUES(month),
        state = VALUES(state),
        district = VALUES(district),
        villageZone = VALUES(villageZone),
        blockName = VALUES(blockName),
        quantity = VALUES(quantity),
        amount = VALUES(amount),
        date_added = VALUES(date_added)  -- Update the date when the record is updated
    `;
    return {
      query,
      values: [month, state, district, village, block, campaign_id, quantity || 0, amount || 0, currentDate],
    };
  });

  // Filter out null queries and execute them
  const validQueries = queries.filter((q) => q !== null);
  let completedQueries = 0;

  if (validQueries.length === 0) {
    return res.status(400).json({ message: 'No valid campaign data to insert' });
  }

  validQueries.forEach(({ query, values }) => {
    db.query(query, values, (err, result) => {
      if (err) {
        console.error('Error inserting/updating data: ', err);
        return res.status(500).json({ message: 'Failed to insert/update some data' });
      }
      completedQueries++;
      if (completedQueries === validQueries.length) {
        res.json({ message: 'All data inserted/updated successfully!' });
      }
    });
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
