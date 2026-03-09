const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { Cart } = require('../models/index');

// Get cart
router.get('/', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        let cart = await Cart.findOne({ userId: req.user.userId });
        if (!cart) { cart = new Cart({ _id: uuidv4(), userId: req.user.userId, items: [] }); await cart.save(); }
        res.json(cart);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add item to cart
router.post('/items', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const { menuItemId, name, price, quantity, specialInstructions } = req.body;
        if (!menuItemId || !name || !price || quantity <= 0) return res.status(400).json({ error: 'Invalid item data' });
        let cart = await Cart.findOne({ userId: req.user.userId });
        if (!cart) cart = new Cart({ _id: uuidv4(), userId: req.user.userId, items: [] });
        const existingItem = cart.items.find(item => item.menuItemId === menuItemId);
        if (existingItem) existingItem.quantity += quantity;
        else cart.items.push({ menuItemId, name, price, quantity, specialInstructions: specialInstructions || '', addedAt: new Date() });
        cart.updatedAt = new Date();
        await cart.save();
        res.json({ message: 'Item added to cart', cart });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update cart item
router.put('/items/:itemId', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const { itemId } = req.params;
        const { quantity, specialInstructions } = req.body;
        const cart = await Cart.findOne({ userId: req.user.userId });
        if (!cart) return res.status(404).json({ error: 'Cart not found' });
        const item = cart.items.find(item => item.menuItemId === itemId);
        if (!item) return res.status(404).json({ error: 'Item in cart' });
        if (quantity <= 0) cart.items = cart.items.filter(i => i.menuItemId !== itemId);
        else { item.quantity = quantity; if (specialInstructions) item.specialInstructions = specialInstructions; }
        cart.updatedAt = new Date();
        await cart.save();
        res.json({ message: 'Cart updated', cart });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Remove item from cart
router.delete('/items/:itemId', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const { itemId } = req.params;
        const cart = await Cart.findOne({ userId: req.user.userId });
        if (!cart) return res.status(404).json({ error: 'Cart not found' });
        cart.items = cart.items.filter(item => item.menuItemId !== itemId);
        cart.updatedAt = new Date();
        await cart.save();
        res.json({ message: 'Item removed from cart' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Clear cart
router.delete('/', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        await Cart.findOneAndDelete({ userId: req.user.userId });
        res.json({ message: 'Cart cleared' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update cart metadata
router.put('/', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const { orderType, selectedAddress, appliedCoupon, notes } = req.body;
        let cart = await Cart.findOne({ userId: req.user.userId });
        if (!cart) cart = new Cart({ _id: uuidv4(), userId: req.user.userId });
        if (orderType) cart.orderType = orderType;
        if (selectedAddress) cart.selectedAddress = selectedAddress;
        if (appliedCoupon) cart.appliedCoupon = appliedCoupon;
        if (notes !== undefined) cart.notes = notes;
        cart.updatedAt = new Date();
        await cart.save();
        res.json({ message: 'Cart updated', cart });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
