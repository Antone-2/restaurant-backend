const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, requireAdmin, getMongoConnected } = require('../middleware/auth');
const { Order } = require('../models/index');
const { sendOrderNotifications } = require('../services/notifications');
const { emitToRoom } = require('../utils/socket');

// Create order
router.post('/', async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database temporarily unavailable. Please try again in a moment.', orderId: 'ORD-' + uuidv4().substring(0, 8).toUpperCase(), status: 'pending' });
        const orderId = 'ORD-' + uuidv4().substring(0, 8).toUpperCase();

        // Ensure items have name field for proper display in notifications
        let orderData = { ...req.body };
        if (orderData.items && Array.isArray(orderData.items)) {
            orderData.items = orderData.items.map((item) => {
                // If name exists, return as is
                if (item.name) return item;
                // If menuItemId has a name property, use it
                if (item.menuItemId && typeof item.menuItemId === 'object' && item.menuItemId.name) {
                    return { ...item, name: item.menuItemId.name };
                }
                // If only menuItemId (string), keep it but mark as unknown
                return { ...item, name: item.menuItemId || 'Unknown Item' };
            });
        }

        const order = new Order({ _id: orderId, ...orderData });
        await order.save();
        await sendOrderNotifications(order);
        emitToRoom('admin', 'order:new', { orderId, customerName: order.customerName, total: order.total, status: order.status, items: order.items, createdAt: order.createdAt });
        emitToRoom('orders', 'order:created', { orderId, status: order.status });
        res.status(201).json({ message: 'Order placed', orderId });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Get orders
router.get('/', authenticateToken, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);
        let query = {};
        const { status, startDate, endDate, paymentStatus, search } = req.query;
        if (req.user) {
            const { User } = require('../models/index');
            const user = await User.findById(req.user.userId);
            if (user && user.email) {
                if (search) query.$or = [{ email: user.email }, { _id: new RegExp(search, 'i') }];
                else query.email = user.email;
            }
        } else { return res.json([]); }
        if (status && status !== 'all') query.status = status;
        if (paymentStatus && paymentStatus !== 'all') query.paymentStatus = paymentStatus;
        if (startDate || endDate) { query.createdAt = {}; if (startDate) query.createdAt.$gte = new Date(startDate); if (endDate) { const end = new Date(endDate); end.setHours(23, 59, 59, 999); query.createdAt.$lte = end; } }
        const orders = await Order.find(query).sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get order by ID
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database temporarily unavailable' });
        const { id } = req.params;
        const order = await Order.findById(id);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (req.user) {
            const { User, config } = require('../config');
            const user = await User.findById(req.user.userId);
            if (user && user.email !== order.email && !config.adminEmails.includes(user.email)) return res.status(403).json({ error: 'Access denied' });
        }

        // Resolve item names if they are "Unknown Item"
        const orderObj = order.toObject();
        if (orderObj.items && Array.isArray(orderObj.items)) {
            const { MenuItem } = require('../models/index');
            const menuItems = await MenuItem.find({});
            const menuItemMap = new Map();
            menuItems.forEach(item => {
                menuItemMap.set(item._id.toString(), item);
            });

            orderObj.items = orderObj.items.map(item => {
                // If name exists and is not 'Unknown Item', return as is
                if (item.name && item.name !== 'Unknown Item') return item;

                // Try to find the menu item by menuItemId
                if (item.menuItemId) {
                    const menuItemIdStr = item.menuItemId.toString();
                    const menuItem = menuItemMap.get(menuItemIdStr);
                    if (menuItem) {
                        return { ...item, name: menuItem.name };
                    }
                }

                // Return original item if no menu item found
                return item;
            });
        }

        res.json(orderObj);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update order status
router.put('/:id/status', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!status) return res.status(400).json({ error: 'Status is required' });
        const order = await Order.findByIdAndUpdate(id, { status }, { new: true });
        if (!order) return res.status(404).json({ error: 'Order not found' });
        emitToRoom('orders', 'order:statusChanged', { orderId: id, status, updatedAt: order.updatedAt });
        emitToRoom('admin', 'order:updated', { orderId: id, status, updatedAt: order.updatedAt });
        res.json({ message: 'Order status updated', order });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete order
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const order = await Order.findByIdAndDelete(id);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        res.json({ message: 'Order deleted' });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
