// src/middleware/role.js
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

module.exports = { requireRole };
