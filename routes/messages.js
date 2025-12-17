const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const { PersonalMessage, Notification, Course, Enrollment, User } = require("../src/models");

const router = express.Router();

async function notifyUser(userId, payload) {
    if (!Notification) return;
    await Notification.create({
        userId,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        linkUrl: payload.linkUrl || null,
        isRead: false,
    });
}

// POST /messages  (개인메시지 전송)
// body: { receiverId, title, content }
// 정책:
// - ADMIN/INSTRUCTOR: 누구에게나 가능
// - STUDENT: "내가 수강 중인 과목의 담당교원"에게만 가능
router.post("/messages", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;
        const { receiverId, title = "", content } = req.body;

        if (!receiverId || !content) return res.status(400).json({ message: "receiverId/content 필수" });

        const rid = Number(receiverId);
        const receiver = await User.findByPk(rid);
        if (!receiver) return res.status(404).json({ message: "수신자 없음" });

        if (user.role === "STUDENT") {
            // 학생은 자신이 수강중인 과목의 담당교원에게만
            const enr = await Enrollment.findAll({ where: { studentId: user.id }, attributes: ["courseId"] });
            const courseIds = enr.map((e) => e.courseId);
            const myCourses = await Course.findAll({ where: { id: courseIds }, attributes: ["instructorId"] });

            const instructorSet = new Set(myCourses.map((c) => Number(c.instructorId)));
            if (!instructorSet.has(rid)) {
                return res.status(403).json({ message: "학생은 수강 과목 담당교원에게만 메시지 전송 가능" });
            }
        }

        const msg = await PersonalMessage.create({
            senderId: user.id,
            receiverId: rid,
            title,
            content,
            isRead: false,
            readAt: null,
        });

        // ✅ 수신자 알림
        try {
            await notifyUser(rid, {
                type: "MESSAGE_RECEIVED",
                title: "새 개인 메시지",
                message: `${user.id}로부터 메시지가 도착했습니다: ${title || "(제목없음)"}`,
                linkUrl: `/me/messages/inbox`,
            });
        } catch (err) {
            console.error("notification create failed (MESSAGE_RECEIVED):", err);
        }

        res.status(201).json({ message: msg });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

// GET /me/messages/inbox
router.get("/me/messages/inbox", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;
        const list = await PersonalMessage.findAll({
            where: { receiverId: user.id },
            order: [["createdAt", "DESC"]],
        });
        res.json({ count: list.length, list });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

// GET /me/messages/sent
router.get("/me/messages/sent", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;
        const list = await PersonalMessage.findAll({
            where: { senderId: user.id },
            order: [["createdAt", "DESC"]],
        });
        res.json({ count: list.length, list });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

// POST /messages/:id/read (수신자만)
router.post("/messages/:id/read", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;
        const msg = await PersonalMessage.findByPk(req.params.id);
        if (!msg) return res.status(404).json({ message: "메시지 없음" });

        if (Number(msg.receiverId) !== Number(user.id)) {
            return res.status(403).json({ message: "수신자만 읽음 처리 가능" });
        }

        if (!msg.isRead) {
            msg.isRead = true;
            msg.readAt = new Date();
            await msg.save();
        }

        res.json({ ok: true, message: msg });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

module.exports = router;