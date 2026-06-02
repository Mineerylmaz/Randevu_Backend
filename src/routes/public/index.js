// src/routes/public/index.js
const express = require("express");
const router = express.Router();

// /public/home/...
router.use("/home", require("./home"));

// /public/invite/...
router.use("/invite", require("./invite"));

// /public/isletme-config/...
router.use("/isletme-config", require("./public_legacy"));

module.exports = router;