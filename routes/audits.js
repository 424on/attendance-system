const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");
const { AuditLog } = require("../src/models");

const router = express.Router();

// GET /audits?targetType=ATTENDANCE&targetId=1
router.get("/audits", requireLogin, requireRole("INSTRUCTOR", "ADMIN"), async (req, res) => {
    const { targetType, targetId } = req.query;

    const where = {};
    if (targetType) where.targetType = targetType;
    if (targetId) where.targetId = Number(targetId);

    const list = await AuditLog.findAll({ where, order: [["id", "DESC"]] });
    res.json({ list });
});

module.exports = router;