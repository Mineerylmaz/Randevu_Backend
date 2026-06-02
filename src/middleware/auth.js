// src/middleware/auth.js
const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ status: "fail", message: "Token gerekli" });
    }

    try {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            // . Bu hata sende daha önce çıktı: "secretOrPrivateKey must have a value"
            return res.status(500).json({ status: "fail", message: "JWT_SECRET tanımlı değil" });
        }

        const payload = jwt.verify(token, secret);
        req.user = payload; // { id, rol, isletme_id, iat, exp }
        return next();
    } catch (err) {
        return res.status(401).json({ status: "fail", message: "Geçersiz token" });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        const rol = (req.user?.rol || "").toString().trim().toUpperCase();
        if (!rol) return res.status(401).json({ status: "fail", message: "Yetkisiz" });

        const allowed = roles.map((r) => r.toString().trim().toUpperCase());
        if (!allowed.includes(rol)) {
            return res.status(403).json({ status: "fail", message: "Erişim yok" });
        }
        return next();
    };
}

function requireTenant(req, res, next) {
    // . SUPER_ADMIN tenant'a TABİ DEĞİL
    const rol = (req.user?.rol || "").toString().trim().toUpperCase();
    if (rol === "SUPER_ADMIN") return next();

    // diğer roller için işletme şart
    if (!req.user?.isletme_id) {
        return res.status(400).json({ status: "fail", message: "İşletme bilgisi yok" });
    }
    return next();
}

module.exports = { requireAuth, requireRole, requireTenant };
