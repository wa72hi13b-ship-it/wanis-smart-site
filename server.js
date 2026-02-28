const path = require("path");
const fs = require("fs");
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const Database = require("better-sqlite3");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

// Ensure folders exist (Windows zip extract sometimes drops empty dirs)
fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
fs.mkdirSync(path.join(__dirname, "public", "uploads"), { recursive: true });

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Enable layout.ejs
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || config.sessionSecret,
  resave: false,
  saveUninitialized: false
}));
app.use("/public", express.static(path.join(__dirname, "public")));

const db = new Database(path.join(__dirname, "data", "site.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title_ar TEXT, title_en TEXT, title_it TEXT,
  body_ar TEXT, body_en TEXT, body_it TEXT,
  file_path TEXT,
  created_at TEXT NOT NULL
);
`);

const t = {
  ar: {home:"الرئيسية",photos:"صور فوتوغرافية",art:"أعمال فنية",writings:"كتابات",audio:"أغاني/صوت",video:"فيديو",pdf:"PDF",admin:"لوحة الإدارة",add:"إضافة",edit:"تعديل",delete:"حذف",login:"تسجيل الدخول",logout:"خروج",title:"العنوان",content:"المحتوى",file:"ملف",save:"حفظ",choose:"اختر",latest:"الأحدث",noItems:"لا يوجد محتوى بعد. اذهب للوحة الإدارة وأضف أول عمل.",open:"فتح",back:"رجوع"},
  en: {home:"Home",photos:"Photography",art:"Artwork",writings:"Writings",audio:"Audio",video:"Video",pdf:"PDF",admin:"Admin",add:"Add",edit:"Edit",delete:"Delete",login:"Login",logout:"Logout",title:"Title",content:"Content",file:"File",save:"Save",choose:"Choose",latest:"Latest",noItems:"No content yet. Go to the admin panel and add your first work.",open:"Open",back:"Back"},
  it: {home:"Home",photos:"Fotografia",art:"Arte",writings:"Scritti",audio:"Audio",video:"Video",pdf:"PDF",admin:"Admin",add:"Aggiungi",edit:"Modifica",delete:"Elimina",login:"Accedi",logout:"Esci",title:"Titolo",content:"Contenuto",file:"File",save:"Salva",choose:"Scegli",latest:"Ultimi",noItems:"Nessun contenuto. Vai al pannello admin e aggiungi il primo lavoro.",open:"Apri",back:"Indietro"}
};

function pickLang(req){
  const q = (req.query.lang || "").toLowerCase();
  if (["ar","en","it"].includes(q)) return q;
  const c = (req.cookies.lang || "").toLowerCase();
  if (["ar","en","it"].includes(c)) return c;
  const al = (req.headers["accept-language"] || "").toLowerCase();
  if (al.startsWith("it") || al.includes("it")) return "it";
  if (al.startsWith("en") || al.includes("en")) return "en";
  if (al.startsWith("ar") || al.includes("ar")) return "ar";
  return "ar";
}

app.use((req,res,next)=>{
  const lang = pickLang(req);
  if (req.query.lang) res.cookie("lang", lang, { maxAge: 1000*60*60*24*365 });
  res.locals.lang = lang;
  res.locals.tr = t[lang];
  res.locals.siteName = (config.siteName && config.siteName[lang]) ? config.siteName[lang] : "Wanis";
  res.locals.dir = (lang === "ar") ? "rtl" : "ltr";
  res.locals.langs = ["ar","en","it"];
  res.locals.activePath = req.path;
  res.locals.query = req.query;
  next();
});

const storage = multer.diskStorage({
  destination: (req,file,cb)=> cb(null, path.join(__dirname,"public","uploads")),
  filename: (req,file,cb)=> {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  }
});
const upload = multer({ storage });

function requireAdmin(req,res,next){
  if (req.session && req.session.isAdmin) return next();
  return res.redirect(`/admin?lang=${res.locals.lang}`);
}

app.get("/", (req,res)=>{
  const type = req.query.type || "all";
  const items = (type==="all")
    ? db.prepare("SELECT * FROM items ORDER BY id DESC").all()
    : db.prepare("SELECT * FROM items WHERE type=? ORDER BY id DESC").all(type);
  res.render("index", { items, type });
});

app.get("/item/:id", (req,res)=>{
  const item = db.prepare("SELECT * FROM items WHERE id=?").get(req.params.id);
  if (!item) return res.status(404).send("Not found");
  res.render("item", { item });
});

app.get("/admin", (req,res)=>{
  if (req.session && req.session.isAdmin){
    const items = db.prepare("SELECT * FROM items ORDER BY id DESC").all();
    return res.render("admin", { items, error: null });
  }
  res.render("login", { error: null });
});

app.post("/admin/login", (req,res)=>{
  const { user, pass } = req.body;
  const ok = (user === (process.env.ADMIN_USER || config.adminUser)) &&
             (pass === (process.env.ADMIN_PASS || config.adminPass));
  if (!ok){
    return res.render("login", { error: "بيانات الدخول غير صحيحة / Wrong credentials / Credenziali errate" });
  }
  req.session.isAdmin = true;
  res.redirect(`/admin?lang=${res.locals.lang}`);
});

app.post("/admin/logout", (req,res)=>{
  req.session.destroy(()=> res.redirect(`/?lang=${res.locals.lang}`));
});

app.get("/admin/new", requireAdmin, (req,res)=> res.render("edit", { item: null, error: null }));
app.get("/admin/edit/:id", requireAdmin, (req,res)=>{
  const item = db.prepare("SELECT * FROM items WHERE id=?").get(req.params.id);
  if (!item) return res.status(404).send("Not found");
  res.render("edit", { item, error: null });
});

app.post("/admin/save", requireAdmin, upload.single("file"), (req,res)=>{
  const { id, type, title_ar, title_en, title_it, body_ar, body_en, body_it } = req.body;
  let file_path = req.body.existing_file_path || null;
  if (req.file) file_path = `/public/uploads/${req.file.filename}`;
  if (!type) return res.render("edit", { item: null, error: "اختر نوع المحتوى." });

  if (id){
    db.prepare(`UPDATE items SET type=?, title_ar=?, title_en=?, title_it=?, body_ar=?, body_en=?, body_it=?, file_path=COALESCE(?, file_path) WHERE id=?`)
      .run(type, title_ar||null, title_en||null, title_it||null, body_ar||null, body_en||null, body_it||null, file_path, id);
  } else {
    db.prepare(`INSERT INTO items (type,title_ar,title_en,title_it,body_ar,body_en,body_it,file_path,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(type, title_ar||null, title_en||null, title_it||null, body_ar||null, body_en||null, body_it||null, file_path, new Date().toISOString());
  }
  res.redirect(`/admin?lang=${res.locals.lang}`);
});

app.post("/admin/delete/:id", requireAdmin, (req,res)=>{
  const item = db.prepare("SELECT * FROM items WHERE id=?").get(req.params.id);
  if (item && item.file_path){
    const p = path.join(__dirname, item.file_path.replace("/public/","public/"));
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch(e){}
  }
  db.prepare("DELETE FROM items WHERE id=?").run(req.params.id);
  res.redirect(`/admin?lang=${res.locals.lang}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", ()=> console.log(`Wanis Smart Site running on http://localhost:${PORT}`));
