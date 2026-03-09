const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { requireAdmin } = require('../middleware/auth');
const { Review } = require('../models/index');
const { emitToRoom, emitToAll } = require('../utils/socket');

// Get reviews
router.get('/', async (req, res) => {
    try {
        const { status, visible } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;
        if (visible === 'true') query.isVisible = true;
        else if (visible === 'false' && !status) query.isVisible = true;
        const reviews = await Review.find(query).sort({ createdAt: -1 });
        res.json(reviews);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create review
router.post('/', async (req, res) => {
    try {
        const { name, rating, comment, orderId, userId, email } = req.body;
        if (!name || !rating || !comment) return res.status(400).json({ error: 'Name, rating, and comment are required' });
        const reviewId = 'REV-' + uuidv4().substring(0, 8).toUpperCase();
        const review = new Review({ _id: reviewId, name, rating, comment, orderId, userId, email, status: 'pending', isVisible: false });
        await review.save();
        emitToRoom('admin', 'review:new', { reviewId, name, rating, comment, createdAt: review.createdAt });
        res.status(201).json({ message: 'Review submitted for moderation', reviewId });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update review status (admin)
router.put('/admin/reviews/:id/status', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, adminReply } = req.body;
        if (!status) return res.status(400).json({ error: 'Status is required' });
        const updateData = { status, isVisible: status === 'approved', updatedAt: new Date() };
        if (adminReply !== undefined) updateData.adminReply = adminReply;
        const review = await Review.findByIdAndUpdate(id, updateData, { new: true });
        if (!review) return res.status(404).json({ error: 'Review not found' });
        emitToAll('review:updated', { reviewId: id, status, isVisible: review.isVisible });
        res.json({ message: 'Review status updated', review });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
