const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, getMongoConnected } = require('../middleware/auth');
const { LoyaltyPoints } = require('../models/index');

// Get loyalty points
router.get('/points', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        if (!getMongoConnected()) return res.json({ points: 0, tier: 'bronze', lifetimePoints: 0, pointsHistory: [] });
        let loyalty = await LoyaltyPoints.findOne({ userId: req.user.userId });
        if (!loyalty) { const referralCode = 'REF-' + uuidv4().substring(0, 8).toUpperCase(); loyalty = new LoyaltyPoints({ _id: 'LOYAL-' + req.user.userId, userId: req.user.userId, points: 0, lifetimePoints: 0, tier: 'bronze', referralCode, pointsHistory: [] }); await loyalty.save(); }
        res.json({ points: loyalty.points, tier: loyalty.tier, lifetimePoints: loyalty.lifetimePoints, referralCode: loyalty.referralCode, pointsHistory: loyalty.pointsHistory || [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Earn points
router.post('/earn', async (req, res) => {
    try {
        const { userId, orderTotal } = req.body;
        if (!userId || !orderTotal) return res.status(400).json({ error: 'User ID and order total are required' });
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const pointsEarned = Math.floor(orderTotal / 10);
        let loyalty = await LoyaltyPoints.findOne({ userId });
        if (!loyalty) { const referralCode = 'REF-' + uuidv4().substring(0, 8).toUpperCase(); loyalty = new LoyaltyPoints({ _id: 'LOYAL-' + userId, userId, points: pointsEarned, lifetimePoints: pointsEarned, tier: 'bronze', referralCode, pointsHistory: [{ points: pointsEarned, type: 'earn', description: 'Points earned', createdAt: new Date() }] }); }
        else { loyalty.points += pointsEarned; loyalty.lifetimePoints += pointsEarned; loyalty.pointsHistory = loyalty.pointsHistory || []; loyalty.pointsHistory.push({ points: pointsEarned, type: 'earn', description: 'Points earned', createdAt: new Date() }); }
        loyalty.updatedAt = new Date();
        await loyalty.save();
        res.json({ message: 'Points earned successfully', pointsEarned, totalPoints: loyalty.points, tier: loyalty.tier });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Redeem points
router.post('/redeem', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        const { points } = req.body;
        if (!points || points <= 0) return res.status(400).json({ error: 'Valid points amount is required' });
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const loyalty = await LoyaltyPoints.findOne({ userId: req.user.userId });
        if (!loyalty) return res.status(404).json({ error: 'Loyalty account not found' });
        if (loyalty.points < points) return res.status(400).json({ error: 'Insufficient points balance' });
        loyalty.points -= points;
        loyalty.pointsHistory = loyalty.pointsHistory || [];
        loyalty.pointsHistory.push({ points, type: 'redeem', description: 'Points redeemed', createdAt: new Date() });
        loyalty.updatedAt = new Date();
        await loyalty.save();
        res.json({ message: 'Points redeemed successfully', remainingPoints: loyalty.points, tier: loyalty.tier });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
