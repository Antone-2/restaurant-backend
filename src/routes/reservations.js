const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { requireAdmin, getMongoConnected } = require('../middleware/auth');
const { Reservation, Table, Blacklist, TimeSlot } = require('../models/index');
const { sendReservationConfirmation, sendReservationReminder, sendReservationStatusUpdate, processReminders } = require('../services/reservationEmails');
const { sendReservationNotifications } = require('../services/notifications');
const { emitToRoom } = require('../utils/socket');

// Helper to check if a customer is blacklisted
const checkBlacklist = async (phone, email) => {
    const blacklistEntry = await Blacklist.findOne({
        $or: [
            { phone: phone, isActive: true },
            { email: email, isActive: true }
        ]
    });
    return blacklistEntry;
};

// GET available time slots for a specific date
router.get('/availability', async (req, res) => {
    try {
        const { date, guests } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }

        // Get day of week (0 = Sunday, 6 = Saturday)
        const dateObj = new Date(date);
        const dayOfWeek = dateObj.getDay();

        // Get active time slots for this day
        const timeSlots = await TimeSlot.find({
            dayOfWeek,
            isActive: true
        }).sort({ time: 1 });

        // If no time slots defined, return default slots
        if (!timeSlots || timeSlots.length === 0) {
            const defaultSlots = [
                { time: "09:00", timeLabel: "9:00 AM", maxBookings: 5 },
                { time: "10:00", timeLabel: "10:00 AM", maxBookings: 5 },
                { time: "11:00", timeLabel: "11:00 AM", maxBookings: 5 },
                { time: "12:00", timeLabel: "12:00 PM", maxBookings: 5 },
                { time: "13:00", timeLabel: "1:00 PM", maxBookings: 5 },
                { time: "14:00", timeLabel: "2:00 PM", maxBookings: 5 },
                { time: "15:00", timeLabel: "3:00 PM", maxBookings: 5 },
                { time: "16:00", timeLabel: "4:00 PM", maxBookings: 5 },
                { time: "17:00", timeLabel: "5:00 PM", maxBookings: 5 },
                { time: "18:00", timeLabel: "6:00 PM", maxBookings: 5 },
                { time: "19:00", timeLabel: "7:00 PM", maxBookings: 5 },
                { time: "20:00", timeLabel: "8:00 PM", maxBookings: 5 },
                { time: "21:00", timeLabel: "9:00 PM", maxBookings: 5 },
            ].map(slot => ({
                ...slot,
                currentBookings: 0,
                available: true,
                remainingSlots: slot.maxBookings,
                totalCapacity: 50
            }));
            return res.json({ date, slots: defaultSlots });
        }

        // Get all reservations for this date that are not cancelled
        const existingReservations = await Reservation.find({
            date,
            status: { $nin: ['cancelled'] }
        });

        // Get all tables
        const tables = await Table.find({ isActive: true });

        // Calculate available slots
        const availableSlots = timeSlots.map(slot => {
            // Count reservations at this time
            const reservationsAtTime = existingReservations.filter(r => r.time === slot.time);
            const reservedGuests = reservationsAtTime.reduce((sum, r) => sum + r.guests, 0);

            // Get available tables that can accommodate the party
            const availableTables = tables.filter(t =>
                t.capacity >= (parseInt(guests) || 1) &&
                t.status !== 'maintenance'
            );

            return {
                time: slot.time,
                timeLabel: slot.timeLabel || slot.time,
                maxBookings: slot.maxBookings,
                currentBookings: reservationsAtTime.length,
                available: reservationsAtTime.length < slot.maxBookings && availableTables.length > 0,
                remainingSlots: slot.maxBookings - reservationsAtTime.length,
                totalCapacity: tables.reduce((sum, t) => sum + t.capacity, 0)
            };
        });

        res.json({ date, slots: availableSlots });
    } catch (err) {
        console.error('Availability error:', err);
        res.status(500).json({ error: err.message, slots: [] });
    }
});

// GET available tables for a specific date and time
router.get('/tables', async (req, res) => {
    try {
        const { date, time, guests } = req.query;

        if (!date || !time) {
            return res.status(400).json({ error: 'Date and time are required' });
        }

        const partySize = parseInt(guests) || 2;

        // Get reservations at this date/time
        const reservationsAtTime = await Reservation.find({
            date,
            time,
            status: { $nin: ['cancelled'] }
        });

        const reservedTableIds = reservationsAtTime
            .filter(r => r.tableId)
            .map(r => r.tableId);

        // Get all available tables that can accommodate the party
        const availableTables = await Table.find({
            isActive: true,
            status: { $ne: 'maintenance' },
            capacity: { $gte: partySize },
            _id: { $nin: reservedTableIds }
        }).sort({ capacity: 1 });

        // Also get reserved tables info
        const reservedTables = await Table.find({
            _id: { $in: reservedTableIds }
        });

        res.json({
            available: availableTables,
            reserved: reservedTables,
            totalAvailable: availableTables.length
        });
    } catch (err) {
        console.error('Tables error:', err);
        res.status(500).json({ error: err.message });
    }
});

// CREATE reservation - simplified without transactions for better compatibility
router.post('/', async (req, res) => {
    try {
        // Check if MongoDB is connected
        if (!getMongoConnected()) {
            return res.status(503).json({ error: 'Database unavailable. Please try again later.' });
        }

        const { name, email, phone, date, time, guests, specialRequests, tableId } = req.body;

        // Validate required fields
        if (!name || !email || !phone || !date || !time || !guests) {
            return res.status(400).json({ error: 'All required fields must be provided' });
        }

        // Check blacklist (safely)
        let blacklisted = false;
        try {
            blacklisted = await checkBlacklist(phone, email);
        } catch (err) {
            console.debug('Blacklist check failed:', err.message);
        }

        if (blacklisted) {
            return res.status(403).json({
                error: 'You are not allowed to make reservations. Please contact us directly.',
                blacklisted: true
            });
        }

        const partySize = parseInt(guests);

        // Get available tables if no specific table requested
        let assignedTable = null;
        try {
            if (!tableId) {
                const reservationsAtTime = await Reservation.find({
                    date,
                    time,
                    status: { $nin: ['cancelled'] }
                });

                const reservedTableIds = reservationsAtTime
                    .filter(r => r.tableId)
                    .map(r => r.tableId);

                const availableTable = await Table.findOne({
                    isActive: true,
                    status: { $ne: 'maintenance' },
                    capacity: { $gte: partySize },
                    _id: { $nin: reservedTableIds }
                });

                if (availableTable) {
                    assignedTable = availableTable;
                }
            } else {
                assignedTable = await Table.findById(tableId);
            }
        } catch (err) {
            console.debug('Table lookup failed:', err.message);
        }

        // Create reservation
        const reservationId = 'RES-' + uuidv4().substring(0, 8).toUpperCase();

        const reservation = new Reservation({
            _id: reservationId,
            name,
            email,
            phone,
            date,
            time,
            guests: partySize,
            tableId: assignedTable?._id || null,
            tableName: assignedTable?.tableNumber || '',
            tableIds: assignedTable ? [assignedTable._id] : [],
            status: 'confirmed', // Auto-confirm for immediate booking
            specialRequests: specialRequests || '',
            createdAt: new Date(),
            updatedAt: new Date()
        });

        await reservation.save();

        // Update table status if assigned
        if (assignedTable) {
            try {
                await Table.findByIdAndUpdate(
                    assignedTable._id,
                    { status: 'reserved' }
                );
            } catch (err) {
                console.debug('Table update failed:', err.message);
            }
        }

        // Send confirmation email (async, don't wait for response)
        sendReservationConfirmation(reservation).catch(emailErr => {
            console.debug('Failed to send confirmation email:', emailErr.message);
        });

        // Send reservation notifications (to customer AND admin)
        sendReservationNotifications(reservation).catch(notifErr => {
            console.debug('Failed to send reservation notifications:', notifErr.message);
        });

        // Emit socket event (async, don't wait) - but don't crash if socket fails
        try {
            emitToRoom('admin', 'reservation:new', {
                reservationId: reservation._id,
                name: reservation.name,
                date: reservation.date,
                time: reservation.time,
                guests: reservation.guests,
                tableName: reservation.tableName,
                createdAt: reservation.createdAt
            }).catch(() => { });

            emitToRoom('reservations', 'reservation:created', {
                reservationId: reservation._id,
                status: 'confirmed'
            }).catch(() => { });
        } catch (socketErr) {
            console.debug('Socket emit error:', socketErr.message);
        }

        res.status(201).json({
            message: 'Reservation confirmed',
            reservationId: reservation._id,
            reservation: {
                ...reservation.toObject(),
                tableName: reservation.tableName
            }
        });

    } catch (err) {
        console.error('Reservation error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET all reservations (with optional filters)
router.get('/', async (req, res) => {
    try {
        const { date, status, email, startDate, endDate } = req.query;

        const query = {};

        if (date) {
            query.date = date;
        }

        if (status) {
            query.status = status;
        }

        if (email) {
            query.email = email;
        }

        if (startDate && endDate) {
            query.date = { $gte: startDate, $lte: endDate };
        }

        const reservations = await Reservation.find(query)
            .sort({ date: 1, time: 1 })
            .populate('tableId', 'tableNumber capacity location');

        res.json({ reservations });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET single reservation
router.get('/:id', async (req, res) => {
    try {
        const reservation = await Reservation.findById(req.params.id)
            .populate('tableId', 'tableNumber capacity location');

        if (!reservation) {
            return res.status(404).json({ error: 'Reservation not found' });
        }

        res.json({ reservation });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPDATE reservation
router.put('/:id', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { id } = req.params;
        const updates = req.body;

        const reservation = await Reservation.findById(id).session(session);

        if (!reservation) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ error: 'Reservation not found' });
        }

        // If changing date/time, check availability
        if (updates.date || updates.time) {
            const newDate = updates.date || reservation.date;
            const newTime = updates.time || reservation.time;

            const conflict = await Reservation.findOne({
                _id: { $ne: id },
                date: newDate,
                time: newTime,
                status: { $nin: ['cancelled'] }
            }).session(session);

            if (conflict) {
                await session.abortTransaction();
                session.endSession();
                return res.status(409).json({ error: 'Time slot is no longer available' });
            }
        }

        // Update reservation
        Object.assign(reservation, updates, { updatedAt: new Date() });
        await reservation.save({ session });

        await session.commitTransaction();
        session.endSession();

        emitToRoom('reservations', 'reservation:updated', {
            reservationId: id,
            updates
        });

        res.json({ message: 'Reservation updated', reservation });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).json({ error: err.message });
    }
});

// UPDATE reservation status
router.put('/:id/status', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ error: 'Status is required' });
        }

        const reservation = await Reservation.findById(id).session(session);

        if (!reservation) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ error: 'Reservation not found' });
        }

        const oldStatus = reservation.status;
        reservation.status = status;
        reservation.updatedAt = new Date();
        await reservation.save({ session });

        // If marking as no-show, check if should be blacklisted
        if (status === 'no-show') {
            // Check customer's no-show history
            const previousNoShows = await Reservation.countDocuments({
                email: reservation.email,
                phone: reservation.phone,
                status: 'no-show'
            }).session(session);

            if (previousNoShows >= 2) { // 3rd no-show triggers blacklist
                const existingBlacklist = await Blacklist.findOne({
                    phone: reservation.phone
                }).session(session);

                if (!existingBlacklist) {
                    const blacklistEntry = new Blacklist({
                        _id: 'BL-' + uuidv4().substring(0, 8).toUpperCase(),
                        customerName: reservation.name,
                        email: reservation.email,
                        phone: reservation.phone,
                        noShowCount: previousNoShows + 1,
                        reason: 'Multiple no-shows (3+)',
                        flaggedAt: new Date(),
                        history: [{
                            date: new Date(),
                            reservationId: reservation._id,
                            reason: 'No-show on ' + reservation.date
                        }]
                    });
                    await blacklistEntry.save({ session });
                } else {
                    existingBlacklist.noShowCount += 1;
                    existingBlacklist.history.push({
                        date: new Date(),
                        reservationId: reservation._id,
                        reason: 'No-show on ' + reservation.date
                    });
                    await existingBlacklist.save({ session });
                }
            }
        }

        // Release table if cancelled or completed
        if (status === 'cancelled' || status === 'completed' || status === 'no-show') {
            if (reservation.tableId) {
                await Table.findByIdAndUpdate(
                    reservation.tableId,
                    { status: 'available' },
                    { session }
                );
            }
        }

        await session.commitTransaction();
        session.endSession();

        // Send status update notification to customer
        try {
            await sendReservationStatusUpdate(reservation, status, oldStatus);
        } catch (emailErr) {
            console.error('Failed to send status update notification:', emailErr.message);
        }

        emitToRoom('reservations', 'reservation:statusChanged', {
            reservationId: id,
            status,
            oldStatus,
            updatedAt: new Date()
        });

        emitToRoom('admin', 'reservation:updated', {
            reservationId: id,
            status,
            oldStatus,
            updatedAt: new Date()
        });

        res.json({ message: 'Reservation status updated', reservation });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).json({ error: err.message });
    }
});

// DELETE reservation
router.delete('/:id', requireAdmin, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { id } = req.params;

        const reservation = await Reservation.findById(id).session(session);

        if (!reservation) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ error: 'Reservation not found' });
        }

        // Release table
        if (reservation.tableId) {
            await Table.findByIdAndUpdate(
                reservation.tableId,
                { status: 'available' },
                { session }
            );
        }

        await Reservation.findByIdAndDelete(id).session(session);

        await session.commitTransaction();
        session.endSession();

        emitToRoom('reservations', 'reservation:deleted', { reservationId: id });

        res.json({ message: 'Reservation deleted' });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).json({ error: err.message });
    }
});

// BLACKLIST routes
// Get blacklist
router.get('/blacklist/all', requireAdmin, async (req, res) => {
    try {
        const blacklist = await Blacklist.find({ isActive: true })
            .sort({ flaggedAt: -1 });
        res.json({ blacklist });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add to blacklist
router.post('/blacklist', requireAdmin, async (req, res) => {
    try {
        const { name, email, phone, reason, notes } = req.body;

        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Check if already blacklisted
        const existing = await Blacklist.findOne({ phone });
        if (existing) {
            return res.status(409).json({ error: 'Customer is already blacklisted' });
        }

        const blacklistEntry = new Blacklist({
            _id: 'BL-' + uuidv4().substring(0, 8).toUpperCase(),
            customerName: name,
            email,
            phone,
            reason: reason || 'Manually added',
            notes,
            noShowCount: 1,
            flaggedAt: new Date()
        });

        await blacklistEntry.save();

        res.status(201).json({ message: 'Customer added to blacklist', blacklist: blacklistEntry });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Remove from blacklist
router.delete('/blacklist/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const blacklistEntry = await Blacklist.findByIdAndUpdate(
            id,
            { isActive: false },
            { new: true }
        );

        if (!blacklistEntry) {
            return res.status(404).json({ error: 'Blacklist entry not found' });
        }

        res.json({ message: 'Customer removed from blacklist' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Check if blacklisted
router.post('/check-blacklist', async (req, res) => {
    try {
        const { phone, email } = req.body;

        const blacklisted = await Blacklist.findOne({
            $or: [
                { phone, isActive: true },
                { email, isActive: true }
            ]
        });

        res.json({ blacklisted: !!blacklisted, entry: blacklisted });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Process reminders (for cron job)
router.post('/process-reminders', async (req, res) => {
    try {
        const result = await processReminders();
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
