const dotenv = require('dotenv')
const uuid = require('uuid')
dotenv.config()

let httpServerHost = process.env.HOST !== undefined ? process.env.HOST : '0.0.0.0'
let httpServerPort = process.env.PORT !== undefined ? process.env.PORT : 3008

const express = require('express')();
const server = require('http').Server(express);
const io = require('socket.io')(server,  {
    handlePreflightRequest: function (req, res) {
      var headers = {
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-type',
        'Access-Control-Allow-Origin': req.headers.origin,
        'Access-Control-Allow-Credentials': true
      };
      res.writeHead(200, headers);
      res.end();
    }
  });
const bodyParser = require('body-parser');

const jwt = require('jsonwebtoken');

express.use(bodyParser.json());

server.listen(httpServerPort, httpServerHost, () => {
    console.log('listening on http://' + httpServerHost + ':' + httpServerPort)
});

const jwtSecret = process.env.JWT_KEY

let connectedClients = []

io.on('connection', function (socket) {
    console.log('connected, new socket (' + socket.id + ')')

    switch (socket.request.headers['x-client-type']) { // choose what kind of relation ship you want to have with the websocket server
        case 'console':
            // verify if the JWT token provided is good
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

        case 'desktop':
            console.log('socket with a desktop client')
            // verify with JWT and extract a id
            // store the id in memory
            let token = socket.request.headers.authorization.replace('Bearer ', '')
            jwt.verify(
                token,
                jwtSecret, 
                (err, decoded) => {
                    if (err != null) {
                        console.log('kicked a desktop client because of a invalid jwt')
                        socket.disconnect()
                    } else {
                        console.log('success jwt validation with desktop client')
                        console.log('login desktop token:', decoded.login_desktop_token)

                        socket.join('desktop-' + decoded.login_desktop_token);
                        connectedClients.push({
                            consoleId: null,
                            desktopToken: decoded.login_desktop_token,
                            socketId: socket.id
                        })
                    }
                });

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
express.get('/', (req, res) => {
    return res.json({
        success: true,
        service: {
            organization: 'retrobox',
            name: 'websocket-server'
        }
    })
})

express.post('/notify-desktop-login', (req, res) => {
    jwt.verify(
        req.headers.authorization.replace('Bearer ', ''),
        jwtSecret, 
        (err, decoded) => {
            if (err != null) {
                return res.status(401).json({success: false})
            } else {
                if (decoded.is_api !== true) {
                    return res.status(403).json({success: false})
                }
                // search for the desktop token in connected client and pass it the usertoken
                let loginDesktopToken = req.body.login_desktop_token
                let userToken = req.body.user_token
                console.log('received notification from api')
                console.log(loginDesktopToken)
                let desktopClient = connectedClients.filter(
                    c => c.desktopToken === loginDesktopToken
                )[0]
                if (desktopClient != undefined) {
                    let desktopClientSocket = io.sockets.sockets[desktopClient.socketId]
                
                    let result = desktopClientSocket.emit('desktop_login_finished', {
                        finished: true,
                        loginDesktopToken,
                        userToken
                    })
                    res.json({
                        success: true
                    })
                }
            }
        });
})

// if someone want to get the status of a console
express.get('/connections', (req, res) => {
    return res.json({
        success: true,
        data: connectedClients
    })
})

express.get('/ping', (req, res) => {
    return res.json({
        success: true,
        result: 'pong'
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
    socket.emit('ping-check', (data) => {
        // wait for a response
        return res.json({
            success: true,
            data: data
        })
    })
});

express.get('/console/:id/shutdown', (req, res) => {
    let socket = connectConsole(req, res)
    socket.emit('shutdown')
    return res.json({
        success: true
    })
});

express.get('/console/:id/reboot', (req, res) => {
    let socket = connectConsole(req, res)
    socket.emit('reboot')
    return res.json({
        success: true
    })
});
