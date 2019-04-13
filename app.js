const dotenv = require('dotenv')
const uuid = require('uuid')
dotenv.config()

let httpServerHost = process.env.HOST !== undefined ? process.env.HOST : '0.0.0.0'
let httpServerPort = process.env.PORT !== undefined ? process.env.PORT : 3008

const express = require('express')();
const server = require('http').Server(express);
const io = require('socket.io')(server);

server.listen(httpServerPort, '0.0.0.0', () => {
    console.log('listening on http://' + httpServerHost + ':' + httpServerPort)
});

let connectedClients = []

io.on('connection', function (socket) {
    console.log('connected, new socket (' + socket.id + ')')

    switch (socket.request.headers['x-client-type']) {
        case 'console':
            console.log('socket with a console')
            console.log('console id: ' + socket.request.headers['x-console-id'])
            socket.join('console-' + socket.request.headers['x-console-id'])

            connectedClients.push({
                consoleId: socket.request.headers['x-console-id'],
                socketId: socket.id
            })
            break;

        case 'api':
            console.log('socket with the API')
            socket.join('api');
            break;
    }

    socket.on('disconnect', function () {
        console.log('disconnected')
        connectedClients = connectedClients.filter(client => {
            return client.socketId !== socket.id
        })
    });
});

// API routes

// if someone want to get the status of a console
express.get('/connections', (req, res) => {
    return res.json({
        success: true,
        data: connectedClients
    })
})


function connectConsole(req, res) {
    let sockets = connectedClients.filter(c => c.consoleId === req.params.id)
    if (sockets.length === 0) {
        return res.json({
            success: false,
            errors: ['console not found or not connected at the time']
        })
    }
    let socketId = sockets[0].socketId
    // ???
    if (io.sockets.sockets[socketId] === undefined) {
        return res.json({
            success: false,
            errors: ['console not availaible at the time']
        })
    }
    return io.sockets.sockets[socketId]
}

express.get('/console/:id', (req, res) => {
    // search for the console id in the list of connected client
    let socket = connectConsole(req, res)

    // emit a event to the socket with this console
    socket.emit('get-status', (data) => {
        // wait for a response
        return res.json({
            success: true,
            data: data
        })
    })
});

express.get('/console/:id/ping', (req, res) => {
    let socket = connectConsole(req, res)
    socket.emit('ping', (data) => {
        // wait for a response
        return res.json({
            success: true,
            data: data
        })
    })
});
