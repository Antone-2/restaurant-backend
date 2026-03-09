const { sendEmailNotification, sendSMSNotification } = require('./email');

const sendOrderNotifications = async (order) => {
    const customerEmail = order.email;
    const customerPhone = order.phone;
    const orderNumber = order._id;
    const totalAmount = order.total;
    const items = order.items && Array.isArray(order.items)
        ? order.items.map(item => `${item.name || 'Item'} x${item.quantity || 1}`).join(', ')
        : 'No items listed';
    const formattedDate = new Date(order.createdAt).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const emailSubject = `Order Confirmed! - The Quill Restaurant #${orderNumber}`;
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
                        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                            <tr>
                                <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center;">
                                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">🍽️ The Quill</h1>
                                    <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Fine Dining Experience</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 40px 30px;">
                                    <div style="text-align: center; margin-bottom: 30px;">
                                        <div style="width: 80px; height: 80px; background-color: #27ae60; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                            <span style="color: white; font-size: 40px;">✓</span>
                                        </div>
                                        <h2 style="color: #1a1a2e; margin: 0 0 10px 0; font-size: 24px;">Order Confirmed!</h2>
                                        <p style="color: #666666; margin: 0;">Thank you for your order, <strong>${order.customerName}</strong>!</p>
                                    </div>
                                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; border-radius: 8px; margin: 20px 0;">
                                        <tr>
                                            <td style="padding: 20px;">
                                                <p style="margin: 0 0 10px 0; color: #1a1a2e; font-size: 14px;"><strong>Order Number:</strong> <span style="color: #e74c3c;">#${orderNumber}</span></p>
                                                <p style="margin: 0 0 10px 0; color: #1a1a2e; font-size: 14px;"><strong>Date:</strong> ${formattedDate}</p>
                                                <p style="margin: 0 0 10px 0; color: #1a1a2e; font-size: 14px;"><strong>Payment Method:</strong> ${order.paymentMethod === 'mpesa' ? 'M-Pesa' : order.paymentMethod === 'cash' ? 'Cash on Delivery/Pickup' : order.paymentMethod}</p>
                                                <p style="margin: 0; color: #1a1a2e; font-size: 14px;"><strong>Status:</strong> <span style="color: #27ae60;">${order.status}</span></p>
                                            </td>
                                        </tr>
                                    </table>
                                    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                                        <tr>
                                            <td style="border-bottom: 1px solid #eeeeee; padding-bottom: 10px; color: #1a1a2e; font-weight: 600;">Items Ordered</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 15px 0; color: #666666; font-size: 14px;">${items}</td>
                                        </tr>
                                    </table>
                                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a2e; border-radius: 8px; margin: 20px 0;">
                                        <tr>
                                            <td style="padding: 20px; text-align: center;">
                                                <p style="color: #ffffff; margin: 0; font-size: 14px;">Total Amount</p>
                                                <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 32px; font-weight: bold;">KES ${totalAmount.toLocaleString()}</p>
                                            </td>
                                        </tr>
                                    </table>
                                    <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 30px;">
                                        If you have any questions about your order, please contact us at pomraningrichard@gmail.com
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

    const smsMessage = `The Quill: Order #${orderNumber} confirmed! Total: KES ${totalAmount.toLocaleString()}. Thank you!`;

    if (customerEmail) await sendEmailNotification(customerEmail, emailSubject, emailHtml);
    if (customerPhone) await sendSMSNotification(customerPhone, smsMessage);

    const adminEmail = require('../config').config.adminEmail;
    if (adminEmail) {
        const adminSubject = ` New Order Received - #${orderNumber}`;
        const adminHtml = `
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"></head>
            <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                    <tr><td align="center>
                        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden;">
                            <tr>
                                <td style="background: #e74c3c; padding: 20px; text-align: center;">
                                    <h1 style="color: #ffffff; margin: 0;">🛒 New Order</h1>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 20px;">
                                    <h2 style="color: #e74c3c; margin: 0 0 15px 0;">New Order Received!</h2>
                                    <table width="100%" cellpadding="10" cellspacing="0" style="background-color: #fff3cd; border-radius: 8px;">
                                        <tr><td><strong>Order #:</strong> ${orderNumber}</td></tr>
                                        <tr><td><strong>Customer:</strong> ${order.customerName}</td></tr>
                                        <tr><td><strong>Phone:</strong> ${order.phone}</td></tr>
                                        <tr><td><strong>Email:</strong> ${order.email}</td></tr>
                                        <tr><td><strong>Items:</strong> ${items}</td></tr>
                                        <tr><td><strong>Total:</strong> KES ${totalAmount.toLocaleString()}</td></tr>
                                        <tr><td><strong>Payment:</strong> ${order.paymentMethod}</td></tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td></tr>
                </table>
            </body>
            </html>`;
        await sendEmailNotification(adminEmail, adminSubject, adminHtml);
    }
};

const sendReservationNotifications = async (reservation) => {
    const customerEmail = reservation.email;
    const customerPhone = reservation.phone;
    const reservationId = reservation._id;
    const date = reservation.date;
    const time = reservation.time;
    const guests = reservation.guests;

    const emailSubject = `Table Reserved! - The Quill Restaurant`;
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
                        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                            <tr>
                                <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center;">
                                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">🍽️ The Quill</h1>
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
                                    </div>
                                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; border-radius: 8px; margin: 20px 0;">
                                        <tr>
                                            <td style="padding: 20px;">
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>Date:</strong> ${date}</p>
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>Time:</strong> ${time}</p>
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>Guests:</strong> ${guests} ${guests === 1 ? 'person' : 'people'}</p>
                                                <p style="margin: 0; color: #1a1a2e; font-size: 15px;"><strong>Reservation ID:</strong> ${reservationId}</p>
                                            </td>
                                        </tr>
                                    </table>
                                    <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 30px;">We look forward to serving you!</p>
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

    // Send confirmation to customer
    if (customerEmail) await sendEmailNotification(customerEmail, emailSubject, emailHtml);
    if (customerPhone) await sendSMSNotification(customerPhone, `The Quill: Table reserved for ${guests} on ${date} at ${time}. ID: ${reservationId}`);

    // Send notification to admin
    try {
        const adminEmail = require('../config').config.adminEmail;
        if (adminEmail) {
            const adminSubject = `🗓️ New Reservation - ${reservation.name} - ${guests} guests`;
            const adminHtml = `
                <!DOCTYPE html>
                <html>
                <head><meta charset="utf-8"></head>
                <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                        <tr><td align="center">
                            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden;">
                                <tr>
                                    <td style="background: #9b59b6; padding: 20px; text-align: center;">
                                        <h1 style="color: #ffffff; margin: 0;">🗓️ New Reservation</h1>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 20px;">
                                        <h2 style="color: #9b59b6; margin: 0 0 15px 0;">New Reservation Received!</h2>
                                        <table width="100%" cellpadding="10" cellspacing="0" style="background-color: #f0f0f0; border-radius: 8px;">
                                            <tr><td><strong>Reservation ID:</strong> ${reservationId}</td></tr>
                                            <tr><td><strong>Customer Name:</strong> ${reservation.name}</td></tr>
                                            <tr><td><strong>Phone:</strong> ${reservation.phone}</td></tr>
                                            <tr><td><strong>Email:</strong> ${reservation.email}</td></tr>
                                            <tr><td><strong>Date:</strong> ${date}</td></tr>
                                            <tr><td><strong>Time:</strong> ${time}</td></tr>
                                            <tr><td><strong>Guests:</strong> ${guests}</td></tr>
                                            ${reservation.tableName ? `<tr><td><strong>Table:</strong> ${reservation.tableName}</td></tr>` : ''}
                                            ${reservation.specialRequests ? `<tr><td><strong>Special Requests:</strong> ${reservation.specialRequests}</td></tr>` : ''}
                                        </table>
                                        <p style="margin-top: 15px; color: #666;">Please prepare for this reservation.</p>
                                    </td>
                                </tr>
                            </table>
                        </td></tr>
                    </table>
                </body>
                </html>`;
            await sendEmailNotification(adminEmail, adminSubject, adminHtml);
        }
    } catch (adminErr) {
        console.debug('Failed to send admin notification:', adminErr.message);
    }
};

const sendParkingNotifications = async (reservation) => {
    const customerEmail = reservation.email;
    const customerPhone = reservation.phone;
    const reservationId = reservation._id;
    const date = reservation.date;
    const time = reservation.time;
    const slotNumber = reservation.slotNumber;
    // Handle both possible field names (from frontend or legacy)
    const vehicleType = reservation.vehicleType || reservation.vehicle || 'Not specified';
    const vehiclePlate = reservation.vehiclePlate || reservation.plate || 'Not specified';
    const duration = reservation.duration || reservation.hours || 1;

    console.log('[Parking Notification] Debug - Full reservation data:', JSON.stringify({
        vehicleType: reservation.vehicleType,
        vehicle: reservation.vehicle,
        duration: reservation.duration,
        hours: reservation.hours
    }));

    // Modern digital-style customer email
    const emailSubject = `🅿️ Parking Confirmed - ${slotNumber}`;
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0f0f23; color: #ffffff;">
    <div style="background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%); min-height: 100vh; padding: 40px 20px;">
        <!-- Logo Section -->
        <div style="text-align: center; margin-bottom: 40px;">
            <div style="display: inline-block; background: linear-gradient(135deg, #00d4ff 0%, #7b2ff7 100%); padding: 15px 30px; border-radius: 50px; font-size: 24px; font-weight: 700; letter-spacing: 2px;">
                🅿️ THE QUILL
            </div>
        </div>
        
        <!-- Main Card -->
        <div style="max-width: 500px; margin: 0 auto; background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(20px); border-radius: 24px; border: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden;">
            <!-- Status Bar -->
            <div style="background: linear-gradient(90deg, #00d4ff 0%, #7b2ff7 100%); padding: 20px; text-align: center;">
                <div style="width: 60px; height: 60px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 10px; display: flex; align-items: center; justify-content: center; font-size: 28px;">✓</div>
                <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff;">PARKING CONFIRMED</h1>
                <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 14px;">Your spot is reserved and ready!</p>
            </div>
            
            <!-- Content -->
            <div style="padding: 30px;">
                <p style="margin: 0 0 25px 0; font-size: 16px; color: #a0a0a0;">Hello <span style="color: #ffffff; font-weight: 600;">${reservation.name}</span>! 👋</p>
                
                <!-- Digital Ticket -->
                <div style="background: linear-gradient(135deg, rgba(0,212,255,0.1) 0%, rgba(123,47,247,0.1) 100%); border: 2px dashed rgba(0,212,255,0.5); border-radius: 16px; padding: 25px; margin-bottom: 25px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <p style="margin: 0; color: #00d4ff; font-size: 12px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase;">Your Parking Slot</p>
                        <div style="font-size: 48px; font-weight: 700; background: linear-gradient(135deg, #00d4ff 0%, #7b2ff7 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 10px 0;">
                            ${slotNumber}
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 15px; text-align: center;">
                            <p style="margin: 0 0 5px 0; color: #666666; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">📅 Date</p>
                            <p style="margin: 0; color: #ffffff; font-size: 14px; font-weight: 600;">${date}</p>
                        </div>
                        <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 15px; text-align: center;">
                            <p style="margin: 0 0 5px 0; color: #666666; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">⏰ Time</p>
                            <p style="margin: 0; color: #ffffff; font-size: 14px; font-weight: 600;">${time}</p>
                        </div>
                        <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 15px; text-align: center;">
                            <p style="margin: 0 0 5px 0; color: #666666; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">⏱️ Duration</p>
                            <p style="margin: 0; color: #ffffff; font-size: 14px; font-weight: 600;">${duration} hr${duration > 1 ? 's' : ''}</p>
                        </div>
                        <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 15px; text-align: center;">
                            <p style="margin: 0 0 5px 0; color: #666666; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">🚗 Vehicle</p>
                            <p style="margin: 0; color: #ffffff; font-size: 14px; font-weight: 600;">${vehicleType}</p>
                        </div>
                    </div>
                    
                    <div style="margin-top: 15px; background: rgba(255,255,255,0.05); border-radius: 12px; padding: 15px; text-align: center;">
                        <p style="margin: 0 0 5px 0; color: #666666; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">🔢 License Plate</p>
                        <p style="margin: 0; color: #00d4ff; font-size: 18px; font-weight: 700; letter-spacing: 3px;">${vehiclePlate}</p>
                    </div>
                </div>
                
                <!-- QR Code Placeholder -->
                <div style="text-align: center; margin-bottom: 25px;">
                    <div style="display: inline-block; background: #ffffff; padding: 15px; border-radius: 16px;">
                        <div style="width: 120px; height: 120px; background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 40px;">📱</div>
                    </div>
                    <p style="margin: 15px 0 0 0; color: #666666; font-size: 12px;">Show this at the entrance</p>
                </div>
                
                <!-- Action Button -->
                <div style="text-align: center;">
                    <a href="https://thequill.co.ke/parking" style="display: inline-block; background: linear-gradient(135deg, #00d4ff 0%, #7b2ff7 100%); color: #ffffff; text-decoration: none; padding: 14px 35px; border-radius: 50px; font-weight: 600; font-size: 14px;">
                        Manage Reservation
                    </a>
                </div>
            </div>
        </div>
        
        <!-- Footer -->
        <div style="text-align: center; margin-top: 30px; color: #666666; font-size: 12px;">
            <p style="margin: 0 0 10px 0;">📍 Nambale, Kisumu - Busia Road, Busia, Kenya</p>
            <p style="margin: 0;">© 2026 The Quill Restaurant. All rights reserved.</p>
        </div>
    </div>
</body>
</html>`;

    // Send confirmation to customer
    if (customerEmail) await sendEmailNotification(customerEmail, emailSubject, emailHtml);
    if (customerPhone) await sendSMSNotification(customerPhone, `🅿️ The Quill Parking: Slot ${slotNumber} confirmed for ${date} at ${time}. Plate: ${vehiclePlate}. See you soon!`);

    // Send notification to admin
    try {
        const adminEmail = require('../config').config.adminEmail;
        if (adminEmail) {
            const adminSubject = `🚗 NEW PARKING BOOKING - ${reservation.name} - ${slotNumber}`;
            const adminHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0f0f23; color: #ffffff;">
    <div style="background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%); min-height: 100vh; padding: 40px 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(20px); border-radius: 24px; border: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden;">
            <!-- Header -->
            <div style="background: linear-gradient(90deg, #ff6b35 0%, #f7931e 100%); padding: 25px; text-align: center;">
                <h1 style="margin: 0; font-size: 24px; font-weight: 700;">🚗 NEW PARKING BOOKING</h1>
            </div>
            
            <!-- Content -->
            <div style="padding: 30px;">
                <div style="background: linear-gradient(135deg, rgba(255,107,53,0.1) 0%, rgba(247,147,30,0.1) 100%); border-radius: 16px; padding: 20px; margin-bottom: 25px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                        <span style="color: #ff6b35; font-weight: 600;">SLOT NUMBER</span>
                        <span style="font-size: 32px; font-weight: 700; color: #ff6b35;">${slotNumber}</span>
                    </div>
                </div>
                
                <table width="100%" cellpadding="15" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 20px;">
                    <tr>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1);"><span style="color: #888888;">👤 Customer</span></td>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1); font-weight: 600;">${reservation.name}</td>
                    </tr>
                    <tr>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1);"><span style="color: #888888;">📧 Email</span></td>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1);">${customerEmail}</td>
                    </tr>
                    <tr>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1);"><span style="color: #888888;">📱 Phone</span></td>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1);">${customerPhone || 'N/A'}</td>
                    </tr>
                    <tr>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1);"><span style="color: #888888;">🚗 Vehicle</span></td>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1);">${vehicleType}</td>
                    </tr>
                    <tr>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1);"><span style="color: #888888;">🔢 Plate</span></td>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1); font-weight: 600; color: #00d4ff;">${vehiclePlate}</td>
                    </tr>
                    <tr>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1);"><span style="color: #888888;">📅 Date</span></td>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1); font-weight: 600;">${date}</td>
                    </tr>
                    <tr>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1);"><span style="color: #888888;">⏰ Time</span></td>
                        <td style="border-bottom: 1px solid rgba(255,255,255,0.1); font-weight: 600;">${time}</td>
                    </tr>
                    <tr>
                        <td><span style="color: #888888;">⏱️ Duration</span></td>
                        <td style="font-weight: 600;">${duration} hour${duration > 1 ? 's' : ''}</td>
                    </tr>
                </table>
                
                <div style="background: rgba(0,212,255,0.1); border-radius: 12px; padding: 15px; text-align: center;">
                    <p style="margin: 0; color: #00d4ff; font-size: 14px;">📋 Reservation ID: <strong>${reservationId}</strong></p>
                </div>
            </div>
        </div>
    </div>
</body>
</html>`;
            await sendEmailNotification(adminEmail, adminSubject, adminHtml);
        }
    } catch (adminErr) {
        console.debug('Failed to send admin parking notification:', adminErr.message);
    }
};

module.exports = {
    sendOrderNotifications,
    sendReservationNotifications,
    sendParkingNotifications
};
