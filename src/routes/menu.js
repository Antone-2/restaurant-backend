const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { requireAdmin, getMongoConnected } = require('../middleware/auth');
const { MenuItem } = require('../models/index');

// Menu data (fallback) - with IDs
const menuData = [
    { _id: 'M-001', name: 'Crispy Calamari', description: 'Tender squid rings lightly battered', price: 1299, category: 'starters', popular: true, available: true, image: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=400', allergens: ['shellfish', 'gluten'], spicy: '' },
    { _id: 'M-002', name: 'Wagyu Beef Steak', description: 'Premium A5 Wagyu beef', price: 5499, category: 'mains', popular: true, available: true, image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400', allergens: [], spicy: '', popularTags: ['chef-special'] },
    { _id: 'M-003', name: 'Pan-Seared Salmon', description: 'Fresh Atlantic salmon', price: 2499, category: 'mains', popular: true, available: true, image: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400', dietaryTags: ['gluten-free'], allergens: ['fish'], spicy: '' },
    { _id: 'M-004', name: 'Herb Roasted Chicken', description: 'Free-range chicken', price: 1799, category: 'mains', popular: true, available: true, image: 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=400', dietaryTags: ['gluten-free'], allergens: [], spicy: '' },
    { _id: 'M-005', name: 'Spicy Chicken Wings', description: 'Crispy wings with hot sauce', price: 1199, category: 'starters', popular: true, available: true, image: 'https://images.unsplash.com/photo-1608039755401-742074f0548d?w=400', allergens: ['gluten'], spicy: 'hot', popularTags: ['customer-favourite'] },
    { _id: 'M-006', name: 'Signature Cocktail', description: 'House cocktail', price: 1499, category: 'drinks', popular: true, available: true, image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400', dietaryTags: ['vegan', 'gluten-free'], allergens: [], spicy: '' },
    { _id: 'M-007', name: "Chef's Tasting Menu", description: '7-course journey', price: 4999, category: 'specials', popular: true, available: true, image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400', allergens: ['shellfish', 'dairy', 'gluten'], spicy: 'mild', popularTags: ['chef-special'] },
    { _id: 'M-008', name: 'Seafood Platter', description: 'Fresh seafood selection', price: 4499, category: 'specials', popular: true, available: true, image: 'https://images.unsplash.com/photo-1559847844-5315695dadae?w=400', allergens: ['shellfish', 'fish'], spicy: '', popularTags: ['customer-favourite'] },
];

// Get menu items
router.get('/', async (req, res) => {
    try {
        const { category, search, page = 1, limit = 50 } = req.query;
        let query = {};
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 50;
        if (category && category !== 'all') query.category = category;

        // Only use fallback data when MongoDB is not connected
        if (!getMongoConnected()) {
            let items = menuData;
            if (category && category !== 'all') items = items.filter(i => i.category === category);
            if (search) { const s = search.toLowerCase(); items = items.filter(i => i.name.toLowerCase().includes(s) || i.description.toLowerCase().includes(s)); }
            return res.json({ data: items, pagination: { total: items.length, page: pageNum, limit: limitNum, totalPages: Math.ceil(items.length / limitNum) } });
        }

        let items = await MenuItem.find(query);
        if (search) { const s = search.toLowerCase(); items = items.filter(i => i.name.toLowerCase().includes(s) || i.description.toLowerCase().includes(s)); }

        // Only return actual database items - don't fall back to demo data if empty
        res.json({ data: items, pagination: { total: items.length, page: pageNum, limit: limitNum, totalPages: Math.ceil(items.length / limitNum) } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create menu item
router.post('/', requireAdmin, async (req, res) => {
    try {
        const { name, description, price, category, image, imageUrl, popular, available, stockQuantity, dietaryTags, spicy, allergens, popularTags, nutritionalInfo, lowStockThreshold, trackInventory } = req.body;
        if (!name || !price || !category) return res.status(400).json({ error: 'Name, price, and category are required' });
        const menuItemId = 'M-' + uuidv4().substring(0, 8).toUpperCase();
        const menuItem = new MenuItem({ _id: menuItemId, name, description: description || '', price, category, image: image || imageUrl || '', imageUrl: imageUrl || image || '', popular: popular || false, available: available !== false, stockQuantity: stockQuantity || 0, lowStockThreshold: lowStockThreshold || 5, trackInventory: trackInventory || false, dietaryTags: dietaryTags || [], spicy: spicy || '', allergens: allergens || [], popularTags: popularTags || [], nutritionalInfo: nutritionalInfo || { calories: 0, protein: 0, carbohydrates: 0, fat: 0, fiber: 0, sodium: 0, allergens: [], dietaryInfo: [] } });
        await menuItem.save();
        res.status(201).json({ message: 'Menu item created', menuItem });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update menu item
router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const menuItem = await MenuItem.findByIdAndUpdate(id, { ...req.body, updatedAt: new Date() }, { new: true });
        if (!menuItem) return res.status(404).json({ error: 'Menu item not found' });
        res.json({ message: 'Menu item updated', menuItem });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete menu item
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // If MongoDB is not connected, check if it's a fallback item
        if (!getMongoConnected()) {
            const fallbackIndex = menuData.findIndex(item => item._id === id);
            if (fallbackIndex !== -1) {
                // Can't delete from static fallback data
                return res.status(400).json({ error: 'Cannot delete fallback menu items when database is not connected' });
            }
            return res.status(404).json({ error: 'Menu item not found' });
        }

        const menuItem = await MenuItem.findByIdAndDelete(id);
        if (!menuItem) return res.status(404).json({ error: 'Menu item not found' });
        res.json({ message: 'Menu item deleted' });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
