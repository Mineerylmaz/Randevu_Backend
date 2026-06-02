const express = require("express");
const pool = require("../../db/pool");
const { uuid } = require("../../utils/id");

const { requireAuth, requireTenant } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/role");

const router = express.Router();

router.use(requireAuth, requireRole("ISLETME_ADMIN"), requireTenant);


// GET /admin/hizmetler?search=&status=&page=&limit=
router.get("/", async (req, res) => {
    const search = (req.query.search || "").toString().trim();
    const status = (req.query.status || "").toString().trim(); // "" | "aktif" | "pasif"
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);
    const offset = (page - 1) * limit;

    const where = ["h.isletme_id=?"];
    const params = [req.user.isletme_id];

    if (search) {
        where.push("(h.ad LIKE ?)");
        params.push(`%${search}%`);
    }
    if (status === "aktif") where.push("h.aktif=1");
    if (status === "pasif") where.push("h.aktif=0");

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM hizmetler h ${whereSql}`,
        params
    );

    const [rows] = await pool.query(
        `SELECT h.id, h.ad, h.sure_dk, h.fiyat, h.aktif
     FROM hizmetler h
     ${whereSql}
     ORDER BY h.ad ASC
     LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    res.json({
        status: "ok",
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        items: rows,
    });
});

// POST /admin/hizmetler
router.post("/", async (req, res) => {
    const { ad, sure_dk, fiyat, aktif } = req.body || {};
    console.log("HIZMET POST req.user =", req.user);

    if (!ad || ad.toString().trim().length < 2) {
        return res.status(400).json({ status: "fail", message: "Hizmet adı zorunlu" });
    }

    const sure = parseInt(sure_dk ?? "30", 10);
    if (Number.isNaN(sure) || sure < 5 || sure > 600) {
        return res.status(400).json({ status: "fail", message: "sure_dk 5-600 arası olmalı" });
    }

    let fiyatVal = null;
    if (fiyat !== undefined && fiyat !== null && fiyat !== "") {
        const f = Number(fiyat);
        if (Number.isNaN(f) || f < 0) {
            return res.status(400).json({ status: "fail", message: "fiyat geçersiz" });
        }
        fiyatVal = f;
    }

    const id = uuid();

    try {
        await pool.query(
            `INSERT INTO hizmetler (id, isletme_id, ad, sure_dk, fiyat, aktif)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [id, req.user.isletme_id, ad.toString().trim(), sure, fiyatVal, aktif === 0 ? 0 : 1]
        );

        res.status(201).json({
            status: "ok",
            item: {
                id,
                ad: ad.toString().trim(),
                sure_dk: sure,
                fiyat: fiyatVal,
                aktif: aktif === 0 ? 0 : 1,
            },
        });
    } catch (e) {
        console.error("HIZMET EKLE MYSQL:", e.code, e.errno, e.sqlMessage);
        console.error("SQL:", e.sql);
        return res.status(500).json({
            status: "fail",
            code: e.code,
            message: e.sqlMessage || e.message
        });
    }

});

// PUT /admin/hizmetler/:id
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const { ad, sure_dk, fiyat, aktif } = req.body || {};

    if (ad !== undefined && ad !== null && ad.toString().trim().length < 2) {
        return res.status(400).json({ status: "fail", message: "Hizmet adı en az 2 karakter" });
    }

    const updates = [];
    const params = [];

    if (ad !== undefined) {
        updates.push("ad=?");
        params.push(ad.toString().trim());
    }

    if (sure_dk !== undefined) {
        const sure = parseInt(sure_dk, 10);
        if (Number.isNaN(sure) || sure < 5 || sure > 600) {
            return res.status(400).json({ status: "fail", message: "sure_dk 5-600 arası olmalı" });
        }
        updates.push("sure_dk=?");
        params.push(sure);
    }

    if (fiyat !== undefined) {
        let fiyatVal = null;
        if (fiyat !== null && fiyat !== "") {
            const f = Number(fiyat);
            if (Number.isNaN(f) || f < 0) {
                return res.status(400).json({ status: "fail", message: "fiyat geçersiz" });
            }
            fiyatVal = f;
        }
        updates.push("fiyat=?");
        params.push(fiyatVal);
    }

    if (aktif !== undefined) {
        updates.push("aktif=?");
        params.push(aktif === 0 ? 0 : 1);
    }

    if (!updates.length) {
        return res.status(400).json({ status: "fail", message: "Güncellenecek alan yok" });
    }

    try {
        const [r] = await pool.query(
            `UPDATE hizmetler SET ${updates.join(", ")}
       WHERE id=? AND isletme_id=?`,
            [...params, id, req.user.isletme_id]
        );

        if (r.affectedRows === 0) {
            return res.status(404).json({ status: "fail", message: "Hizmet bulunamadı" });
        }

        res.json({ status: "ok" });
    } catch (e) {
        res.status(500).json({ status: "fail", message: "Güncelleme başarısız" });
    }
});

// DELETE /admin/hizmetler/:id
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const [r] = await pool.query(
            "DELETE FROM hizmetler WHERE id=? AND isletme_id=?",
            [id, req.user.isletme_id]
        );

        if (r.affectedRows === 0) {
            return res.status(404).json({ status: "fail", message: "Hizmet bulunamadı" });
        }

        res.json({ status: "ok" });
    } catch (e) {
        res.status(500).json({ status: "fail", message: "Silme başarısız" });
    }
});

module.exports = router;
