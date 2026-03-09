const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Event, SpecialEvent } = require('../models/index');
const { requireAdmin } = require('../middleware/auth');
const { sendEmailNotification } = require('../services/email');
const { config } = require('../config');
const { emitToRoom } = require('../utils/socket');

// Create event inquiry
router.post('/', async (req, res) => {
    try {
        const { name, email, eventType, date, guests } = req.body;
        const eventId = 'EVT-' + uuidv4().substring(0, 8).toUpperCase();
        const event = new Event({ _id: eventId, name, email, eventType, date, guests });
        await event.save();
        if (email) await sendEmailNotification(email, 'Event Inquiry Received - The Quill', `<p>We've received your ${eventType} inquiry for ${guests} guests.</p>`);
        const adminEmail = config.adminEmail;
        if (adminEmail) await sendEmailNotification(adminEmail, `New Event Inquiry - ${eventType}`, `<p>${name} wants to book ${eventType} for ${guests} guests on ${date}</p>`);
        emitToRoom('admin', 'event:new', { eventId, name, email, eventType, date, guests, createdAt: event.createdAt });
        res.status(201).json({ message: 'Inquiry submitted', eventId });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Get events
router.get('/', async (req, res) => {
    try {
        const events = await Event.find().sort({ createdAt: -1 });
        res.json(events);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create special event (admin)
router.post('/special', requireAdmin, async (req, res) => {
    try {
        const { title, description, date, time, type, price, capacity, image, isUpcoming, organizer, donationPercent, isActive } = req.body;
        if (!title || !description || !date || !time || !type || !price || !capacity) return res.status(400).json({ error: 'All required fields must be provided' });
        const eventId = 'SE-' + uuidv4().substring(0, 8).toUpperCase();
        const specialEvent = new SpecialEvent({ _id: eventId, title, description, date: new Date(date), time, type, price, capacity, image: image || '', isUpcoming: isUpcoming !== false, organizer: organizer || '', donationPercent: donationPercent || 0, isActive: isActive !== false });
        await specialEvent.save();
        const savedEvent = specialEvent.toObject();
        res.status(201).json({ ...savedEvent, id: savedEvent._id, date: savedEvent.date instanceof Date ? savedEvent.date.toISOString().split('T')[0] : savedEvent.date });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Get special events
router.get('/special', async (req, res) => {
    try {
        const { upcoming, type } = req.query;
        let query = {};
        if (upcoming === 'true') { query.isUpcoming = true; query.date = { $gte: new Date() }; }
        if (type) query.type = type;
        const events = await SpecialEvent.find(query).sort({ date: 1 });
        const formattedEvents = events.map(event => ({ ...event.toObject(), id: event._id, date: event.date instanceof Date ? event.date.toISOString().split('T')[0] : event.date }));
        res.json(formattedEvents);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update special event (admin)
router.put('/special/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body, updatedAt: new Date() };
        if (updateData.date) updateData.date = new Date(updateData.date);
        Object.keys(updateData).forEach(key => { if (updateData[key] === undefined) delete updateData[key]; });
        const event = await SpecialEvent.findByIdAndUpdate(id, updateData, { new: true });
        if (!event) return res.status(404).json({ error: 'Special event not found' });
        res.json({ message: 'Special event updated', specialEvent: event });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete special event (admin)
router.delete('/special/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Try to find and delete the event
        const event = await SpecialEvent.findByIdAndDelete(id);

        // If event doesn't exist, return success anyway (idempotent operation)
        // This prevents 404 errors when trying to delete already-deleted or non-existent events
        if (!event) {
            console.log(`Special event not found for deletion: ${id}`);
            return res.status(200).json({ message: 'Special event deleted (or did not exist)' });
        }

        res.json({ message: 'Special event deleted' });
    } catch (err) {
        console.error('Error deleting special event:', err);
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
