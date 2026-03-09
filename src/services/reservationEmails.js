const { sendEmailNotification } = require('./email');
const { Reservation } = require('../models/index');

// Send reservation confirmation email
const sendReservationConfirmation = async (reservation) => {
    const customerEmail = reservation.email;
    const customerPhone = reservation.phone;
    const reservationId = reservation._id;
    const date = reservation.date;
    const time = reservation.time;
    const guests = reservation.guests;
    const tableName = reservation.tableName;
    const specialRequests = reservation.specialRequests;

    const emailSubject = `🎉 Table Reserved! - The Quill Restaurant`;
    const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                <tr>
                    <td align="center">
                        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                            <tr>
                                <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 30px; text-align: center;">
                                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">🍽️ The Quill</h1>
                                    <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Fine Dining Experience</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 40px 30px;">
                                    <div style="text-align: center; margin-bottom: 30px;">
                                        <div style="width: 80px; height: 80px; background-color: #27ae60; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                            <span style="color: white; font-size: 40px;">✓</span>
                                        </div>
                                        <h2 style="color: #1a1a2e; margin: 0 0 10px 0; font-size: 24px;">Table Reserved!</h2>
                                        <p style="color: #666666; margin: 0;">Thank you, <strong>${reservation.name}</strong>!</p>
                                        <p style="color: #999999; margin: 10px 0 0 0; font-size: 14px;">Your reservation has been confirmed.</p>
                                    </div>
                                    
                                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; border-radius: 8px; margin: 20px 0;">
                                        <tr>
                                            <td style="padding: 20px;">
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>📅 Date:</strong> ${date}</p>
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>🕐 Time:</strong> ${time}</p>
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>👥 Guests:</strong> ${guests} ${guests === 1 ? 'person' : 'people'}</p>
                                                ${tableName ? `<p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>🪑 Table:</strong> ${tableName}</p>` : ''}
                                                <p style="margin: 0; color: #1a1a2e; font-size: 15px;"><strong>🎫 Reservation ID:</strong> ${reservationId}</p>
                                            </td>
                                        </tr>
                                    </table>
                                    
                                    ${specialRequests ? `
                                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #fff3cd; border-radius: 8px; margin: 20px 0;">
                                        <tr>
                                            <td style="padding: 20px;">
                                                <p style="margin: 0; color: #856404; font-size: 14px;"><strong>📝 Special Requests:</strong> ${specialRequests}</p>
                                            </td>
                                        </tr>
                                    </table>
                                    ` : ''}
                                    
                                    <div style="margin-top: 30px; padding: 20px; background-color: #e8f5e9; border-radius: 8px;">
                                        <p style="margin: 0; color: #2e7d32; font-size: 14px; text-align: center;">
                                            <strong>📍 Location:</strong> Nambale, Kisumu - Busia Rd, Busia, Kenya<br>
                                            <strong>📞 Phone:</strong> 0113 857846
                                        </p>
                                    </div>
                                    
                                    <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 30px;">
                                        If you need to modify or cancel your reservation, please contact us at least 2 hours before your reservation time.
                                    </p>
                                </td>
                            </tr>
                            <tr>
                                <td style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                                    <p style="color: #999999; margin: 0; font-size: 12px;">© 2026 The Quill Restaurant. All rights reserved.</p>
                                    <p style="color: #999999; margin: 5px 0 0 0; font-size: 11px;">Nambale, Kisumu - Busia Rd, Busia, Kenya</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>`;

    const smsMessage = `The Quill: Your table for ${guests} on ${date} at ${time} is confirmed! ID: ${reservationId}. See you soon!`;

    if (customerEmail) {
        await sendEmailNotification(customerEmail, emailSubject, emailHtml);
    }

    return true;
};

// Send reservation reminder email (24 hours before)
const sendReservationReminder = async (reservation) => {
    const customerEmail = reservation.email;
    const reservationId = reservation._id;
    const date = reservation.date;
    const time = reservation.time;
    const guests = reservation.guests;
    const tableName = reservation.tableName;

    const emailSubject = `⏰ Reminder: Your Reservation at The Quill is Tomorrow!`;
    const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                <tr>
                    <td align="center">
                        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                            <tr>
                                <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 30px; text-align: center;">
                                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">🍽️ The Quill</h1>
                                    <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Fine Dining Experience</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 40px 30px;">
                                    <div style="text-align: center; margin-bottom: 30px;">
                                        <div style="width: 80px; height: 80px; background-color: #f39c12; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                            <span style="color: white; font-size: 40px;">⏰</span>
                                        </div>
                                        <h2 style="color: #1a1a2e; margin: 0 0 10px 0; font-size: 24px;">Reservation Reminder</h2>
                                        <p style="color: #666666; margin: 0;">Hi <strong>${reservation.name}</strong>! This is a friendly reminder about your upcoming reservation.</p>
                                    </div>
                                    
                                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; border-radius: 8px; margin: 20px 0;">
                                        <tr>
                                            <td style="padding: 20px;">
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>📅 Date:</strong> ${date}</p>
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>🕐 Time:</strong> ${time}</p>
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>👥 Guests:</strong> ${guests} ${guests === 1 ? 'person' : 'people'}</p>
                                                ${tableName ? `<p style="margin: 0; color: #1a1a2e; font-size: 15px;"><strong>🪑 Table:</strong> ${tableName}</p>` : ''}
                                            </td>
                                        </tr>
                                    </table>
                                    
                                    <div style="margin-top: 30px; padding: 20px; background-color: #e3f2fd; border-radius: 8px;">
                                        <p style="margin: 0; color: #1565c0; font-size: 14px; text-align: center;">
                                            <strong>📍 Location:</strong> Nambale, Kisumu - Busia Rd, Busia, Kenya<br>
                                            <strong>📞 Phone:</strong> 0113 857846
                                        </p>
                                    </div>
                                    
                                    <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 30px;">
                                        Need to modify or cancel? Please contact us as soon as possible.
                                    </p>
                                </td>
                            </tr>
                            <tr>
                                <td style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                                    <p style="color: #999999; margin: 0; font-size: 12px;">© 2026 The Quill Restaurant. All rights reserved.</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>`;

    if (customerEmail) {
        await sendEmailNotification(customerEmail, emailSubject, emailHtml);
    }

    return true;
};

// Process reminders - call this via a cron job or scheduled task
const sendReservationStatusUpdate = async (reservation, newStatus, oldStatus) => {
    const customerEmail = reservation.email;
    const customerPhone = reservation.phone;
    const reservationId = reservation._id;
    const date = reservation.date;
    const time = reservation.time;
    const guests = reservation.guests;
    const tableName = reservation.tableName;
    const customerName = reservation.name;

    let statusMessage = '';
    let emailSubject = '';
    let iconEmoji = '';

    switch (newStatus) {
        case 'confirmed':
            statusMessage = 'Your reservation has been CONFIRMED!';
            emailSubject = `✅ Reservation Confirmed - The Quill Restaurant`;
            iconEmoji = '✅';
            break;
        case 'cancelled':
            statusMessage = 'Your reservation has been CANCELLED.';
            emailSubject = `❌ Reservation Cancelled - The Quill Restaurant`;
            iconEmoji = '❌';
            break;
        case 'completed':
            statusMessage = 'Your reservation has been COMPLETED. Thank you for dining with us!';
            emailSubject = `🎉 Reservation Completed - The Quill Restaurant`;
            iconEmoji = '🎉';
            break;
        case 'no-show':
            statusMessage = 'Your reservation was marked as a no-show.';
            emailSubject = `⚠️ Reservation No-Show - The Quill Restaurant`;
            iconEmoji = '⚠️';
            break;
        default:
            statusMessage = `Your reservation status has been updated to: ${newStatus}`;
            emailSubject = `Reservation Update - The Quill Restaurant`;
            iconEmoji = '📋';
    }

    const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                <tr>
                    <td align="center">
                        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                            <tr>
                                <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 30px; text-align: center;">
                                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">🍽️ The Quill</h1>
                                    <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Fine Dining Experience</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 40px 30px;">
                                    <div style="text-align: center; margin-bottom: 30px;">
                                        <div style="width: 80px; height: 80px; background-color: ${newStatus === 'confirmed' ? '#27ae60' : newStatus === 'cancelled' ? '#e74c3c' : newStatus === 'completed' ? '#3498db' : '#f39c12'}; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                            <span style="color: white; font-size: 40px;">${iconEmoji}</span>
                                        </div>
                                        <h2 style="color: #1a1a2e; margin: 0 0 10px 0; font-size: 24px;">Reservation Update</h2>
                                        <p style="color: #666666; margin: 0;">Hi <strong>${customerName}</strong>!</p>
                                        <p style="color: #999999; margin: 10px 0 0 0; font-size: 14px;">${statusMessage}</p>
                                    </div>
                                    
                                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; border-radius: 8px; margin: 20px 0;">
                                        <tr>
                                            <td style="padding: 20px;">
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>📅 Date:</strong> ${date}</p>
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>🕐 Time:</strong> ${time}</p>
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>👥 Guests:</strong> ${guests} ${guests === 1 ? 'person' : 'people'}</p>
                                                ${tableName ? `<p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>🪑 Table:</strong> ${tableName}</p>` : ''}
                                                <p style="margin: 0; color: #1a1a2e; font-size: 15px;"><strong>🎫 Reservation ID:</strong> ${reservationId}</p>
                                            </td>
                                        </tr>
                                    </table>
                                    
                                    ${newStatus === 'cancelled' ? `
                                    <div style="margin-top: 30px; padding: 20px; background-color: #fee; border-radius: 8px; border: 1px solid #fcc;">
                                        <p style="margin: 0; color: #c0392b; font-size: 14px; text-align: center;">
                                            If you believe this was a mistake or would like to make a new reservation, please contact us.
                                        </p>
                                    </div>
                                    ` : ''}
                                    
                                    ${newStatus === 'confirmed' ? `
                                    <div style="margin-top: 30px; padding: 20px; background-color: #e8f5e9; border-radius: 8px;">
                                        <p style="margin: 0; color: #2e7d32; font-size: 14px; text-align: center;">
                                            <strong>📍 Location:</strong> Nambale, Kisumu - Busia Rd, Busia, Kenya<br>
                                            <strong>📞 Phone:</strong> 0113 857846
                                        </p>
                                    </div>
                                    ` : ''}
                                    
                                    <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 30px;">
                                        © 2026 The Quill Restaurant. All rights reserved.
                                    </p>
                                </td>
                            </tr>
                            <tr>
                                <td style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                                    <p style="color: #999999; margin: 0; font-size: 12px;">© 2026 The Quill Restaurant. All rights reserved.</p>
                                    <p style="color: #999999; margin: 5px 0 0 0; font-size: 11px;">Nambale, Kisumu - Busia Rd, Busia, Kenya</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>`;

    if (customerEmail) {
        await sendEmailNotification(customerEmail, emailSubject, emailHtml);
    }

    return true;
};

// Process reminders - call this via a cron job or scheduled task
const processReminders = async () => {
    try {
        // Find reservations for tomorrow that haven't been reminded
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        const upcomingReservations = await Reservation.find({
            date: tomorrowStr,
            status: { $in: ['confirmed', 'pending'] }
        });

        console.log(`Processing ${upcomingReservations.length} reservation reminders for ${tomorrowStr}`);

        for (const reservation of upcomingReservations) {
            try {
                await sendReservationReminder(reservation);
                console.log(`Reminder sent for reservation ${reservation._id}`);
            } catch (err) {
                console.error(`Failed to send reminder for ${reservation._id}:`, err.message);
            }
        }

        return { processed: upcomingReservations.length };
    } catch (err) {
        console.error('Error processing reminders:', err);
        throw err;
    }
};

module.exports = {
    sendReservationConfirmation,
    sendReservationReminder,
    sendReservationStatusUpdate,
    processReminders
};
