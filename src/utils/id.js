const { randomUUID } = require("crypto");

function uuid() {

    return randomUUID();
}

module.exports = { uuid };
