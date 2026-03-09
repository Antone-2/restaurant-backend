/**
 * Reservation System Routes
 * Handles TimeSlots, Blacklist, and availability checking
 */

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Function to get models - will be called after all models are registered
const getModels = () => {
    const TimeSlot = mongoose.models.TimeSlot || mongoose.model('TimeSlot');
    const Blacklist = mongoose.models.Blacklist || mongoose.model('Blacklist');
    return { TimeSlot, Blacklist };
};

module.exports = (app, requireAdmin, mongoConnected) => {
    const { TimeSlot, Blacklist } = getModels();

    // ============ PUBLIC ENDPOINTS ============

    // Check if customer is blacklisted
    app.get('/api/reservations/check-blacklist', async (req, res) => {
        try {
            const { phone, email } = req.query;

            if (!phone && !email) {
                return res.status(400).json({ error: 'Phone or email is required' });
            }

            if (!mongoConnected) {
                return res.json({ isBlacklisted: false });
            }

            const query = {};
            if (phone) query.phone = phone;
            if (email) query.email = email;

            const entry = await Blacklist.findOne(query);

            if (entry && entry.isActive) {
                return res.json({
                    isBlacklisted: true,
                    requiresManualApproval: entry.requiresManualApproval,
                    reason: entry.reason
                });
            }

            res.json({ isBlacklisted: false });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get available time slots for a specific date
    app.get('/api/timeslots/available', async (req, res) => {
        try {
            const { date } = req.query;

            if (!date) {
                return res.status(400).json({ error: 'Date is required' });
            }

            if (!mongoConnected) {
                // Return default time slots if DB not connected
                const defaultSlots = [
                    { id: '11:00', label: '11:00 AM', available: true },
                    { id: '12:00', label: '12:00 PM', available: true },
                    { id: '13:00', label: '1:00 PM', available: true },
                    { id: '18:00', label: '6:00 PM', available: true },
                    { id: '19:00', label: '7:00 PM', available: true },
                    { id: '20:00', label: '8:00 PM', available: true },
                ];
                return res.json({ timeSlots: defaultSlots });
            }

            const requestedDate = new Date(date);
            const dayOfWeek = requestedDate.getDay();

            const timeSlots = await TimeSlot.find({
                dayOfWeek,
                isActive: true
            }).sort({ time: 1 });

            const dateStr = date.toString().split('T')[0];

            // Get Reservation model dynamically to avoid circular dependency
            const Reservation = mongoose.model('Reservation');
            const existingReservations = await Reservation.find({
                date: { $regex: dateStr },
                status: { $in: ['pending', 'confirmed'] }
            });

            const reservedCount = {};
            existingReservations.forEach(res => {
                reservedCount[res.time] = (reservedCount[res.time] || 0) + res.guests;
            });

            const availableSlots = timeSlots.map(slot => ({
                id: slot.time,
                label: slot.timeLabel || slot.time,
                available: slot.currentBookings < slot.maxBookings,
                maxBookings: slot.maxBookings,
                currentBookings: slot.currentBookings
            }));

            res.json({ timeSlots: availableSlots });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ============ ADMIN ENDPOINTS - TIME SLOTS ============

    // Get all time slots
    app.get('/api/admin/timeslots', requireAdmin, async (req, res) => {
        try {
            if (!mongoConnected) {
                return res.json({ timeSlots: [] });
            }

            const timeSlots = await TimeSlot.find({}).sort({ dayOfWeek: 1, time: 1 });
            res.json({ timeSlots });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Create time slot
    app.post('/api/admin/timeslots', requireAdmin, async (req, res) => {
        try {
            if (!mongoConnected) {
                return res.status(503).json({ error: 'Database not connected' });
            }

            const { dayOfWeek, time, timeLabel, maxBookings, isActive } = req.body;

            if (dayOfWeek === undefined || !time) {
                return res.status(400).json({ error: 'Day of week and time are required' });
            }

            const existingSlot = await TimeSlot.findOne({ dayOfWeek, time });
            if (existingSlot) {
                return res.status(409).json({ error: 'Time slot already exists for this day' });
            }

            const timeSlotId = 'TS-' + uuidv4().substring(0, 8).toUpperCase();
            const newTimeSlot = new TimeSlot({
                _id: timeSlotId,
                dayOfWeek,
                time,
                timeLabel: timeLabel || time,
                maxBookings: maxBookings || 10,
                isActive: isActive !== false,
                currentBookings: 0
            });

            await newTimeSlot.save();
            res.status(201).json({ message: 'Time slot created', timeSlot: newTimeSlot });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Update time slot
    app.put('/api/admin/timeslots/:id', requireAdmin, async (req, res) => {
        try {
            if (!mongoConnected) {
                return res.status(503).json({ error: 'Database not connected' });
            }

            const { id } = req.params;
            const { maxBookings, isActive, timeLabel } = req.body;

            const timeSlot = await TimeSlot.findById(id);
            if (!timeSlot) {
                return res.status(404).json({ error: 'Time slot not found' });
            }

            if (maxBookings !== undefined) timeSlot.maxBookings = maxBookings;
            if (isActive !== undefined) timeSlot.isActive = isActive;
            if (timeLabel !== undefined) timeSlot.timeLabel = timeLabel;
            timeSlot.updatedAt = new Date();

            await timeSlot.save();
            res.json({ message: 'Time slot updated', timeSlot });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Delete time slot
    app.delete('/api/admin/timeslots/:id', requireAdmin, async (req, res) => {
        try {
            if (!mongoConnected) {
                return res.status(503).json({ error: 'Database not connected' });
            }

            const { id } = req.params;
            const timeSlot = await TimeSlot.findByIdAndDelete(id);

            if (!timeSlot) {
                return res.status(404).json({ error: 'Time slot not found' });
            }

            res.json({ message: 'Time slot deleted' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ============ ADMIN ENDPOINTS - BLACKLIST ============

    // Get all blacklist entries
    app.get('/api/admin/blacklist', requireAdmin, async (req, res) => {
        try {
            if (!mongoConnected) {
                return res.json({ blacklist: [] });
            }

            const blacklist = await Blacklist.find({}).sort({ noShowCount: -1, flaggedAt: -1 });
            res.json({ blacklist });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Add to blacklist
    app.post('/api/admin/blacklist', requireAdmin, async (req, res) => {
        try {
            if (!mongoConnected) {
                return res.status(503).json({ error: 'Database not connected' });
            }

            const { customerName, email, phone, reason, notes, requiresManualApproval } = req.body;

            if (!customerName || !phone) {
                return res.status(400).json({ error: 'Customer name and phone are required' });
            }

            const existing = await Blacklist.findOne({ phone });
            if (existing) {
                existing.noShowCount += 1;
                existing.history.push({ date: new Date(), reason: reason || 'Additional no-show' });
                if (existing.noShowCount >= 3) {
                    existing.requiresManualApproval = true;
                }
                existing.updatedAt = new Date();
                await existing.save();
                return res.json({ message: 'Blacklist entry updated', blacklist: existing });
            }

            const blacklistId = 'BL-' + uuidv4().substring(0, 8).toUpperCase();
            const newEntry = new Blacklist({
                _id: blacklistId,
                customerName,
                email: email || '',
                phone,
                noShowCount: 1,
                reason: reason || '',
                notes: notes || '',
                requiresManualApproval: requiresManualApproval || false,
                history: [{
                    date: new Date(),
                    reason: reason || 'Initial no-show'
                }]
            });

            await newEntry.save();
            res.status(201).json({ message: 'Customer added to blacklist', blacklist: newEntry });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Update blacklist entry
    app.put('/api/admin/blacklist/:id', requireAdmin, async (req, res) => {
        try {
            if (!mongoConnected) {
                return res.status(503).json({ error: 'Database not connected' });
            }

            const { id } = req.params;
            const { isActive, notes, requiresManualApproval } = req.body;

            const entry = await Blacklist.findById(id);
            if (!entry) {
                return res.status(404).json({ error: 'Blacklist entry not found' });
            }

            if (isActive !== undefined) entry.isActive = isActive;
            if (notes !== undefined) entry.notes = notes;
            if (requiresManualApproval !== undefined) entry.requiresManualApproval = requiresManualApproval;
            entry.updatedAt = new Date();

            await entry.save();
            res.json({ message: 'Blacklist entry updated', blacklist: entry });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Remove from blacklist
    app.delete('/api/admin/blacklist/:id', requireAdmin, async (req, res) => {
        try {
            if (!mongoConnected) {
                return res.status(503).json({ error: 'Database not connected' });
            }

            const { id } = req.params;
            const entry = await Blacklist.findByIdAndDelete(id);

            if (!entry) {
                return res.status(404).json({ error: 'Blacklist entry not found' });
            }

            res.json({ message: 'Blacklist entry removed' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ============ INITIALIZATION ============

    // Initialize default time slots
    const initDefaultTimeSlots = async () => {
        if (!mongoConnected) return;

        const existingSlots = await TimeSlot.countDocuments();
        if (existingSlots > 0) return;

        const defaultSlots = [
            // Tuesday (2)
            { dayOfWeek: 2, time: '11:00', timeLabel: '11:00 AM', maxBookings: 8 },
            { dayOfWeek: 2, time: '11:30', timeLabel: '11:30 AM', maxBookings: 8 },
            { dayOfWeek: 2, time: '12:00', timeLabel: '12:00 PM', maxBookings: 10 },
            { dayOfWeek: 2, time: '12:30', timeLabel: '12:30 PM', maxBookings: 10 },
            { dayOfWeek: 2, time: '13:00', timeLabel: '1:00 PM', maxBookings: 10 },
            { dayOfWeek: 2, time: '13:30', timeLabel: '1:30 PM', maxBookings: 8 },
            { dayOfWeek: 2, time: '18:00', timeLabel: '6:00 PM', maxBookings: 12 },
            { dayOfWeek: 2, time: '18:30', timeLabel: '6:30 PM', maxBookings: 12 },
            { dayOfWeek: 2, time: '19:00', timeLabel: '7:00 PM', maxBookings: 15 },
            { dayOfWeek: 2, time: '19:30', timeLabel: '7:30 PM', maxBookings: 15 },
            { dayOfWeek: 2, time: '20:00', timeLabel: '8:00 PM', maxBookings: 12 },
            { dayOfWeek: 2, time: '20:30', timeLabel: '8:30 PM', maxBookings: 10 },
            { dayOfWeek: 2, time: '21:00', timeLabel: '9:00 PM', maxBookings: 8 },
            // Wednesday (3)
            { dayOfWeek: 3, time: '11:00', timeLabel: '11:00 AM', maxBookings: 8 },
            { dayOfWeek: 3, time: '11:30', timeLabel: '11:30 AM', maxBookings: 8 },
            { dayOfWeek: 3, time: '12:00', timeLabel: '12:00 PM', maxBookings: 10 },
            { dayOfWeek: 3, time: '12:30', timeLabel: '12:30 PM', maxBookings: 10 },
            { dayOfWeek: 3, time: '13:00', timeLabel: '1:00 PM', maxBookings: 10 },
            { dayOfWeek: 3, time: '13:30', timeLabel: '1:30 PM', maxBookings: 8 },
            { dayOfWeek: 3, time: '18:00', timeLabel: '6:00 PM', maxBookings: 12 },
            { dayOfWeek: 3, time: '18:30', timeLabel: '6:30 PM', maxBookings: 12 },
            { dayOfWeek: 3, time: '19:00', timeLabel: '7:00 PM', maxBookings: 15 },
            { dayOfWeek: 3, time: '19:30', timeLabel: '7:30 PM', maxBookings: 15 },
            { dayOfWeek: 3, time: '20:00', timeLabel: '8:00 PM', maxBookings: 12 },
            { dayOfWeek: 3, time: '20:30', timeLabel: '8:30 PM', maxBookings: 10 },
            { dayOfWeek: 3, time: '21:00', timeLabel: '9:00 PM', maxBookings: 8 },
            // Thursday (4)
            { dayOfWeek: 4, time: '11:00', timeLabel: '11:00 AM', maxBookings: 8 },
            { dayOfWeek: 4, time: '11:30', timeLabel: '11:30 AM', maxBookings: 8 },
            { dayOfWeek: 4, time: '12:00', timeLabel: '12:00 PM', maxBookings: 10 },
            { dayOfWeek: 4, time: '12:30', timeLabel: '12:30 PM', maxBookings: 10 },
            { dayOfWeek: 4, time: '13:00', timeLabel: '1:00 PM', maxBookings: 10 },
            { dayOfWeek: 4, time: '13:30', timeLabel: '1:30 PM', maxBookings: 8 },
            { dayOfWeek: 4, time: '18:00', timeLabel: '6:00 PM', maxBookings: 12 },
            { dayOfWeek: 4, time: '18:30', timeLabel: '6:30 PM', maxBookings: 12 },
            { dayOfWeek: 4, time: '19:00', timeLabel: '7:00 PM', maxBookings: 15 },
            { dayOfWeek: 4, time: '19:30', timeLabel: '7:30 PM', maxBookings: 15 },
            { dayOfWeek: 4, time: '20:00', timeLabel: '8:00 PM', maxBookings: 12 },
            { dayOfWeek: 4, time: '20:30', timeLabel: '8:30 PM', maxBookings: 10 },
            { dayOfWeek: 4, time: '21:00', timeLabel: '9:00 PM', maxBookings: 8 },
            // Friday (5)
            { dayOfWeek: 5, time: '11:00', timeLabel: '11:00 AM', maxBookings: 8 },
            { dayOfWeek: 5, time: '11:30', timeLabel: '11:30 AM', maxBookings: 8 },
            { dayOfWeek: 5, time: '12:00', timeLabel: '12:00 PM', maxBookings: 10 },
            { dayOfWeek: 5, time: '12:30', timeLabel: '12:30 PM', maxBookings: 10 },
            { dayOfWeek: 5, time: '13:00', timeLabel: '1:00 PM', maxBookings: 10 },
            { dayOfWeek: 5, time: '13:30', timeLabel: '1:30 PM', maxBookings: 8 },
            { dayOfWeek: 5, time: '18:00', timeLabel: '6:00 PM', maxBookings: 12 },
            { dayOfWeek: 5, time: '18:30', timeLabel: '6:30 PM', maxBookings: 12 },
            { dayOfWeek: 5, time: '19:00', timeLabel: '7:00 PM', maxBookings: 15 },
            { dayOfWeek: 5, time: '19:30', timeLabel: '7:30 PM', maxBookings: 15 },
            { dayOfWeek: 5, time: '20:00', timeLabel: '8:00 PM', maxBookings: 12 },
            { dayOfWeek: 5, time: '20:30', timeLabel: '8:30 PM', maxBookings: 10 },
            { dayOfWeek: 5, time: '21:00', timeLabel: '9:00 PM', maxBookings: 8 },
            // Saturday (6)
            { dayOfWeek: 6, time: '11:00', timeLabel: '11:00 AM', maxBookings: 10 },
            { dayOfWeek: 6, time: '12:00', timeLabel: '12:00 PM', maxBookings: 12 },
            { dayOfWeek: 6, time: '13:00', timeLabel: '1:00 PM', maxBookings: 12 },
            { dayOfWeek: 6, time: '18:00', timeLabel: '6:00 PM', maxBookings: 15 },
            { dayOfWeek: 6, time: '19:00', timeLabel: '7:00 PM', maxBookings: 18 },
            { dayOfWeek: 6, time: '20:00', timeLabel: '8:00 PM', maxBookings: 15 },
            { dayOfWeek: 6, time: '21:00', timeLabel: '9:00 PM', maxBookings: 10 },
            // Sunday (0)
            { dayOfWeek: 0, time: '11:00', timeLabel: '11:00 AM', maxBookings: 8 },
            { dayOfWeek: 0, time: '12:00', timeLabel: '12:00 PM', maxBookings: 10 },
            { dayOfWeek: 0, time: '13:00', timeLabel: '1:00 PM', maxBookings: 10 },
            { dayOfWeek: 0, time: '18:00', timeLabel: '6:00 PM', maxBookings: 10 },
            { dayOfWeek: 0, time: '19:00', timeLabel: '7:00 PM', maxBookings: 12 },
        ];

        for (const slot of defaultSlots) {
            try {
                const slotId = 'TS-' + uuidv4().substring(0, 8).toUpperCase();
                const newSlot = new TimeSlot({
                    _id: slotId,
                    ...slot,
                    isActive: true,
                    currentBookings: 0
                });
                await newSlot.save();
            } catch (e) {
                // Skip duplicates
            }
        }
        console.log('Default time slots initialized');
    };

    // Call initialization
    initDefaultTimeSlots();

    // ============ AUTO-CONFIRM RESERVATION ENDPOINT ============

    // Create reservation with auto-confirm logic
    app.post('/api/reservations/auto-confirm', async (req, res) => {
        try {
            const { name, email, phone, date, time, guests, tableId, tableName, specialRequests } = req.body;

            if (!name || !email || !phone || !date || !time || !guests) {
                return res.status(400).json({ error: 'All fields are required' });
            }

            if (!mongoConnected) {
                return res.status(503).json({ error: 'Database temporarily unavailable' });
            }

            // Check if customer is blacklisted
            const blacklistEntry = await Blacklist.findOne({
                $or: [{ phone }, { email }],
                isActive: true
            });

            let status = 'pending';
            let requiresApproval = false;

            if (blacklistEntry) {
                if (blacklistEntry.requiresManualApproval) {
                    requiresApproval = true;
                }
            }

            // Parse date and check availability
            const requestedDate = new Date(date);
            const dayOfWeek = requestedDate.getDay();
            const dateStr = requestedDate.toISOString().split('T')[0];

            // Check time slot availability
            const timeSlot = await TimeSlot.findOne({ dayOfWeek, time, isActive: true });

            // Get existing reservations for this date and time
            const Reservation = mongoose.model('Reservation');
            const existingReservations = await Reservation.find({
                date: { $regex: dateStr },
                time: time,
                status: { $in: ['pending', 'confirmed'] }
            });

            const currentBookings = existingReservations.reduce((sum, r) => sum + (r.guests || r.partySize || 0), 0);
            const maxCapacity = timeSlot ? timeSlot.maxBookings * 2 : 20;

            // Check if we have capacity
            const hasAvailability = currentBookings + guests <= maxCapacity;

            // Auto-confirm if not blacklisted and has availability
            if (!requiresApproval && hasAvailability) {
                status = 'confirmed';
            }

            const reservationId = 'RES-' + uuidv4().substring(0, 8).toUpperCase();
            const reservation = new Reservation({
                _id: reservationId,
                name,
                email,
                phone,
                date: dateStr,
                time,
                guests,
                tableId: tableId || null,
                tableName: tableName || 'Best Available',
                status,
                specialRequests: specialRequests || '',
                createdAt: new Date(),
                updatedAt: new Date()
            });

            await reservation.save();

            // Update time slot current bookings if confirmed
            if (timeSlot && status === 'confirmed') {
                timeSlot.currentBookings += guests;
                await timeSlot.save();
            }

            // Get the sendEmailNotification from main app (will be set by main app)
            const sendReservationNotifications = app.sendReservationNotifications;
            if (sendReservationNotifications) {
                try {
                    await sendReservationNotifications(reservation);
                    console.log('Confirmation email sent for reservation:', reservation._id);
                } catch (emailErr) {
                    console.error('Failed to send confirmation email:', emailErr.message);
                }
            } else {
                console.log('sendReservationNotifications not available - email not sent');
            }

            // Emit socket event for real-time update
            if (app.emitToRoom) {
                app.emitToRoom('reservations', 'new-reservation', reservation);
            }

            res.status(201).json({
                message: status === 'confirmed' ? 'Reservation confirmed!' : 'Reservation pending approval',
                reservation: {
                    id: reservation._id,
                    name: reservation.name,
                    email: reservation.email,
                    phone: reservation.phone,
                    date: reservation.date,
                    time: reservation.time,
                    guests: reservation.guests,
                    tableName: reservation.tableName,
                    status: reservation.status,
                    specialRequests: reservation.specialRequests
                },
                confirmed: status === 'confirmed',
                requiresApproval
            });
        } catch (err) {
            console.error('Auto-confirm reservation error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ============ CUSTOMER ENDPOINTS - VIEW/CANCEL/MODIFY ============

    // Get reservation by ID
    app.get('/api/reservations/:id', async (req, res) => {
        try {
            const { id } = req.params;

            if (!mongoConnected) {
                return res.status(503).json({ error: 'Database unavailable' });
            }

            const Reservation = mongoose.model('Reservation');
            const reservation = await Reservation.findById(id);

            if (!reservation) {
                return res.status(404).json({ error: 'Reservation not found' });
            }

            res.json({ reservation });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Cancel reservation
    app.post('/api/reservations/:id/cancel', async (req, res) => {
        try {
            const { id } = req.params;
            const { email, phone } = req.body;

            if (!mongoConnected) {
                return res.status(503).json({ error: 'Database unavailable' });
            }

            const Reservation = mongoose.model('Reservation');
            const reservation = await Reservation.findById(id);

            if (!reservation) {
                return res.status(404).json({ error: 'Reservation not found' });
            }

            // Verify ownership
            if (reservation.email !== email && reservation.phone !== phone) {
                return res.status(403).json({ error: 'Invalid verification' });
            }

            if (reservation.status === 'cancelled') {
                return res.status(400).json({ error: 'Already cancelled' });
            }

            // Update time slot bookings
            const requestedDate = new Date(reservation.date);
            const dayOfWeek = requestedDate.getDay();
            const timeSlot = await TimeSlot.findOne({ dayOfWeek, time: reservation.time });

            if (timeSlot) {
                timeSlot.currentBookings = Math.max(0, timeSlot.currentBookings - (reservation.guests || reservation.partySize || 0));
                await timeSlot.save();
            }

            reservation.status = 'cancelled';
            reservation.updatedAt = new Date();
            await reservation.save();

            // Send cancellation confirmation email
            const sendReservationNotifications = app.sendReservationNotifications;
            if (sendReservationNotifications) {
                try {
                    const cancelData = { ...reservation.toObject(), status: 'cancelled' };
                    await sendReservationNotifications(cancelData);
                } catch (e) { }
            }

            res.json({ message: 'Reservation cancelled', reservation });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Modify reservation
    app.put('/api/reservations/:id/modify', async (req, res) => {
        try {
            const { id } = req.params;
            const { email, phone, date, time, guests, specialRequests } = req.body;

            if (!mongoConnected) {
                return res.status(503).json({ error: 'Database unavailable' });
            }

            const Reservation = mongoose.model('Reservation');
            const reservation = await Reservation.findById(id);

            if (!reservation) {
                return res.status(404).json({ error: 'Reservation not found' });
            }

            // Verify ownership
            if (reservation.email !== email && reservation.phone !== phone) {
                return res.status(403).json({ error: 'Invalid verification' });
            }

            if (reservation.status === 'cancelled' || reservation.status === 'completed') {
                return res.status(400).json({ error: 'Cannot modify this reservation' });
            }

            const oldGuests = reservation.guests || reservation.partySize || 0;
            const newGuests = guests || oldGuests;

            // Check new availability if date/time changed
            if (date || time) {
                const newDate = date || reservation.date;
                const newTime = time || reservation.time;
                const requestedDate = new Date(newDate);
                const dayOfWeek = requestedDate.getDay();
                const dateStr = requestedDate.toISOString().split('T')[0];

                const timeSlot = await TimeSlot.findOne({ dayOfWeek, time: newTime, isActive: true });
                const existingReservations = await Reservation.find({
                    _id: { $ne: id },
                    date: { $regex: dateStr },
                    time: newTime,
                    status: { $in: ['pending', 'confirmed'] }
                });

                const currentBookings = existingReservations.reduce((sum, r) => sum + (r.guests || r.partySize || 0), 0);
                const maxCapacity = timeSlot ? timeSlot.maxBookings * 2 : 20;

                if (currentBookings + newGuests > maxCapacity) {
                    return res.status(409).json({ error: 'New time slot not available' });
                }

                // Update old time slot
                const oldDate = new Date(reservation.date);
                const oldDayOfWeek = oldDate.getDay();
                const oldTimeSlot = await TimeSlot.findOne({ dayOfWeek: oldDayOfWeek, time: reservation.time });
                if (oldTimeSlot) {
                    oldTimeSlot.currentBookings = Math.max(0, oldTimeSlot.currentBookings - oldGuests);
                    await oldTimeSlot.save();
                }

                // Update new time slot
                if (timeSlot) {
                    timeSlot.currentBookings += newGuests;
                    await timeSlot.save();
                }
            }

            // Update reservation
            if (date) reservation.date = date;
            if (time) reservation.time = time;
            if (guests) reservation.guests = guests;
            if (specialRequests !== undefined) reservation.specialRequests = specialRequests;
            reservation.updatedAt = new Date();

            await reservation.save();

            res.json({ message: 'Reservation modified', reservation });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ============ AUTO NO-SHOW TRACKING ============

    // Mark past reservations as completed or no-show
    app.post('/api/admin/reservations/process-past', requireAdmin, async (req, res) => {
        try {
            if (!mongoConnected) {
                return res.status(503).json({ error: 'Database unavailable' });
            }

            const Reservation = mongoose.model('Reservation');
            const now = new Date();
            const today = now.toISOString().split('T')[0];

            // Find confirmed reservations that have passed
            const pastReservations = await Reservation.find({
                status: 'confirmed',
                date: { $lt: today }
            });

            let completed = 0;
            let noShows = 0;

            for (const res of pastReservations) {
                // Mark as completed
                res.status = 'completed';
                res.updatedAt = new Date();
                await res.save();
                completed++;
            }

            res.json({ message: `Processed ${completed} past reservations`, completed, noShows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ============ REPORTS ENDPOINTS ============

    // Get reservation reports and statistics
    app.get('/api/admin/reservations/reports', requireAdmin, async (req, res) => {
        try {
            if (!mongoConnected) {
                return res.json({
                    stats: {},
                    daily: [],
                    weekly: [],
                    topTables: [],
                    noShows: []
                });
            }

            const { startDate, endDate, period = '30' } = req.query;
            const days = parseInt(period) || 30;
            const start = startDate ? new Date(startDate) : new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            const end = endDate ? new Date(endDate) : new Date();

            const Reservation = mongoose.model('Reservation');

            // Get all reservations in date range
            const reservations = await Reservation.find({
                createdAt: { $gte: start, $lte: end }
            });

            // Calculate statistics
            const totalReservations = reservations.length;
            const confirmed = reservations.filter(r => r.status === 'confirmed').length;
            const pending = reservations.filter(r => r.status === 'pending').length;
            const cancelled = reservations.filter(r => r.status === 'cancelled').length;
            const completed = reservations.filter(r => r.status === 'completed').length;
            const noShows = reservations.filter(r => r.status === 'no-show').length;

            // Total guests
            const totalGuests = reservations.reduce((sum, r) => sum + (r.guests || r.partySize || 0), 0);
            const avgPartySize = totalReservations > 0 ? (totalGuests / totalReservations).toFixed(1) : 0;

            // Daily breakdown
            const dailyMap = {};
            reservations.forEach(r => {
                const dateKey = new Date(r.createdAt).toISOString().split('T')[0];
                if (!dailyMap[dateKey]) {
                    dailyMap[dateKey] = { date: dateKey, total: 0, confirmed: 0, cancelled: 0, noShow: 0, guests: 0 };
                }
                dailyMap[dateKey].total++;
                if (r.status === 'confirmed') dailyMap[dateKey].confirmed++;
                if (r.status === 'cancelled') dailyMap[dateKey].cancelled++;
                if (r.status === 'no-show') dailyMap[dateKey].noShow++;
                dailyMap[dateKey].guests += r.guests || r.partySize || 0;
            });
            const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);

            // Weekly breakdown
            const weeklyMap = {};
            reservations.forEach(r => {
                const date = new Date(r.createdAt);
                const weekStart = new Date(date);
                weekStart.setDate(date.getDate() - date.getDay());
                const weekKey = weekStart.toISOString().split('T')[0];
                if (!weeklyMap[weekKey]) {
                    weeklyMap[weekKey] = { week: weekKey, total: 0, confirmed: 0, cancelled: 0, noShow: 0, guests: 0 };
                }
                weeklyMap[weekKey].total++;
                if (r.status === 'confirmed') weeklyMap[weekKey].confirmed++;
                if (r.status === 'cancelled') weeklyMap[weekKey].cancelled++;
                if (r.status === 'no-show') weeklyMap[weekKey].noShow++;
                weeklyMap[weekKey].guests += r.guests || r.partySize || 0;
            });
            const weekly = Object.values(weeklyMap).sort((a, b) => a.week.localeCompare(b.week)).slice(-8);

            // Top tables
            const tableMap = {};
            reservations.forEach(r => {
                if (r.tableName) {
                    if (!tableMap[r.tableName]) {
                        tableMap[r.tableName] = { tableName: r.tableName, total: 0, guests: 0 };
                    }
                    tableMap[r.tableName].total++;
                    tableMap[r.tableName].guests += r.guests || r.partySize || 0;
                }
            });
            const topTables = Object.values(tableMap).sort((a, b) => b.total - a.total).slice(0, 10);

            // Peak hours
            const hourMap = {};
            reservations.forEach(r => {
                if (r.time) {
                    const hour = r.time.split(':')[0];
                    if (!hourMap[hour]) {
                        hourMap[hour] = { hour: `${hour}:00`, total: 0 };
                    }
                    hourMap[hour].total++;
                }
            });
            const peakHours = Object.values(hourMap).sort((a, b) => b.total - a.total);

            // Recent no-shows
            const recentNoShows = await Blacklist.find({})
                .sort({ flaggedAt: -1 })
                .limit(10);

            res.json({
                stats: {
                    totalReservations,
                    confirmed,
                    pending,
                    cancelled,
                    completed,
                    noShows,
                    noShowRate: totalReservations > 0 ? ((noShows / totalReservations) * 100).toFixed(1) : 0,
                    totalGuests,
                    avgPartySize: parseFloat(avgPartySize),
                    peakHours
                },
                daily,
                weekly,
                topTables,
                noShows: recentNoShows
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return { TimeSlot, Blacklist };
};
