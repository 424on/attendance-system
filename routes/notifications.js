const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const { Notification } = require("../src/models");

const router = express.Router();

// GET /me/notifications?unreadOnly=true&limit=20&offset=0
router.get("/notifications", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;

        const unreadOnly = String(req.query.unreadOnly || "").toLowerCase() === "true";
        const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
        const offset = Math.max(0, Number(req.query.offset || 0));

        const where = { userId: user.id };
        if (unreadOnly) where.isRead = false;

        const { count, rows } = await Notification.findAndCountAll({
            where,
            order: [
                ["isRead", "ASC"],      // 안읽은게 위
                ["createdAt", "DESC"],  // 최신순
            ],
            limit,
            offset,
        });

        res.json({ count, limit, offset, list: rows });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

// PATCH /me/notifications/:id/read  (단건 읽음 처리)
router.patch("/notifications/:id/read", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;
        const id = Number(req.params.id);

        const noti = await Notification.findByPk(id);
        if (!noti) return res.status(404).json({ message: "알림 없음" });
        if (Number(noti.userId) !== Number(user.id)) return res.status(403).json({ message: "권한 없음" });

        if (!noti.isRead) {
            noti.isRead = true;
            noti.readAt = new Date();
            await noti.save();
        }

        res.json({ ok: true, notification: noti });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

// PATCH /me/notifications/read  (벌크 읽음 처리)
// body: { ids: [1,2,3] } 또는 { all: true }
router.patch("/notifications/read", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;
        const { ids, all } = req.body || {};

        const now = new Date();

        if (all === true) {
            const [updated] = await Notification.update(
                { isRead: true, readAt: now },
                { where: { userId: user.id, isRead: false } }
            );
            return res.json({ ok: true, updated });
        }

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: "ids 배열 또는 all=true가 필요합니다." });
        }

        const idNums = ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);

        const [updated] = await Notification.update(
            { isRead: true, readAt: now },
            { where: { id: idNums, userId: user.id, isRead: false } }
        );

        res.json({ ok: true, updated });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

module.exports = router;