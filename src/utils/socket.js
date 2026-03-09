// Socket utilities - should be initialized in index.js
let io = null;

const setSocketIO = (socketIO) => {
    io = socketIO;
};

const emitToRoom = (room, event, data) => {
    if (io) {
        io.to(room).emit(event, data);
    }
};

const emitToAll = (event, data) => {
    if (io) {
        io.emit(event, data);
    }
};

module.exports = {
    setSocketIO,
    emitToRoom,
    emitToAll
};
