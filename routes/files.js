const express = require("express");
const path = require("path");
const multer = require("multer");
const requireLogin = require("../src/middlewares/requireLogin");

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const base = path.basename(file.originalname, ext);
        cb(null, `${base}-${Date.now()}${ext}`);
    },
});

function fileFilter(req, file, cb) {
    // pdf/jpg/png만 허용
    const ok = ["application/pdf", "image/jpeg", "image/png"].includes(file.mimetype);
    cb(ok ? null : new Error("허용되지 않은 파일 형식"), ok);
}

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

router.post("/", requireLogin, upload.single("file"), (req, res) => {
    // form-data 키는 file 로 보낼 것
    res.json({
        filePath: `/${req.file.path}`, // 예: /uploads/xxx.pdf
        originalName: req.file.originalname,
    });
});

module.exports = router;