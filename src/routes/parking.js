const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Parking } = require('../models/index');
const { sendParkingNotifications } = require('../services/notifications');
const { emitToRoom } = require('../utils/socket');

// Pricing based on vehicle type and duration
const getParkingPrice = (vehicleType, duration) => {
    const basePrices = {
        'sedan': 200,
        'suv': 250,
        'van': 300,
        'motorcycle': 150,
        'Sedan': 200,
        'SUV': 250,
        'Van': 300,
        'Motorcycle': 150
    };

    const basePrice = basePrices[vehicleType] || 200;

    // Discount for longer durations
    if (duration >= 24) return basePrice * 24 * 0.7; // 30% off for daily
    if (duration >= 12) return basePrice * duration * 0.85; // 15% off for 12+ hours
    if (duration >= 6) return basePrice * duration * 0.9; // 10% off for 6+ hours
    return basePrice * duration;
};

// Calculate price endpoint
router.post('/calculate-price', async (req, res) => {
    try {
        const { vehicleType, duration } = req.body;
        const price = getParkingPrice(vehicleType, duration);
        res.json({ price: Math.round(price) });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Create parking reservation (with optional payment)
router.post('/', async (req, res) => {
    try {
        const reservationId = 'PRK-' + uuidv4().substring(0, 8).toUpperCase();
        const slotNumber = 'P' + Math.floor(Math.random() * 50) + 1;

        // Calculate price
        const price = getParkingPrice(req.body.vehicleType || req.body.vehicle, req.body.duration || req.body.hours || 1);

        // Log incoming data for debugging
        console.log('[Parking Route] Received data:', JSON.stringify(req.body));

        // Ensure all required fields are present with defaults
        const parkingData = {
            _id: reservationId,
            slotNumber,
            name: req.body.name,
            email: req.body.email,
            phone: req.body.phone,
            vehicleType: req.body.vehicleType || req.body.vehicle || 'Not specified',
            vehiclePlate: req.body.vehiclePlate || req.body.plate || 'Not specified',
            date: req.body.date,
            time: req.body.time,
            duration: req.body.duration || req.body.hours || 1,
            price: Math.round(price),
            paymentStatus: req.body.paymentMethod ? 'pending' : 'unpaid',
            paymentMethod: req.body.paymentMethod || null,
            paidAt: null
        };

        console.log('[Parking Route] Saving with data:', JSON.stringify(parkingData));

        const parking = new Parking(parkingData);
        await parking.save();

        // Log saved data
        console.log('[Parking Route] Saved parking:', JSON.stringify({
            _id: parking._id,
            vehicleType: parking.vehicleType,
            duration: parking.duration,
            price: parking.price,
            paymentStatus: parking.paymentStatus
        }));

        // If payment is required, initiate M-Pesa payment
        if (req.body.paymentMethod === 'mpesa' && req.body.phoneNumber) {
            try {
                // Import M-Pesa service
                const { initiateMpesaPayment } = require('../mpesa');

                const mpesaResult = await initiateMpesaPayment({
                    phoneNumber: req.body.phoneNumber,
                    amount: Math.round(price),
                    accountReference: reservationId,
                    transactionDesc: `Parking Reservation - ${slotNumber}`
                });

                // Update parking with M-Pesa details
                parking.mpesaCheckoutRequestId = mpesaResult.CheckoutRequestID;
                parking.mpesaMerchantId = mpesaResult.MerchantRequestID;
                parking.paymentStatus = 'pending';
                await parking.save();

                res.status(201).json({
                    message: 'Payment initiated',
                    reservationId,
                    slotNumber,
                    email: parking.email,
                    date: parking.date,
                    time: parking.time,
                    duration: parking.duration,
                    vehicleType: parking.vehicleType,
                    vehiclePlate: parking.vehiclePlate,
                    price: parking.price,
                    paymentStatus: 'pending',
                    checkoutRequestId: mpesaResult.CheckoutRequestID,
                    requiresPaymentConfirmation: true
                });
                return;
            } catch (mpesaError) {
                console.error('[Parking] M-Pesa error:', mpesaError.message);
                // Continue with reservation but mark payment as failed
                parking.paymentStatus = 'failed';
                await parking.save();
            }
        }

        // Send notifications for booking without immediate payment
        await sendParkingNotifications(parking);
        emitToRoom('admin', 'parking:new', { reservationId, name: parking.name, vehiclePlate: parking.vehiclePlate, slotNumber, date: parking.date, time: parking.time, createdAt: parking.createdAt });

        res.status(201).json({
            message: 'Parking reserved',
            reservationId,
            slotNumber,
            email: parking.email,
            date: parking.date,
            time: parking.time,
            duration: parking.duration,
            vehicleType: parking.vehicleType,
            vehiclePlate: parking.vehiclePlate,
            price: parking.price,
            paymentStatus: parking.paymentStatus,
            paymentInstructions: parking.paymentStatus === 'unpaid' ? 'Please pay at the venue or use M-Pesa to complete your payment.' : undefined
        });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Check payment status
router.get('/:id/payment-status', async (req, res) => {
    try {
        const parking = await Parking.findById(req.params.id);
        if (!parking) {
            return res.status(404).json({ error: 'Reservation not found' });
        }

        // If payment is pending with M-Pesa, check status
        if (parking.paymentStatus === 'pending' && parking.mpesaCheckoutRequestId) {
            try {
                const { checkMpesaStatus } = require('../mpesa');
                const mpesaStatus = await checkMpesaStatus(parking.mpesaCheckoutRequestId);

                if (mpesaStatus.success || mpesaStatus.ResultCode === '0') {
                    parking.paymentStatus = 'paid';
                    parking.paidAt = new Date();
                    await parking.save();
                }
            } catch (e) {
                console.log('[Parking] Payment status check error:', e.message);
            }
        }

        res.json({
            reservationId: parking._id,
            paymentStatus: parking.paymentStatus,
            price: parking.price
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get parking reservations
router.get('/', async (req, res) => {
    try {
        const parking = await Parking.find().sort({ createdAt: -1 });
        console.log('[Parking GET] Found', parking.length, 'parking reservations');
        if (parking.length > 0) {
            console.log('[Parking GET] Sample IDs:', parking.slice(0, 3).map(p => p._id));
        }
        res.json(parking);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get single parking reservation by ID
router.get('/:id', async (req, res) => {
    try {
        const parking = await Parking.findById(req.params.id);
        if (!parking) {
            return res.status(404).json({ error: 'Parking reservation not found' });
        }
        res.json(parking);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: Add new parking reservation
router.post('/admin/add', async (req, res) => {
    try {
        const reservationId = 'PRK-' + uuidv4().substring(0, 8).toUpperCase();
        console.log('[Parking Admin Add] Creating parking with ID:', reservationId);
        const slotNumber = req.body.slotNumber || 'P' + Math.floor(Math.random() * 50) + 1;

        // Calculate price
        const price = getParkingPrice(req.body.vehicleType || req.body.vehicle, req.body.duration || req.body.hours || 1);

        const parkingData = {
            _id: reservationId,
            slotNumber,
            name: req.body.name,
            email: req.body.email,
            phone: req.body.phone,
            vehicleType: req.body.vehicleType || req.body.vehicle || 'Not specified',
            vehiclePlate: req.body.vehiclePlate || req.body.plate || 'Not specified',
            date: req.body.date,
            time: req.body.time,
            duration: req.body.duration || req.body.hours || 1,
            price: Math.round(price),
            paymentStatus: req.body.paymentStatus || 'unpaid',
            paymentMethod: req.body.paymentMethod || null,
            paidAt: req.body.paymentStatus === 'paid' ? new Date() : null
        };

        console.log('[Parking Admin Add] Parking data:', JSON.stringify(parkingData));

        const parking = new Parking(parkingData);
        await parking.save();

        console.log('[Parking Admin Add] Saved parking with ID:', parking._id);

        res.status(201).json({
            message: 'Parking reservation created',
            parking
        });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Admin: Update parking reservation
router.put('/:id', async (req, res) => {
    try {
        const parking = await Parking.findById(req.params.id);
        if (!parking) {
            return res.status(404).json({ error: 'Parking reservation not found' });
        }

        // Update fields
        if (req.body.name) parking.name = req.body.name;
        if (req.body.email) parking.email = req.body.email;
        if (req.body.phone) parking.phone = req.body.phone;
        if (req.body.vehicleType) parking.vehicleType = req.body.vehicleType;
        if (req.body.vehiclePlate) parking.vehiclePlate = req.body.vehiclePlate;
        if (req.body.date) parking.date = req.body.date;
        if (req.body.time) parking.time = req.body.time;
        if (req.body.duration) parking.duration = req.body.duration;
        if (req.body.slotNumber) parking.slotNumber = req.body.slotNumber;
        if (req.body.paymentStatus) {
            parking.paymentStatus = req.body.paymentStatus;
            if (req.body.paymentStatus === 'paid' && !parking.paidAt) {
                parking.paidAt = new Date();
            }
        }
        if (req.body.paymentMethod) parking.paymentMethod = req.body.paymentMethod;

        // Recalculate price if vehicle type or duration changed
        if (req.body.vehicleType || req.body.duration) {
            const newPrice = getParkingPrice(parking.vehicleType, parking.duration);
            parking.price = Math.round(newPrice);
        }

        await parking.save();

        res.json({
            message: 'Parking reservation updated',
            parking
        });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Admin: Delete parking reservation
router.delete('/:id', async (req, res) => {
    try {
        console.log('[Parking Delete] Attempting to delete ID:', req.params.id);
        const parking = await Parking.findById(req.params.id);
        if (!parking) {
            console.log('[Parking Delete] Parking not found for ID:', req.params.id);
            // Try to find all parking to debug
            const allParking = await Parking.find().limit(5);
            console.log('[Parking Delete] Sample parking IDs:', allParking.map(p => p._id));
            return res.status(404).json({ error: 'Parking reservation not found' });
        }

        console.log('[Parking Delete] Found parking:', parking._id);
        await Parking.findByIdAndDelete(req.params.id);

        res.json({ message: 'Parking reservation deleted successfully' });
    } catch (err) {
        console.error('[Parking Delete] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
