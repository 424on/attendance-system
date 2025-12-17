var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");

require("dotenv").config();

// ✅ 세션
var session = require("express-session");
var SequelizeStore = require("connect-session-sequelize")(session.Store);

// ✅ sequelize는 여기서만 가져온다(중복 선언 금지!)
const { sequelize } = require("./src/models");

// routes
var indexRouter = require("./routes/index");
var usersRouter = require("./routes/users");

var authRouter = require("./routes/auth");
var adminRouter = require("./routes/admin");
var coursesRouter = require("./routes/courses");
var sessionsRouter = require("./routes/sessions");
var meRouter = require("./routes/me");
var filesRouter = require("./routes/files");
var excusesRouter = require("./routes/excuses");
var attendanceRouter = require("./routes/attendance");
var auditsRouter = require("./routes/audits");
var debugRouter = require("./routes/debug");
var policiesRouter = require("./routes/policies");
var appealsRouter = require("./routes/appeals");

const absenceWarningsRouter = require("./routes/absenceWarnings");
const announcementsRouter = require("./routes/announcements");
const messagesRouter = require("./routes/messages");
const freeTimePollsRouter = require("./routes/freeTimePolls");
const reportsRouter = require("./routes/reports");
const reportsRiskRouter = require("./routes/reportsRisk");
const reportsExtraRouter = require("./routes/reportsExtra");

var app = express();

// ✅ 배포(프록시) 환경 대비
app.set("trust proxy", 1);

// ✅ DB 연결 확인 로그(서버 시작 시 1번)
sequelize
    .authenticate()
    .then(() => console.log("✅ DB connected"))
    .catch((err) => console.error("❌ DB connection failed:", err));

// ✅ 개발환경에서만 sync 권장 (배포는 마이그레이션 권장)
// 필요하면 .env에 DB_SYNC=true 로 켜기
if (process.env.DB_SYNC === "true") {
    sequelize
        .sync()
        .then(() => console.log("✅ Sequelize synced (tables created/updated)"))
        .catch((err) => console.error("❌ Sequelize sync failed:", err));
}

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

// middleware
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ✅ 업로드 파일 접근 가능하게(시연용)
// 404/에러 핸들러보다 위에 있어야 함
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

// ✅ 세션 스토어(DB 저장)
var sessionStore = new SequelizeStore({ db: sequelize });

// 필요하면 .env에 SESSION_SYNC=true 로 켜기
if (process.env.SESSION_SYNC === "true") {
    sessionStore.sync();
}

app.use(
    session({
        name: process.env.SESSION_NAME || "attendance.sid",
        secret: process.env.SESSION_SECRET || "secret",
        resave: false,
        saveUninitialized: false,
        store: sessionStore,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.COOKIE_SECURE === "true", // https 배포면 true 권장
            maxAge: 1000 * 60 * 60 * 2, // 2시간
        },
    })
);

// =========================
// routes
// =========================
app.use("/", indexRouter);
app.use("/users", usersRouter);

app.use("/auth", authRouter);
app.use("/admin", adminRouter);
app.use("/courses", coursesRouter);

app.use("/", sessionsRouter); // /courses/:courseId/sessions..., /sessions/:id...
app.use("/me", meRouter);
app.use("/files", filesRouter);

app.use("/", excusesRouter); // /sessions/:id/excuses, /excuses/:id
app.use("/", attendanceRouter); // /attendance/:id..., /me/attendance...
app.use("/", auditsRouter); // /audits...
app.use("/", policiesRouter); // /courses/:id/policy ...
app.use("/", appealsRouter); // /attendance/:id/appeals, /appeals/:id ...

app.use("/", absenceWarningsRouter);
app.use("/", announcementsRouter);
app.use("/", messagesRouter);
app.use("/", freeTimePollsRouter);
app.use("/", reportsRouter);
app.use("/", reportsRiskRouter);
app.use("/", reportsExtraRouter);

app.use("/debug", debugRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    next(createError(404));
});

// ✅ error handler (API는 JSON, 뷰는 pug)
app.use(function (err, req, res, next) {
    const status = err.status || 500;

    const wantsJson =
        req.xhr ||
        (req.headers.accept && req.headers.accept.includes("application/json")) ||
        req.path.startsWith("/auth") ||
        req.path.startsWith("/admin") ||
        req.path.startsWith("/courses") ||
        req.path.startsWith("/sessions") ||
        req.path.startsWith("/me") ||
        req.path.startsWith("/files") ||
        req.path.startsWith("/excuses") ||
        req.path.startsWith("/attendance") ||
        req.path.startsWith("/appeals") ||
        req.path.startsWith("/audits") ||
        req.path.startsWith("/reports");

    if (wantsJson) {
        return res.status(status).json({
            message: err.message || "서버 에러",
            status,
        });
    }

    res.locals.message = err.message;
    res.locals.error = req.app.get("env") === "development" ? err : {};
    res.status(status);
    res.render("error");
});

module.exports = app;