const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const pool = require("./db/pool"); // app.js src içindeyse doğru path budur
// === ROUTES (Dosya Yapına Uygun İçe Aktarmalar) ===

// Auth Rotaları
const authRoutes = require("./routes/auth");
const publicAuthRoutes = require("./routes/public_auth");
const appointmentsRoutes = require("./routes/appointments.routes");
const tenantsRoutes = require("./routes/tenants.routes");
const personelRandevularRoutes = require("./routes/personel/randevular");

// Public (Mobil Uygulama) Rotaları
// Not: routes/public içinde index.js olduğu için klasör olarak çağırıyoruz
const publicRoutes = require("./routes/public");
const publicInviteRoutes = require("./routes/public/invite");
// İşletme Admin Rotaları 
// Not: admin klasöründe index.js olmadığı için dosyaları tek tek çağırıyoruz
const adminDashboardRoutes = require("./routes/admin/dashboard");
const adminHizmetlerRoutes = require("./routes/admin/hizmetler");
const adminPersonellerRoutes = require("./routes/admin/personeller");
const adminAppointmentsRoutes = require("./routes/admin/appointments");
const adminUsersRoutes = require("./routes/admin/users");

// Super Admin Rotaları
const superTenantsRoutes = require("./routes/super/tenants");
const superDashboardRoutes = require("./routes/super/dashboard");
const superThemeRoutes = require("./routes/super/theme");
const superUsersRoutes = require("./routes/super/users");
//pets routelarım:
const petRoutes = require("./routes/tenants/pets.routes");

// Middleware
const { requireAuth, requireRole } = require("./middleware/auth");

const app = express();

// ===== GLOBAL MIDDLEWARE =====
app.use(cors());
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

// Root Test Endpoint
app.get("/", (req, res) => {
    res.json({ ok: true, message: "Randevu Backend çalışıyor ." });
});
app.use((req, res, next) => {
    console.log("REQ:", req.method, req.originalUrl);
    next();
});

// Uploads (Resimler için statik klasör)
app.use("/uploads", express.static("uploads"));

// ===== AUTH =====
app.use("/auth", authRoutes);

app.use(appointmentsRoutes);
// ===== PUBLIC (MOBİL UYGULAMA) =====
// Flutter'dan gelen "/public/home/mine-kuaför" isteği buraya düşer
app.use("/public", publicInviteRoutes); // önce
app.use("/public", publicAuthRoutes);
app.use("/public", publicRoutes);       // en sona

// ===== İŞLETME ADMIN (ISLETME_ADMIN Rolü Gerekir) =====
// requireAuth ve requireRole middleware'lerini rotaların başında kullanabilirsin
app.use("/admin/dashboard", adminDashboardRoutes);
app.use("/admin/hizmetler", adminHizmetlerRoutes);
app.use("/admin/personeller", adminPersonellerRoutes);
app.use("/admin/randevular", adminAppointmentsRoutes);
app.use("/admin/users", adminUsersRoutes);

app.use("/tenants", tenantsRoutes(pool));
app.use("/personel/randevular", personelRandevularRoutes);
// ===== SUPER ADMIN (SUPER_ADMIN Rolü Gerekir) =====
app.use("/super", requireAuth, requireRole("SUPER_ADMIN"), superDashboardRoutes);
app.use("/super", requireAuth, requireRole("SUPER_ADMIN"), superTenantsRoutes);
app.use("/super", requireAuth, requireRole("SUPER_ADMIN"), superThemeRoutes);
app.use("/super", requireAuth, requireRole("SUPER_ADMIN"), superUsersRoutes);
app.use(petRoutes);

module.exports = app;