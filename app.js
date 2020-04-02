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
let terminalSessions = []

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
                return resolve({
                    isValid: err === null && decoded.isApi === true,
                    decoded
                })
            });
    })
}

let apiAuthMiddleware = (req, res, next) => {
    verifyJwtApi(req.headers.authorization.replace('Bearer ', '')).then(data => {
        if (!data.isValid) {
            return res.status(401).json({
                success: false,
                errors: ['api token unauthorized']
            })
        }
        req.decoded = data.decoded
        next()
    })
}


function getConsoleSocket(consoleId, userId = null) {
    let sockets = connectedClients.filter(c => 
        c.type === 'console' && c.consoleId === consoleId && (userId === null ? true : c.userId === userId)
    )
    if (sockets.length === 0 || io.sockets.sockets[sockets[0].socketId] === undefined)
        return null
    return io.sockets.sockets[sockets[0].socketId]
}


function connectConsole(req, res) {
    let consoleSocket = getConsoleSocket(req.params.id)
    if (consoleSocket === null) {
        return res.status(400).json({
            success: false,
            errors: ["Can't connect to the console"]
        })
    }
    return consoleSocket
}

function connectWeb(req, res) {
    if (req.headers['x-web-session'] === undefined) {
        return res.json({
            success: false,
            errors: ["X-Web-Session header not provided"]
        })
    }
    let sockets = connectedClients.filter(c => c.type === 'web' && c.socketId === req.headers['x-web-session'])
    if (sockets.length === 0 || io.sockets.sockets[sockets[0].socketId] === undefined) {
        return res.status(400).json({
            success: false,
            errors: ["Can't connect to the web client"]
        })
    }
    return io.sockets.sockets[sockets[0].socketId]
}

function updateWebClientConsoleStatus(client, isOnline) {
    if (client.type === 'console') {
        // search for a web client that own this console
        let webClient = connectedClients.filter(c => c.type === 'web' && c.userId === client.userId)[0]
        if (webClient !== undefined) {
            let socket = io.sockets.sockets[webClient.socketId]
            if (socket !== undefined) {
                // emit the new console status to the web client
                console.log('> update web console status')
                socket.emit('console-status', {
                    consoleId: client.consoleId,
                    isOnline
                })
            }
        }
    }
}

io.on('connection', function (socket) {
    console.log('> new socket (' + socket.id + ')')

    let token = null
    if (socket.request.headers.authorization != undefined) {
        token = socket.request.headers.authorization.replace('Bearer ', '')
    }
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

                let newClient = {
                    type: 'console',
                    consoleId: consoleId,
                    userId: res.data.data.user_id,
                    socketId: socket.id,
                    socket
                }

                updateWebClientConsoleStatus(newClient, true)
                
                connectedClients.push(newClient)
            }).catch(err => {
                console.log('> Kicked a console overlay because of an invalid token or id')
                socket.disconnect()
            })
            break;

        case 'desktop':
            console.log('> Socket with a desktop client')
            // verify with JWT and extract a id
            // store the id in memory
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
                            type: 'desktop',
                            desktopToken: decoded.login_desktop_token,
                            socketId: socket.id
                        })
                    }
                });
            break;

        case 'web':
            console.log('> Socket with a web client')
            jwt.verify(
                token,
                jwtSecret, 
                (err, decoded) => {
                    if (err != null) {
                        console.log('> Kicked a web client because of a invalid jwt')
                        socket.disconnect()
                    } else {
                        console.log('> Success jwt validation with web client, userId: ' + decoded.user.id)

                        // remove similar web client
                        connectedClients = connectedClients.filter(c => {
                            return !(c.type === "web" && c.userId === decoded.user.id)
                        })
                        
                        connectedClients.push({
                            type: 'web',
                            userId: decoded.user.id,
                            socketId: socket.id
                        })

                        socket.emit('socket-id', socket.id)

                        // socket.on('open-terminal', consoleObject => {
                        //     // a web client want to open a terminal with a specific console id

                        //     // remove trash in terminal sessions
                        //     terminalSessions = terminalSessions.filter(session => {
                        //         return io.sockets.sockets[session.webSocketId] !== undefined && connectedClients.filter(c => session.consoleId === c.consoleId).length > 0
                        //     })

                        //     // so we look for the console id and that is owned by this user
                        //     let consolesTerminal = connectedClients
                        //         .filter(client => client.type === 'console' &&
                        //                     client.userId === decoded.user.id &&
                        //                     client.consoleId === consoleObject.id)
                        //     if (consolesTerminal.length === 0) {
                        //         console.log('A client tried to open a terminal with a unknown, offline or forbidden console')
                        //     }
                            
                        //     console.log(`> Open terminal from ${decoded.user.id} : ${socket.id} for console ${consoleObject.id}...`)
                        //     let consoleSocket = getConsoleSocket(consoleObject.id, decoded.user.id)

                        //     if (consoleSocket === null) {
                        //         console.log("> Can't open terminal session because the console socket is not found")
                        //     }
                        //     // notify the console, that a terminal session is opened
                        //     console.log(connectedClients, terminalSessions)

                        //     /**
                        //      * (data) => {
                        //         console.log('> The console acknowledged that a terminal session is opened', data)
                        //         // TODO: verify if a similar terminal session exists and replace the old session with the new
                        //         terminalSessions.push({
                        //             webSocketId: socket.id,
                        //             consoleId: consoleObject.id,
                        //             userId: decoded.user.id
                        //         })
                        //         socket.emit('terminal-ready')
                        //     }
                        //      */
                        //     consoleSocket.send('open-terminal-session', {data: {}})
                        //     // consoleSocket.emit('ping-check', () => {
                        //     //     console.log('=== pong ===')
                        //     // })

                        //     // forward terminal output to the web socket
                        //     // consoleSocket.on('terminal-output', (data) => {
                        //     //     socket.emit('terminal-output', data)
                        //     // })
                        // })

                        // socket.on('terminal-input', terminalInputObject => {
                        //     getConsoleSocket(terminalInputObject.consoleId, decoded.user.id)
                        //         .emit('terminal-input', terminalInputObject.data)
                        // })
                        // socket.on('terminal-resize', terminalResizeObject => {
                        //     console.log(terminalResizeObject)
                        //     getConsoleSocket(terminalResizeObject.consoleId, decoded.user.id)
                        //         .emit('terminal-resize', terminalResizeObject.data)
                        // })
                    }
                });
            break;

        default:
            console.log('> Kicked a socket connexion (no auth provided)')
            socket.disconnect()
    }

    socket.on('disconnect', function () {
        console.log('> Disconnected a socket')
        let client = connectedClients.filter(client => {
            return client.socketId === socket.id
        })[0]

        if (client !== undefined && client.socket !== undefined) {
            client.socket = { hidden: true, socket: { hiddenObject: client.socket } }
        }
        console.log("> Client disconnected:", client)

        if (client !== undefined) {
            updateWebClientConsoleStatus(client, false)

            if (client.type === 'web') {
                // verify if that web client hold terminal session
                let sessions = terminalSessions.filter(session => session.webSocketId === socket.id)
                if (sessions[0] !== undefined) {
                    // notify console that a client doesn't want him anymore. It's very sad...
                    let consoleSocket = getConsoleSocket(sessions[0].consoleId, sessions[0].userId)
                    terminalSessions = terminalSessions.filter(session => session.webSocketId !== socket.id)
                    console.log('> Closed a terminal session because of a web client')
                    if (consoleSocket !== null) {
                        consoleSocket.emit('close-terminal-session')
                    }
                }
            }
            if (client.type === 'console') {
                terminalSessions = terminalSessions.filter(session => session.consoleId !== client.consoleId)
            }
        }

        console.log('Terminal Sessions afer disconnect event: ', terminalSessions)

        // Remove client from the list of connected clients
        connectedClients = connectedClients.filter(client => {
            return client.socketId !== socket.id
        })
    });

    socket.on('error', err => {
        console.log('> ERR: on socket', err)
    })
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
        c => c.type === 'desktop' && c.desktopToken === loginDesktopToken
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

express.get('/console/:id/ping', apiAuthMiddleware, (req, res) => {
    let socket = connectConsole(req, res)
    socket.emit('ping-check', (data) => {
        // wait for a response
        return res.json({
            success: true,
            data: data
        })
    })
});

express.get('/console/:id/shutdown', apiAuthMiddleware, (req, res) => {
    let socket = connectConsole(req, res)
    socket.emit('shutdown', () => {
        return res.json({
            success: true
        })
    })
});

express.get('/console/:id/reboot', apiAuthMiddleware, (req, res) => {
    let socket = connectConsole(req, res)
    socket.emit('reboot', () => {
        return res.json({
            success: true
        })
    })
});

express.get('/console/:id/open-terminal-session', apiAuthMiddleware, (req, res) => {
    let consoleSocket = connectConsole(req, res)
    let userId = req.headers['x-user-id']
    let consoleId = req.params.id
    console.log('> Terminal: ask for opening')
    consoleSocket.emit('open-terminal-session', (data) => {
        let webSessionSocket = connectWeb(req, res)
        console.log('> Terminal: response received', data)
        res.json({
            success: true,
            data
        })
        // a web client want to open a terminal with a specific console id

        // remove trash in terminal sessions
        terminalSessions = terminalSessions.filter(session => {
            return io.sockets.sockets[session.webSocketId] !== undefined &&
            connectedClients.filter(c => session.consoleId === c.consoleId).length > 0
        })
        webSessionSocket.removeAllListeners('terminal-input')
        webSessionSocket.removeAllListeners('terminal-resize')
        consoleSocket.removeAllListeners('terminal-output')
        consoleSocket.removeAllListeners('terminal-exit')
        
        console.log('> Terminal: The console acknowledged that a terminal session is opened', data)
        // TODO: verify if a similar terminal session exists and replace the old session with the new

        // so we look for the console id and that is owned by this user
        let consolesTerminal = connectedClients
            .filter(client => client.type === 'console' &&
                        client.userId === userId &&
                        client.consoleId === consoleId)
        if (consolesTerminal.length === 0) {
            console.log('> Terminal: A client tried to open a terminal with a unknown, offline or forbidden console')
        }

        if (consoleSocket === null) {
            console.log("> Terminal: Can't open terminal session because the console socket is not found")
        }

        // forward terminal output to the web socket
        consoleSocket.on('terminal-output', data => {
            webSessionSocket.emit('terminal-output', data)
        })
        consoleSocket.on('terminal-exit', data => {
            webSessionSocket.emit('terminal-exit', data)
            // the console will already close the terminal session but we need to remove this session from the list
            terminalSessions = terminalSessions.filter(session => !(
                session.userId === userId &&
                session.consoleId === consoleId
            ))
            console.log('terminal session after terminal exit', terminalSessions)
        })

        webSessionSocket.on('terminal-input', terminalInputObject => {
            consoleSocket.emit('terminal-input', terminalInputObject.data)
        })
        webSessionSocket.on('terminal-resize', terminalResizeObject => {
            consoleSocket.emit('terminal-resize', terminalResizeObject.data)
        })

        terminalSessions.push({
            webSocketId: webSessionSocket.id,
            consoleId,
            userId
        })
        webSessionSocket.emit('terminal-ready')

        console.log(`> Terminal: Opened terminal from ${userId} : ${webSessionSocket.id} for console ${consoleId}...`)
    })
});
