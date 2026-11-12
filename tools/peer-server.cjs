// Local signaling server for testing online play without the public PeerJS cloud.
// Run `npm run peer-server`, then open the Game Center with ?peer=localhost:9000
const http = require('node:http');
const express = require('express');
const { ExpressPeerServer } = require('peer');

const port = Number(process.env.PORT || 9000);
const app = express();
const server = http.createServer(app);
app.use('/', ExpressPeerServer(server, { path: '/', allow_discovery: false }));
server.listen(port, '0.0.0.0', () => console.log(`PeerJS signaling server on :${port}`));
