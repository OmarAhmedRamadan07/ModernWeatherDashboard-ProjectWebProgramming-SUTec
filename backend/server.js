process.env.NODE_OPTIONS = '--dns-result-order=ipv4first';
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
dns.setDefaultResultOrder('ipv4first');

const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

const limiter = rateLimit({ windowMs: 60_000, max: 60 });
app.use(limiter);

mongoose.connect(process.env.MONGO_URI, { family: 4, serverSelectionTimeoutMS: 30000 })
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err));

// =========================================================
// Models
// =========================================================

// Visitor counter
const VisitorSchema = new mongoose.Schema({
    date:  { type: String, required: true, unique: true },
    count: { type: Number, default: 0 }
});
const Visitor = mongoose.model('Visitor', VisitorSchema);

// Favorite cities
const FavoriteCitySchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    city:      { type: String, required: true },
    country:   { type: String, default: '' },
    lat:       { type: Number },
    lon:       { type: Number },
    addedAt:   { type: Date, default: Date.now }
});
FavoriteCitySchema.index({ sessionId: 1, city: 1 }, { unique: true });
const FavoriteCity = mongoose.model('FavoriteCity', FavoriteCitySchema);

// Search history — tracks every searched city
const SearchSchema = new mongoose.Schema({
    city:       { type: String, required: true, unique: true },
    count:      { type: Number, default: 1 },
    lastSearch: { type: Date, default: Date.now }
});
const Search = mongoose.model('Search', SearchSchema);

// =========================================================
// Routes
// =========================================================

app.get('/', (req, res) => {
    res.json({ status: '✅ Weather Dashboard Backend is running!' });
});

// Register a visit
app.post('/api/visit', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const visitor = await Visitor.findOneAndUpdate(
            { date: today },
            { $inc: { count: 1 } },
            { upsert: true, new: true }
        );
        res.json({ success: true, todayCount: visitor.count });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Get visit stats
app.get('/api/stats', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        // Run all queries in parallel for speed
        const [todayDoc, totalResult, last7] = await Promise.all([
            Visitor.findOne({ date: today }),
            Visitor.aggregate([{ $group: { _id: null, total: { $sum: '$count' } } }]),
            Visitor.find().sort({ date: -1 }).limit(7)
        ]);
        res.json({
            today:     todayDoc?.count || 0,
            total:     totalResult[0]?.total || 0,
            last7Days: last7.map(d => ({ date: d.date, count: d.count }))
        });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Log a city search
app.post('/api/searches', async (req, res) => {
    try {
        const { city } = req.body;
        if (!city) return res.status(400).json({ error: 'city required' });
        const doc = await Search.findOneAndUpdate(
            { city: city.toLowerCase() },
            { $inc: { count: 1 }, lastSearch: new Date(), city: city.toLowerCase() },
            { upsert: true, new: true }
        );
        res.json({ success: true, search: doc });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all searched cities — sorted by most searched
app.get('/api/searches', async (req, res) => {
    try {
        const searches = await Search.find().sort({ count: -1 }).limit(50);
        res.json({
            total: searches.length,
            cities: searches.map(s => ({
                city:       s.city,
                count:      s.count,
                lastSearch: s.lastSearch
            }))
        });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Get favorite cities
app.get('/api/favorites/:sessionId', async (req, res) => {
    try {
        const cities = await FavoriteCity.find({ sessionId: req.params.sessionId })
            .sort({ addedAt: -1 });
        res.json({ success: true, cities });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Add a favorite city
app.post('/api/favorites', async (req, res) => {
    try {
        const { sessionId, city, country, lat, lon } = req.body;
        if (!sessionId || !city) return res.status(400).json({ error: 'sessionId and city required' });
        const existing = await FavoriteCity.countDocuments({ sessionId });
        if (existing >= 10) return res.status(400).json({ error: 'Max 10 favorite cities' });
        const doc = await FavoriteCity.findOneAndUpdate(
            { sessionId, city },
            { sessionId, city, country, lat, lon, addedAt: new Date() },
            { upsert: true, new: true }
        );
        res.json({ success: true, city: doc });
    } catch(err) {
        if (err.code === 11000) return res.json({ success: true, message: 'Already saved' });
        res.status(500).json({ error: err.message });
    }
});

// Remove a favorite city
app.delete('/api/favorites/:sessionId/:city', async (req, res) => {
    try {
        await FavoriteCity.deleteOne({
            sessionId: req.params.sessionId,
            city: req.params.city
        });
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// =========================================================
// Start Server
// =========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
