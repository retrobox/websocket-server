# The websocket server

![Continuous integration](https://github.com/retrobox/websocket-server/workflows/Continuous%20integration/badge.svg)


It will be used as a master for controlling all of the consoles connected.

It will host an private API, this API can be called by the main web retrobox API the retrieve information about console or order operations on consoles.

## Getting started

- Install dependencies `npm install`
- Run the app `node app.js` or with nodemon: `npm run dev` you can also run with debug data (for example with nodemon: `env DEBUG=socket.io* npm run dev`)

## API routes

(exemples)

- GET /console/:id
- GET /console/:id/wifi
- GET /console/:id/storage
- POST /console/:id/game/install # install a game
- DELETE /console/:id/game/:id # uninstall a game

and mores...

## Docker image

- `retrobox/websocket-server`, get image [here](https://hub.docker.com/repository/docker/retrobox/websocket-server).