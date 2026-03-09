const express = require('express');
const router = express.Router();
const { Order, Reservation, Parking, Review, MenuItem } = require('../models/index');
const { getMongoConnected } = require('../middleware/auth');

// Get stats
router.get('/', async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json({ totalMenuItems: 14, totalOrders: 0, totalReservations: 0, totalParking: 0, totalReviews: 0, averageRating: 0, yearsInBusiness: 15, dbStatus: 'offline' });
        const totalOrders = await Order.countDocuments();
        const totalReservations = await Reservation.countDocuments();
        const totalParking = await Parking.countDocuments();
        const totalReviews = await Review.countDocuments();
        const reviews = await Review.find();
        const averageRating = reviews.length > 0 ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1) : 0;
        res.json({ totalMenuItems: 14, totalOrders, totalReservations, totalParking, totalReviews, averageRating: parseFloat(averageRating), yearsInBusiness: 15, dbStatus: 'online' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
