// Kitchen Display System API Endpoints
// This file contains the kitchen display system API endpoints

module.exports = (app, { requireAuth, Order, emitToRoom, mongoConnected }) => {

    // Get kitchen statistics
    app.get('/api/kitchen/stats', requireAuth, async (req, res) => {
        try {
            if (!mongoConnected) {
                return res.json({
                    activeOrders: 0,
                    completedToday: 0,
                    avgPrepTime: 0,
                    longestWait: 0,
                    ordersReadyForPickup: 0,
                    staffOnDuty: 3,
                    busyStatus: 'moderate'
                });
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Get active orders (pending, preparing, ready)
            const activeOrders = await Order.countDocuments({
                status: { $in: ['pending', 'confirmed', 'preparing', 'ready'] }
            });

            // Get completed orders today
            const completedToday = await Order.countDocuments({
                status: 'delivered',
                createdAt: { $gte: today }
            });

            // Calculate average prep time from completed orders
            const completedOrders = await Order.find({
                status: 'delivered',
                createdAt: { $gte: new Date(today.getTime() - 24 * 60 * 60 * 1000) }
            }).sort({ createdAt: -1 }).limit(20);

            let avgPrepTime = 0;
            if (completedOrders.length > 0) {
                const totalTime = completedOrders.reduce((sum, order) => {
                    const completed = order.statusHistory?.find(h => h.status === 'delivered');
                    if (completed && order.createdAt) {
                        return sum + (new Date(completed.timestamp) - new Date(order.createdAt)) / 60000;
                    }
                    return sum;
                }, 0);
                avgPrepTime = Math.round(totalTime / completedOrders.length) || 15;
            }

            // Get orders ready for pickup
            const ordersReadyForPickup = await Order.countDocuments({
                status: 'ready',
                deliveryType: 'pickup'
            });

            // Get longest wait time
            const oldestPending = await Order.findOne({
                status: { $in: ['pending', 'confirmed', 'preparing'] }
            }).sort({ createdAt: 1 });

            let longestWait = 0;
            if (oldestPending && oldestPending.createdAt) {
                longestWait = Math.round((Date.now() - new Date(oldestPending.createdAt)) / 60000);
            }

            // Determine busy status
            let busyStatus = 'calm';
            if (activeOrders >= 10) {
                busyStatus = 'busy';
            } else if (activeOrders >= 5) {
                busyStatus = 'moderate';
            }

            res.json({
                activeOrders,
                completedToday,
                avgPrepTime: avgPrepTime || 15,
                longestWait,
                ordersReadyForPickup,
                staffOnDuty: 3,
                busyStatus
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get kitchen orders
    app.get('/api/kitchen/orders', requireAuth, async (req, res) => {
        try {
            if (!mongoConnected) {
                return res.json({ orders: [] });
            }

            const { status } = req.query;
            let query = {
                status: { $in: ['pending', 'confirmed', 'preparing', 'ready'] }
            };

            if (status && status !== 'all') {
                query.status = status;
            }

            const orders = await Order.find(query)
                .sort({ createdAt: 1 })
                .limit(50);

            // Transform orders for kitchen display
            const kitchenOrders = orders.map(order => {
                const now = Date.now();
                const createdAt = new Date(order.createdAt);
                const estimatedTime = Math.max(15, order.items?.length * 5 || 15);
                const timeElapsed = Math.round((now - createdAt) / 60000);
                const timeRemaining = Math.max(0, estimatedTime - timeElapsed);

                return {
                    _id: order._id,
                    orderNumber: order._id,
                    table: order.tableNumber || null,
                    items: order.items?.map(item => ({
                        name: item.name,
                        quantity: item.quantity,
                        notes: item.specialInstructions || '',
                        status: item.status || 'not-started',
                        timeStarted: item.timeStarted || null
                    })) || [],
                    orderType: order.deliveryType || 'dine-in',
                    status: order.status === 'confirmed' ? 'pending' : order.status,
                    priority: order.priority || 'normal',
                    createdAt: order.createdAt,
                    estimatedTime,
                    timeRemaining,
                    deliveryTime: order.estimatedDeliveryTime,
                    specialRequests: order.notes || ''
                };
            });

            res.json({ orders: kitchenOrders });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Update item status
    app.put('/api/kitchen/orders/:orderId/items/:itemIndex', requireAuth, async (req, res) => {
        try {
            const { orderId, itemIndex } = req.params;
            const { status } = req.body;

            if (!status) {
                return res.status(400).json({ error: 'Status is required' });
            }

            const validStatuses = ['not-started', 'in-progress', 'ready', 'completed'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }

            const order = await Order.findById(orderId);
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const idx = parseInt(itemIndex);
            if (!order.items || idx < 0 || idx >= order.items.length) {
                return res.status(404).json({ error: 'Item not found' });
            }

            // Update item status
            order.items[idx].status = status;

            if (status === 'in-progress' && !order.items[idx].timeStarted) {
                order.items[idx].timeStarted = new Date();
            }

            // Check if all items are ready
            const allReady = order.items.every(item => item.status === 'ready' || item.status === 'completed');
            if (allReady && order.status !== 'ready') {
                order.status = 'ready';
            } else if (order.items.some(item => item.status === 'in-progress') && order.status === 'pending') {
                order.status = 'preparing';
            }

            order.updatedAt = new Date();
            await order.save();

            // Emit socket event
            emitToRoom('orders', 'order:itemUpdated', {
                orderId,
                itemIndex: idx,
                status
            });

            res.json({ message: 'Item status updated', order });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Complete order
    app.put('/api/kitchen/orders/:orderId/complete', requireAuth, async (req, res) => {
        try {
            const { orderId } = req.params;

            const order = await Order.findById(orderId);
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }

            // Mark all items as ready/completed
            if (order.items) {
                order.items.forEach(item => {
                    item.status = 'ready';
                });
            }

            order.status = 'ready';
            order.updatedAt = new Date();

            // Add to status history
            const statusHistory = order.statusHistory || [];
            statusHistory.push({
                status: 'ready',
                timestamp: new Date(),
                note: 'Order marked as ready by kitchen'
            });
            order.statusHistory = statusHistory;

            await order.save();

            // Emit socket event
            emitToRoom('orders', 'order:completed', {
                orderId,
                status: 'ready'
            });

            emitToRoom('admin', 'order:updated', {
                orderId,
                status: 'ready'
            });

            res.json({ message: 'Order completed', order });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    console.log('Kitchen API endpoints registered');
};
