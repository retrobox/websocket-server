const dotenv = require('dotenv')
dotenv.config()

let httpServerHost = process.env.HOST !== undefined ? process.env.HOST : '0.0.0.0'
let httpServerPort = process.env.PORT !== undefined ? process.env.PORT : 3008

const express = require('express')();
const server = require('http').Server(express);
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const jwtSecret = process.env.JWT_KEY;
const apiEndpoint = process.env.API_ENDPOINT || 'api.retrobox.tech';
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
const axios = require('axios');

let connectedClients = []

express.use(bodyParser.json());

server.listen(httpServerPort, httpServerHost, () => {
    console.log('> Listening on http://' + httpServerHost + ':' + httpServerPort)
});

let verifyJwtApi = (token) => {
    return new Promise(resolve => {
        jwt.verify(
            token,
            jwtSecret, 
            (err, decoded) => {
                return resolve(err === null && decoded.isApi === true)
            });
    })
}

let apiAuthMiddleware = (req, res, next) => {
    verifyJwtApi(req.headers.authorization.replace('Bearer ', '')).then(isValid => {
        if (!isValid) {
            return res.status(401).json({
                success: false,
                errors: ['api token unauthorized']
            })
        }
        next()
    })
}

function connectConsole(req, res) {
    let sockets = connectedClients.filter(c => c.consoleId === req.params.id)
    if (sockets.length === 0 || io.sockets.sockets[sockets[0].socketId] === undefined) {
        return res.json({
            success: false,
            errors: ["Can't connect to the console"]
        })
    }    
    return io.sockets.sockets[sockets[0].socketId]
}

io.on('connection', function (socket) {
    console.log('> new socket (' + socket.id + ')')

    switch (socket.request.headers['x-client-type']) { // choose what kind of relation ship you want to have with the websocket server
        case 'console':
            // verify console token
            // make a request to the API, to verify the console overlay token
            // reject the console if not authorized
            let consoleId = socket.request.headers['x-console-id']
            let consoleToken = socket.request.headers['x-console-token']

            console.log(`> Socket with a console overlay, id: ${consoleId}; token: ${consoleToken}`)

            axios.post(apiEndpoint + '/console/verify', {
                console_id: consoleId, console_token: consoleToken
            }).then(res => {
                console.log('> Success console id and token verification with the API')

                socket.join('console-' + consoleId)

                connectedClients.push({
                    consoleId: consoleId,
                    socketId: socket.id
                })
            }).catch(err => {
                console.log('> Kicked a console overlay because of an invalid token or id')
                socket.disconnect()
            })
            break;

        case 'api':
            // verify Authorization
            console.log('> Socket with the API')
            socket.join('api');
            break;

        case 'desktop':
            console.log('> Socket with a desktop client')
            // verify with JWT and extract a id
            // store the id in memory
            let token = socket.request.headers.authorization.replace('Bearer ', '')
            jwt.verify(
                token,
                jwtSecret, 
                (err, decoded) => {
                    if (err != null) {
                        console.log('> Kicked a desktop client because of a invalid jwt')
                        socket.disconnect()
                    } else {
                        console.log('> Success jwt validation with desktop client')
                        console.log('> Login desktop token:', decoded.login_desktop_token)

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
        console.log('> Disconnected a socket')
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

express.post('/notify-desktop-login', apiAuthMiddleware, (req, res) => {
    // search for the desktop token in connected client and pass it the usertoken
    let loginDesktopToken = req.body.login_desktop_token
    let userToken = req.body.user_token
    console.log('> Received notification from api')        
    let desktopClient = connectedClients.filter(
        c => c.desktopToken === loginDesktopToken
    )[0]
    if (desktopClient != undefined) {
        let desktopClientSocket = io.sockets.sockets[desktopClient.socketId]
    
        desktopClientSocket.emit('desktop_login_finished', {
            finished: true,
            loginDesktopToken,
            userToken
        })
        res.json({
            success: true
        })
    }
})

// if someone want to get the status of a console
// for these routes verify jwt for API type of client
express.get('/connections', apiAuthMiddleware, (req, res) => {
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

express.get('/console/:id', apiAuthMiddleware, (req, res) => {
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
