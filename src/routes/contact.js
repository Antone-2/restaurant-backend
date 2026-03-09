const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Contact, Subscriber } = require('../models/index');
const { sendEmailNotification } = require('../services/email');
const { config } = require('../config');
const { emitToRoom } = require('../utils/socket');

// Contact form submission
router.post('/contact', async (req, res) => {
    try {
        const { name, email, message } = req.body;
        const contactId = 'CNT-' + uuidv4().substring(0, 8).toUpperCase();
        const contact = new Contact({ _id: contactId, name, email, message });
        await contact.save();
        if (email) await sendEmailNotification(email, 'Message Received - The Quill', `
            <div style="text-align: center;">
                <h2 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 22px; font-weight: 700;">Thank You for Reaching Out! 📬</h2>
                <p style="color: #555555; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">
                    We've received your message and our team will get back to you within 24 hours.
                </p>
                <div style="background: #f8f9fa; border-radius: 12px; padding: 20px; text-align: left; margin: 20px 0;">
                    <p style="color: #666666; margin: 0 0 10px 0; font-size: 14px; font-weight: 600;">Your Message:</p>
                    <p style="color: #333333; margin: 0; font-size: 15px; font-style: italic;">${message}</p>
                </div>
                <p style="color: #999999; margin: 25px 0 0 0; font-size: 13px;">
                    In the meantime, explore our <a href="https://thequill.co.ke" style="color: #ff6b35; text-decoration: none;">menu</a> or <a href="https://thequill.co.ke" style="color: #ff6b35; text-decoration: none;">make a reservation</a>.
                </p>
            </div>
        `);
        const adminEmail = config.adminEmail;
        if (adminEmail) await sendEmailNotification(adminEmail, `New Contact from ${name}`, `
            <div style="text-align: left;">
                <h2 style="color: #1a1a2e; margin: 0 0 20px 0; font-size: 20px; font-weight: 700;">📬 New Contact Form Submission</h2>
                <div style="background: #f8f9fa; border-radius: 12px; padding: 20px; margin: 15px 0;">
                    <p style="margin: 10px 0;"><strong style="color: #1a1a2e;">Name:</strong> <span style="color: #555555;">${name}</span></p>
                    <p style="margin: 10px 0;"><strong style="color: #1a1a2e;">Email:</strong> <span style="color: #555555;">${email}</span></p>
                    <p style="margin: 10px 0;"><strong style="color: #1a1a2e;">Message:</strong></p>
                    <p style="margin: 10px 0; color: #555555; line-height: 1.6;">${message}</p>
                </div>
                <p style="color: #999999; margin: 20px 0 0 0; font-size: 12px;">Sent via The Quill Website Contact Form</p>
            </div>
        `);
        emitToRoom('admin', 'contact:new', { contactId, name, email, message, createdAt: contact.createdAt });
        res.status(201).json({ message: 'Message sent', contactId });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Subscribe to newsletter
router.post('/contact/subscribe', async (req, res) => {
    try {
        const { email, name, birthday, phone } = req.body;
        const existingSubscriber = await Subscriber.findOne({ email });
        if (existingSubscriber) return res.status(409).json({ error: 'Email already subscribed' });
        const subscriberId = 'SUB-' + uuidv4().substring(0, 8).toUpperCase();
        const subscriber = new Subscriber({ _id: subscriberId, email, name: name || '', birthday: birthday || null, phone: phone || '', segment: 'new', createdAt: new Date() });
        await subscriber.save();

        // Enhanced welcome email template
        const welcomeEmailContent = `
            <div style="text-align: center;">
                <h2 style="color: #1a1a2e; margin: 0 0 10px 0; font-size: 24px; font-weight: 700;">Welcome to The Quill Family! 🎉</h2>
                <p style="color: #555555; margin: 0 0 25px 0; font-size: 16px; line-height: 1.6;">
                    Thank you for subscribing${name ? ', ' + name : ''}! We're thrilled to have you join our culinary community. 
                    Get ready for exclusive deals, seasonal menu highlights, and special event invitations.
                </p>
            </div>
            
            <div style="background: linear-gradient(135deg, #fff5f0 0%, #ffecd2 100%); border-radius: 12px; padding: 30px; text-align: center; margin: 25px 0; border: 2px dashed #ff6b35;">
                <p style="color: #ff6b35; margin: 0 0 10px 0; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Your Exclusive Welcome Offer</p>
                <p style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 16px;">Get <strong>10% OFF</strong> your next dining experience!</p>
                <div style="background: #1a1a2e; color: #ffffff; padding: 15px 30px; border-radius: 8px; display: inline-block; font-size: 24px; font-weight: 700; letter-spacing: 3px;">
                    WELCOME10
                </div>
                <p style="color: #888888; margin: 15px 0 0 0; font-size: 12px;">Valid for 30 days • Dine-in & Takeaway</p>
            </div>
            
            <div style="margin: 30px 0;">
                <h3 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">What You'll Enjoy as a Subscriber:</h3>
                <ul style="color: #555555; margin: 0; padding: 0; list-style: none;">
                    <li style="padding: 8px 0 8px 30px; position: relative; margin: 10px 0;">
                        <span style="position: absolute; left: 0; color: #ff6b35; font-size: 18px;">🎁</span>
                        <strong>Exclusive Deals & Discounts</strong> — Special offers only for our subscribers
                    </li>
                    <li style="padding: 8px 0 8px 30px; position: relative; margin: 10px 0;">
                        <span style="position: absolute; left: 0; color: #ff6b35; font-size: 18px;">🎂</span>
                        <strong>Special Birthday Offers</strong> — Celebrate your special day with us
                    </li>
                    <li style="padding: 8px 0 8px 30px; position: relative; margin: 10px 0;">
                        <span style="position: absolute; left: 0; color: #ff6b35; font-size: 18px;">🍽️</span>
                        <strong>Seasonal Menu Announcements</strong> — Be the first to try our new dishes
                    </li>
                    <li style="padding: 8px 0 8px 30px; position: relative; margin: 10px 0;">
                        <span style="position: absolute; left: 0; color: #ff6b35; font-size: 18px;">📅</span>
                        <strong>Event Invitations</strong> — Wine tastings, chef's table & more
                    </li>
                </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0; padding-top: 20px; border-top: 1px solid #eeeeee;">
                <p style="color: #1a1a2e; margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">Visit Us</p>
                <p style="color: #666666; margin: 0; font-size: 14px;">
                    Nambale, Kisumu - Busia Road<br>
                    Busia, Kenya
                </p>
                <p style="color: #666666; margin: 10px 0 0 0; font-size: 14px;">
                    📞 +254 (0) 700 000 000 | 📧 info@thequill.co.ke
                </p>
            </div>
            
            <div style="text-align: center; margin: 25px 0;">
                <a href="https://thequill.co.ke" style="display: inline-block; background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%); color: #ffffff; text-decoration: none; padding: 14px 35px; border-radius: 25px; font-weight: 600; font-size: 14px;">
                    Reserve Your Table
                </a>
            </div>
            
            <p style="color: #999999; margin: 30px 0 0 0; font-size: 12px; text-align: center; line-height: 1.5;">
                Have questions? Reply to this email or call us. We're here to help!<br>
                © 2026 The Quill Restaurant. All rights reserved.
            </p>
        `;

        await sendEmailNotification(email, 'Welcome to The Quill! 🎉 Your 10% Off Awaits', welcomeEmailContent);
        res.status(201).json({ message: 'Subscribed successfully!', subscriberId, couponCode: 'WELCOME10' });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Accommodation booking request
router.post('/contact/accommodation-booking', async (req, res) => {
    try {
        const { name, email, phone, checkInDate, checkOutDate, roomType, guests, specialRequests, accommodationId } = req.body;

        // Validate required fields
        if (!name || !email || !phone || !checkInDate || !checkOutDate || !roomType) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const bookingId = 'ACC-' + uuidv4().substring(0, 8).toUpperCase();
        const confirmationNumber = 'CONF-' + Math.random().toString(36).substring(2, 8).toUpperCase();

        // Send confirmation email to customer
        const customerEmailContent = `
            <div style="text-align: center;">
                <h2 style="color: #1a1a2e; margin: 0 0 10px 0; font-size: 24px; font-weight: 700;">Booking Request Received! 🏨</h2>
                <p style="color: #555555; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">
                    Thank you for your interest in staying with us, ${name}! We have received your booking request and our accommodation team will contact you within 24 hours to confirm your reservation.
                </p>
            </div>
            
            <div style="background: #f8f9fa; border-radius: 12px; padding: 25px; margin: 20px 0;">
                <h3 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">Your Booking Details:</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px 0; color: #666666;"><strong>Confirmation Number:</strong></td>
                        <td style="padding: 8px 0; color: #1a1a2e; font-weight: 600;">${confirmationNumber}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #666666;"><strong>Room Type:</strong></td>
                        <td style="padding: 8px 0; color: #1a1a2e;">${roomType}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #666666;"><strong>Check-in Date:</strong></td>
                        <td style="padding: 8px 0; color: #1a1a2e;">${new Date(checkInDate).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #666666;"><strong>Check-out Date:</strong></td>
                        <td style="padding: 8px 0; color: #1a1a2e;">${new Date(checkOutDate).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #666666;"><strong>Number of Guests:</strong></td>
                        <td style="padding: 8px 0; color: #1a1a2e;">${guests || 1}</td>
                    </tr>
                </table>
            </div>
            
            <div style="background: linear-gradient(135deg, #fff5f0 0%, #ffecd2 100%); border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
                <p style="color: #ff6b35; margin: 0; font-size: 14px; font-weight: 600;">📞 Need urgent assistance?</p>
                <p style="color: #666666; margin: 10px 0 0 0; font-size: 14px;">Call us at: <strong>0113 857846</strong></p>
            </div>
            
            <p style="color: #999999; margin: 25px 0 0 0; font-size: 12px; text-align: center;">
                This is an automated confirmation. Our team will confirm your booking shortly.<br>
                © 2026 The Quill Restaurant & Accommodation. All rights reserved.
            </p>
        `;

        await sendEmailNotification(email, `Booking Request Received - ${confirmationNumber}`, customerEmailContent);

        // Send notification to admin
        const adminEmailContent = `
            <div style="text-align: left;">
                <h2 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 20px; font-weight: 700;">🏨 New Accommodation Booking Request</h2>
                <div style="background: #f8f9fa; border-radius: 12px; padding: 20px; margin: 15px 0;">
                    <h3 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 16px; font-weight: 600;">Guest Details:</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; color: #666666;"><strong>Name:</strong></td>
                            <td style="padding: 8px 0; color: #1a1a2e;">${name}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #666666;"><strong>Email:</strong></td>
                            <td style="padding: 8px 0; color: #1a1a2e;">${email}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #666666;"><strong>Phone:</strong></td>
                            <td style="padding: 8px 0; color: #1a1a2e;">${phone}</td>
                        </tr>
                    </table>
                </div>
                <div style="background: #fff5f0; border-radius: 12px; padding: 20px; margin: 15px 0;">
                    <h3 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 16px; font-weight: 600;">Booking Details:</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; color: #666666;"><strong>Booking ID:</strong></td>
                            <td style="padding: 8px 0; color: #1a1a2e;">${bookingId}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #666666;"><strong>Confirmation #:</strong></td>
                            <td style="padding: 8px 0; color: #1a1a2e;">${confirmationNumber}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #666666;"><strong>Room Type:</strong></td>
                            <td style="padding: 8px 0; color: #1a1a2e;">${roomType}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #666666;"><strong>Check-in:</strong></td>
                            <td style="padding: 8px 0; color: #1a1a2e;">${new Date(checkInDate).toLocaleDateString('en-GB')}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #666666;"><strong>Check-out:</strong></td>
                            <td style="padding: 8px 0; color: #1a1a2e;">${new Date(checkOutDate).toLocaleDateString('en-GB')}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #666666;"><strong>Guests:</strong></td>
                            <td style="padding: 8px 0; color: #1a1a2e;">${guests || 1}</td>
                        </tr>
                        ${specialRequests ? `<tr>
                            <td style="padding: 8px 0; color: #666666; vertical-align: top;"><strong>Special Requests:</strong></td>
                            <td style="padding: 8px 0; color: #1a1a2e;">${specialRequests}</td>
                        </tr>` : ''}
                    </table>
                </div>
                <p style="color: #999999; margin: 20px 0 0 0; font-size: 12px;">
                    Booking received via The Quill Website Accommodation Page
                </p>
            </div>
        `;

        const adminEmail = config.adminEmail;
        if (adminEmail) {
            await sendEmailNotification(adminEmail, `🏨 New Booking: ${name} - ${roomType}`, adminEmailContent);
        }

        // Emit to admin room for real-time notification
        emitToRoom('admin', 'accommodation:booking', {
            bookingId,
            confirmationNumber,
            name,
            email,
            phone,
            roomType,
            checkInDate,
            checkOutDate,
            guests,
            createdAt: new Date()
        });

        res.status(201).json({
            message: 'Booking request received successfully!',
            bookingId,
            confirmationNumber,
            details: {
                name,
                roomType,
                checkInDate,
                checkOutDate,
                guests
            }
        });
    } catch (err) {
        console.error('Accommodation booking error:', err);
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
