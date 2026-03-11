const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const configRoutes = require('./routes/configRoutes');
const { router: vehicleRouter } = require('./routes/vehicleRoutes');

const app = express();

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const staticLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors());
app.use(express.json({ type: ['application/json', 'text/plain'] }));
app.use(express.text({ type: 'text/yaml' }));
app.use('/api', apiLimiter);

app.use('/api', configRoutes);
app.use('/api', vehicleRouter);

// Serve frontend static files in production
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));

app.get('*', staticLimiter, (req, res) => {
  const indexPath = path.join(frontendDist, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(404).json({ error: 'Not found' });
    }
  });
});

module.exports = app;
