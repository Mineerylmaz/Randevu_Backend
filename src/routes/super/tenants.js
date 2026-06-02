const express = require("express");
const pool = require("../../db/pool");
const { uuid } = require("../../utils/id");

const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const uploadDir = path.join(process.cwd(), "uploads", "logos");
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${req.params.isletmeId}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        const allowed = ["image/png", "image/jpeg"];
        if (!allowed.includes(file.mimetype)) {
            return cb(new Error("Sadece PNG veya JPG"));
        }
        cb(null, true);
    },
});

router.get("/isletmeler", async (req, res) => {
    const search = (req.query.search || "").toString().trim();
    const status = (req.query.status || "all").toString(); // all|active|inactive
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];

    if (search) {
        where.push("(ad LIKE ? OR slug LIKE ?)");
        params.push(`%${search}%`, `%${search}%`);
    }

    if (status === "active") {
        where.push("aktif=1");
    } else if (status === "inactive") {
        where.push("aktif=0");
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM isletmeler ${whereSql}`,
        params
    );

    const [rows] = await pool.query(
        `SELECT id, ad, slug, aktif, olusturma_tarihi
     FROM isletmeler
     ${whereSql}
     ORDER BY olusturma_tarihi DESC
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


/**
 * POST /super/isletmeler
 * body: { ad, slug }
 */
router.post("/isletmeler", async (req, res) => {
    const { ad, slug } = req.body || {};
    if (!ad || !slug) return res.status(400).json({ message: "ad ve slug gerekli" });

    const id = uuid();

    try {
        await pool.query(
            "INSERT INTO isletmeler (id, ad, slug, aktif) VALUES (?, ?, ?, 1)",
            [id, ad, slug]
        );

        // ayar kaydı (defaults)
        await pool.query(
            `INSERT INTO isletme_ayarlari 
        (id, isletme_id, logo_url, ana_renk, ikincil_renk, yazi_renk, yazi_tipi, giris_baslik, hosgeldin_yazi)
       VALUES (?, ?, NULL, '#2563EB', '#0EA5E9', '#111827', 'Inter', 'Giriş Yap', 'Hoş geldiniz')`,
            [uuid(), id]
        );

        res.status(201).json({ id, ad, slug, aktif: 1 });
    } catch (err) {
        if (err && err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ message: "Bu slug zaten kullanılıyor" });
        }
        console.error(err);
        res.status(500).json({ message: "Sunucu hatası" });
    }
});


/**
 * PUT /super/isletmeler/:id
 * body: { ad, slug, aktif }
 */
router.put("/isletmeler/:id", async (req, res) => {
    const { id } = req.params;
    const { ad, slug, aktif } = req.body || {};

    await pool.query(
        "UPDATE isletmeler SET ad=COALESCE(?, ad), slug=COALESCE(?, slug), aktif=COALESCE(?, aktif) WHERE id=?",
        [ad ?? null, slug ?? null, aktif ?? null, id]
    );

    res.json({ ok: true });
});

router.put("/isletme-ayarlari/:isletmeId", async (req, res) => {
    const { isletmeId } = req.params;

    const {
        logo_url,
        ana_renk,
        ikincil_renk,
        yazi_renk,
        yazi_tipi,
        giris_baslik,
        hosgeldin_yazi,
    } = req.body || {};

    await pool.query(
        `UPDATE isletme_ayarlari 
     SET logo_url=COALESCE(?, logo_url),
         ana_renk=COALESCE(?, ana_renk),
         ikincil_renk=COALESCE(?, ikincil_renk),
         yazi_renk=COALESCE(?, yazi_renk),
         yazi_tipi=COALESCE(?, yazi_tipi),
         giris_baslik=COALESCE(?, giris_baslik),
         hosgeldin_yazi=COALESCE(?, hosgeldin_yazi)
     WHERE isletme_id=?`,
        [
            logo_url ?? null,
            ana_renk ?? null,
            ikincil_renk ?? null,
            yazi_renk ?? null,
            yazi_tipi ?? null,
            giris_baslik ?? null,
            hosgeldin_yazi ?? null,
            isletmeId,
        ]
    );

    res.json({ ok: true });
});

router.get("/isletme-ayarlari/:isletmeId", async (req, res) => {
    const { isletmeId } = req.params;

    const [rows] = await pool.query(
        "SELECT * FROM isletme_ayarlari WHERE isletme_id=? LIMIT 1",
        [isletmeId]
    );

    if (!rows.length) return res.status(404).json({ message: "Ayar bulunamadı" });

    res.json({ ok: true, settings: rows[0] });
});

router.post(
    "/isletme-ayarlari/:isletmeId/logo",
    upload.single("logo"),
    async (req, res) => {
        const { isletmeId } = req.params;

        if (!req.file) {
            return res.status(400).json({ message: "Dosya bulunamadı" });
        }

        const logoUrl = `/uploads/logos/${req.file.filename}`;

        await pool.query(
            "UPDATE isletme_ayarlari SET logo_url=? WHERE isletme_id=?",
            [logoUrl, isletmeId]
        );

        res.json({
            ok: true,
            logo_url: logoUrl,
        });
    }
);
// GET /super/isletmeler-mini
router.get("/isletmeler-mini", async (req, res) => {
    const [rows] = await pool.query("SELECT id, ad, slug FROM isletmeler ORDER BY ad ASC");
    res.json({ status: "ok", items: rows });
});

module.exports = router;
