const path = require('path');

// Absolute path to the SecretFlow proto, for @grpc/proto-loader consumers.
const secretflowProtoPath = path.join(__dirname, 'secretflow.proto');

module.exports = { secretflowProtoPath };
