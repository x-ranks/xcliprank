'use strict';
// Prints the three secrets web push needs. Run once on the server; paste the lines into the app's environment file.
const { createECDH, randomBytes } = require('node:crypto');
const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
console.log('PUSH_VAPID_PUBLIC_KEY=' + ecdh.getPublicKey().toString('base64url'));
console.log('PUSH_VAPID_PRIVATE_KEY=' + ecdh.getPrivateKey().toString('base64url'));
console.log('PUSH_VAPID_SUBJECT=https://twizou.net');
console.log('PUSH_SEND_SECRET=' + randomBytes(32).toString('base64url'));
