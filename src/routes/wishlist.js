const express = require('express');
const router = express.Router();
const { authenticateToken, getMongoConnected } = require('../middleware/auth');
const { Wishlist } = require('../models/index');

// Get wishlist
router.get('/', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        if (!getMongoConnected()) return res.json({ items: [] });
        let wishlist = await Wishlist.findOne({ userId: req.user.userId });
        if (!wishlist) { wishlist = new Wishlist({ _id: 'WISHLIST-' + req.user.userId, userId: req.user.userId, items: [] }); await wishlist.save(); }
        res.json({ items: wishlist.items });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add to wishlist
router.post('/', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const { menuItemId, name, price, image, category } = req.body;
        if (!menuItemId || !name) return res.status(400).json({ error: 'Menu item ID and name are required' });
        if (!mongoConnected) return res.status(503).json({ error: 'Database temporarily unavailable' });
        let wishlist = await Wishlist.findOne({ userId: req.user.userId });
        if (!wishlist) wishlist = new Wishlist({ _id: 'WISHLIST-' + req.user.userId, userId: req.user.userId, items: [] });
        const existingItem = wishlist.items.find(item => item.menuItemId === menuItemId);
        if (existingItem) return res.json({ message: 'Item already in wishlist', items: wishlist.items });
        wishlist.items.push({ menuItemId, name, price: price || 0, image: image || '', category: category || '', addedAt: new Date() });
        wishlist.updatedAt = new Date();
        await wishlist.save();
        res.status(201).json({ message: 'Item added to wishlist', items: wishlist.items });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Remove from wishlist
router.delete('/:itemId', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const { itemId } = req.params;
        if (!mongoConnected) return res.status(503).json({ error: 'Database temporarily unavailable' });
        const wishlist = await Wishlist.findOne({ userId: req.user.userId });
        if (!wishlist) return res.json({ message: 'Wishlist is empty', items: [] });
        wishlist.items = wishlist.items.filter(item => item.menuItemId !== itemId);
        wishlist.updatedAt = new Date();
        await wishlist.save();
        res.json({ message: 'Item removed from wishlist', items: wishlist.items });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
