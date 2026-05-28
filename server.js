const express = require('express');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env') });

const driveRouter = require('./src/routes/drive');

const app = express();
app.use(express.json());

app.use('/api', driveRouter);

app.get('/', (req, res) => {
  res.send({ status: 'ok', message: 'Simba Drives Backend is running.' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
