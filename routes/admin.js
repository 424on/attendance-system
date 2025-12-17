const express = require("express");
const bcrypt = require("bcryptjs");
const { User, Course, Enrollment, ClassSession, Attendance, AuditLog } = require("../src/models");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");

const router = express.Router();

// POST /admin/courses  (ADMIN)
router.post("/courses", requireLogin, requireRole("ADMIN"), async (req, res) => {
    try {
        const { title, section, semester, department, instructorId } = req.body;
        if (!title || !semester || !instructorId) {
            return res.status(400).json({ message: "title/semester/instructorId 필수" });
        }

        const course = await Course.create({ title, section, semester, department, instructorId });
        res.status(201).json({ course });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

// POST /admin/enroll  (ADMIN) { courseId, studentId }
router.post("/enroll", requireLogin, requireRole("ADMIN"), async (req, res) => {
    try {
        const { courseId, studentId } = req.body;
        if (!courseId || !studentId) {
            return res.status(400).json({ message: "courseId/studentId 필수" });
        }

        const enrollment = await Enrollment.create({ courseId, studentId });
        res.status(201).json({ enrollment });
    } catch (e) {
        // 중복 수강 처리
        if (e.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json({ message: "이미 수강 등록되어 있음" });
        }
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

// =========================
// Admin Users CRUD + Role
// =========================

const ALLOWED_ROLES = ["ADMIN", "INSTRUCTOR", "STUDENT"];

function mustBeValidRole(role) {
    if (!ALLOWED_ROLES.includes(role)) {
        return { ok: false, message: "role은 ADMIN | INSTRUCTOR | STUDENT 중 하나여야 합니다." };
    }
    return { ok: true };
}

function sanitizeUser(u) {
    const user = u?.toJSON ? u.toJSON() : u;
    if (!user) return user;
    delete user.passwordHash;
    delete user.password_hash;
    delete user.password;
    return user;
}

async function writeAuditSafe({ targetType, targetId, action, actorId, beforeValue, afterValue }) {
    if (!AuditLog) return;
    try {
        await AuditLog.create({ targetType, targetId, action, actorId, beforeValue, afterValue });
    } catch (e) {
        console.error("⚠️ audit log write failed:", e.message);
    }
}

/**
 * GET /admin/users
 * query: role, department, q, page, limit
 */
router.get("/users", requireLogin, requireRole("ADMIN"), async (req, res) => {
    try {
        const { role, department, q } = req.query;
        const page = Math.max(Number(req.query.page || 1), 1);
        const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
        const offset = (page - 1) * limit;

        const where = {};
        if (role) where.role = role;
        if (department) where.department = department;

        const { Op } = require("sequelize");
        if (q) {
            where[Op.or] = [
                { name: { [Op.like]: `%${q}%` } },
                { email: { [Op.like]: `%${q}%` } },
            ];
        }

        const { count, rows } = await User.findAndCountAll({
            where,
            limit,
            offset,
            order: [["id", "DESC"]],
            attributes: { exclude: ["passwordHash", "password_hash", "password"] },
        });

        res.json({ page, limit, total: count, list: rows });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

/**
 * GET /admin/users/:id
 */
router.get("/users/:id", requireLogin, requireRole("ADMIN"), async (req, res) => {
    try {
        const user = await User.findByPk(req.params.id, {
            attributes: { exclude: ["passwordHash", "password_hash", "password"] },
        });
        if (!user) return res.status(404).json({ message: "유저 없음" });
        res.json({ user });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

/**
 * POST /admin/users
 * body: { email, password, name, role, department }
 */
router.post("/users", requireLogin, requireRole("ADMIN"), async (req, res) => {
    try {
        const actor = req.session.user;
        const { email, password, name, role, department } = req.body;

        if (!email || !password || !name || !role) {
            return res.status(400).json({ message: "email, password, name, role은 필수입니다." });
        }

        const vr = mustBeValidRole(role);
        if (!vr.ok) return res.status(400).json({ message: vr.message });

        const exists = await User.findOne({ where: { email } });
        if (exists) return res.status(409).json({ message: "이미 존재하는 email 입니다." });

        const passwordHash = await bcrypt.hash(String(password), 10);

        const user = await User.create({
            email,
            name,
            role,
            department: department || null,
            passwordHash, // ✅ User 모델 속성명이 passwordHash여야 함(위 모델 참고)
        });

        await writeAuditSafe({
            targetType: "USER",
            targetId: user.id,
            action: "CREATE",
            actorId: actor.id,
            beforeValue: null,
            afterValue: sanitizeUser(user),
        });

        res.status(201).json({ user: sanitizeUser(user) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

/**
 * PATCH /admin/users/:id
 * body: { email?, password?, name?, role?, department? }
 */
router.patch("/users/:id", requireLogin, requireRole("ADMIN"), async (req, res) => {
    try {
        const actor = req.session.user;
        const user = await User.findByPk(req.params.id);
        if (!user) return res.status(404).json({ message: "유저 없음" });

        const before = sanitizeUser(user);

        const { email, password, name, role, department } = req.body;

        if (role) {
            const vr = mustBeValidRole(role);
            if (!vr.ok) return res.status(400).json({ message: vr.message });
            user.role = role;
        }

        if (email && email !== user.email) {
            const exists = await User.findOne({ where: { email } });
            if (exists) return res.status(409).json({ message: "이미 존재하는 email 입니다." });
            user.email = email;
        }

        if (name !== undefined) user.name = name;
        if (department !== undefined) user.department = department;

        if (password) {
            user.passwordHash = await bcrypt.hash(String(password), 10);
        }

        await user.save();

        await writeAuditSafe({
            targetType: "USER",
            targetId: user.id,
            action: "UPDATE",
            actorId: actor.id,
            beforeValue: before,
            afterValue: sanitizeUser(user),
        });

        res.json({ user: sanitizeUser(user) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

/**
 * PATCH /admin/users/:id/role
 * body: { role }
 */
router.patch("/users/:id/role", requireLogin, requireRole("ADMIN"), async (req, res) => {
    try {
        const actor = req.session.user;
        const { role } = req.body;

        if (!role) return res.status(400).json({ message: "role은 필수입니다." });

        const vr = mustBeValidRole(role);
        if (!vr.ok) return res.status(400).json({ message: vr.message });

        const user = await User.findByPk(req.params.id);
        if (!user) return res.status(404).json({ message: "유저 없음" });

        const before = sanitizeUser(user);

        user.role = role;
        await user.save();

        await writeAuditSafe({
            targetType: "USER",
            targetId: user.id,
            action: "ROLE_CHANGE",
            actorId: actor.id,
            beforeValue: before,
            afterValue: sanitizeUser(user),
        });

        res.json({ user: sanitizeUser(user) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

/**
 * DELETE /admin/users/:id
 */
router.delete("/users/:id", requireLogin, requireRole("ADMIN"), async (req, res) => {
    try {
        const actor = req.session.user;
        const user = await User.findByPk(req.params.id);
        if (!user) return res.status(404).json({ message: "유저 없음" });

        // 안전장치: 자기 자신 삭제 방지
        if (Number(user.id) === Number(actor.id)) {
            return res.status(400).json({ message: "자기 자신은 삭제할 수 없습니다." });
        }

        const before = sanitizeUser(user);
        await user.destroy();

        await writeAuditSafe({
            targetType: "USER",
            targetId: Number(req.params.id),
            action: "DELETE",
            actorId: actor.id,
            beforeValue: before,
            afterValue: null,
        });

        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

router.patch(
    "/courses/:id",
    requireLogin,
    requireRole("ADMIN"),
    async (req, res) => {
        try {
            const actor = req.session.user;
            const course = await Course.findByPk(req.params.id);
            if (!course) return res.status(404).json({ message: "과목 없음" });

            const before = course.toJSON();

            const { title, section, semester, department, instructorId } = req.body;

            if (title !== undefined) course.title = title;
            if (section !== undefined) course.section = section;
            if (semester !== undefined) course.semester = semester;
            if (department !== undefined) course.department = department;
            if (instructorId !== undefined) course.instructorId = instructorId;

            await course.save();

            // 감사로그(있으면)
            if (AuditLog) {
                try {
                    await AuditLog.create({
                        targetType: "COURSE",
                        targetId: course.id,
                        action: "UPDATE",
                        actorId: actor.id,
                        beforeValue: before,
                        afterValue: course.toJSON(),
                    });
                } catch (e) {
                    console.error("audit log fail:", e.message);
                }
            }

            res.json({ course });
        } catch (e) {
            console.error(e);
            res.status(500).json({ message: "서버 에러" });
        }
    }
);
router.delete(
    "/courses/:id",
    requireLogin,
    requireRole("ADMIN"),
    async (req, res) => {
        try {
            const actor = req.session.user;
            const courseId = Number(req.params.id);

            const course = await Course.findByPk(courseId);
            if (!course) return res.status(404).json({ message: "과목 없음" });

            // 연결 데이터 체크(수강/세션/출석)
            const enrollmentCount = await Enrollment.count({ where: { courseId } });
            const sessionCount = await ClassSession.count({ where: { courseId } });

            // courseId로 attendance를 직접 count 하려면 세션을 타야 해서 간단히 sessionCount로 대표
            if (enrollmentCount > 0 || sessionCount > 0) {
                return res.status(409).json({
                    message: "연결된 데이터(enrollments/sessions)가 있어 삭제할 수 없습니다. 먼저 연결 데이터를 정리하세요.",
                    enrollmentCount,
                    sessionCount,
                });
            }

            const before = course.toJSON();
            await course.destroy();

            // 감사로그(있으면)
            if (AuditLog) {
                try {
                    await AuditLog.create({
                        targetType: "COURSE",
                        targetId: courseId,
                        action: "DELETE",
                        actorId: actor.id,
                        beforeValue: before,
                        afterValue: null,
                    });
                } catch (e) {
                    console.error("audit log fail:", e.message);
                }
            }

            res.json({ ok: true });
        } catch (e) {
            console.error(e);
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

module.exports = router;