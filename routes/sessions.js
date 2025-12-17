const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");
const { sequelize, Course, ClassSession, Attendance, Enrollment, User, Notification } = require("../src/models");

const router = express.Router();

// =========================
// 공통 유틸
// =========================
function genCode() {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6자리
}

// ===== utils for generate =====
const DAY_MAP = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

function parseYmd(ymd) {
    const [y, m, d] = String(ymd).split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function parseHm(hm) {
    const [hh, mm] = String(hm).split(":").map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return { hh, mm };
}

function toYmd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function addMinutes(date, minutes) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() + minutes);
    return d;
}

function buildDateTime(baseDateObj, hm) {
    const d = new Date(baseDateObj);
    d.setHours(hm.hh, hm.mm, 0, 0);
    return d;
}

function random6Digit() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizeMeetingDays(meetingDays) {
    if (!Array.isArray(meetingDays) || meetingDays.length === 0) return null;
    const list = [];
    for (const x of meetingDays) {
        if (typeof x === "number") {
            if (x < 0 || x > 6) return null;
            list.push(x);
        } else {
            const key = String(x).toUpperCase();
            if (!(key in DAY_MAP)) return null;
            list.push(DAY_MAP[key]);
        }
    }
    // ✅ 중복 제거 + 정렬
    return Array.from(new Set(list)).sort((a, b) => a - b);
}

async function getMaxRound(courseId, week, transaction) {
    const rows = await ClassSession.findAll({
        where: { courseId, week },
        attributes: ["round"],
        transaction,
    });
    if (!rows.length) return 0;
    return Math.max(...rows.map((r) => Number(r.round || 0)));
}

// =========================
// 0) (추천) 세션 단건 조회
// GET /sessions/:id
// =========================
router.get("/sessions/:id", requireLogin, async (req, res) => {
    try {
        const session = await ClassSession.findByPk(req.params.id);
        if (!session) return res.status(404).json({ message: "세션 없음" });
        res.json({ session });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

// =========================
// 1) 세션 수동 생성
// POST /courses/:courseId/sessions (INSTRUCTOR/ADMIN)
// =========================
router.post(
    "/courses/:courseId/sessions",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const courseId = Number(req.params.courseId);

            const course = await Course.findByPk(courseId);
            if (!course) return res.status(404).json({ message: "과목 없음" });

            // 교원은 본인 과목만(ADMIN은 예외)
            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                return res.status(403).json({ message: "본인 과목만 세션 생성 가능" });
            }

            const {
                week,
                round = 1,
                startAt,
                endAt,
                room,
                attendanceMethod = "ELECTRONIC",
            } = req.body;

            if (!week) return res.status(400).json({ message: "week 필수" });

            const allowed = ["ELECTRONIC", "CODE", "ROLL_CALL"];
            if (!allowed.includes(attendanceMethod)) {
                return res.status(400).json({ message: "attendanceMethod는 ELECTRONIC|CODE|ROLL_CALL 중 하나" });
            }

            const code = attendanceMethod === "CODE" ? genCode() : null;

            const session = await ClassSession.create({
                courseId,
                week,
                round,
                startAt: startAt || null,
                endAt: endAt || null,
                room: room || null,
                attendanceMethod,
                status: "CLOSED",
                code,
            });

            res.status(201).json({ session });
        } catch (e) {
            console.error(e);
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

// =========================
// 1-1) 과목별 세션 목록 조회
// GET /courses/:courseId/sessions
// - 교원: 본인 과목만
// - 학생: 수강중인 과목만
// =========================
router.get("/courses/:courseId/sessions", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;
        const courseId = Number(req.params.courseId);

        const course = await Course.findByPk(courseId);
        if (!course) return res.status(404).json({ message: "과목 없음" });

        if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
            return res.status(403).json({ message: "본인 과목만 조회 가능" });
        }

        if (user.role === "STUDENT") {
            const enr = await Enrollment.findOne({ where: { courseId, studentId: user.id } });
            if (!enr) return res.status(403).json({ message: "수강생만 조회 가능" });
        }

        const where = { courseId };
        if (req.query.week) where.week = Number(req.query.week);
        if (req.query.status) where.status = String(req.query.status).toUpperCase();

        const list = await ClassSession.findAll({
            where,
            order: [["week", "ASC"], ["round", "ASC"]],
        });

        res.json({ courseId, count: list.length, list });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

// =========================
// 2) 세션 상태 변경
// OPEN / PAUSED / CLOSED
// =========================
router.post(
    "/sessions/:id/open",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const session = await ClassSession.findByPk(req.params.id);
            if (!session) return res.status(404).json({ message: "세션 없음" });

            const course = await Course.findByPk(session.courseId);
            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                return res.status(403).json({ message: "본인 과목 세션만 오픈 가능" });
            }

            if (session.status === "OPEN") {
                return res.status(400).json({ message: "이미 OPEN 상태입니다." });
            }

            session.status = "OPEN";
            await session.save();
            res.json({ session });
        } catch (e) {
            console.error(e);
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

router.post(
    "/sessions/:id/pause",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const session = await ClassSession.findByPk(req.params.id);
            if (!session) return res.status(404).json({ message: "세션 없음" });

            const course = await Course.findByPk(session.courseId);
            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                return res.status(403).json({ message: "본인 과목 세션만 일시정지 가능" });
            }

            if (session.status === "CLOSED") {
                return res.status(400).json({ message: "CLOSED 상태는 일시정지할 수 없습니다." });
            }

            if (session.status === "PAUSED") {
                return res.status(400).json({ message: "이미 PAUSED 상태입니다." });
            }

            session.status = "PAUSED";
            await session.save();
            res.json({ session });
        } catch (e) {
            console.error(e);
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

router.post(
    "/sessions/:id/close",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const session = await ClassSession.findByPk(req.params.id);
            if (!session) return res.status(404).json({ message: "세션 없음" });

            const course = await Course.findByPk(session.courseId);
            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                return res.status(403).json({ message: "본인 과목 세션만 마감 가능" });
            }

            if (session.status === "CLOSED") {
                return res.status(400).json({ message: "이미 CLOSED 상태입니다." });
            }

            session.status = "CLOSED";
            await session.save();
            res.json({ session });
        } catch (e) {
            console.error(e);
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

// =========================
// 3) 학생 출석 체크
// POST /sessions/:id/attend (STUDENT)
// - OPEN일 때만 가능
// - CODE면 code 검증
// - ROLL_CALL은 학생 불가(교원 수동)
// =========================
router.post(
    "/sessions/:id/attend",
    requireLogin,
    requireRole("STUDENT"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const session = await ClassSession.findByPk(req.params.id);
            if (!session) return res.status(404).json({ message: "세션 없음" });

            if (session.status !== "OPEN") return res.status(400).json({ message: "세션이 열려있지 않음" });

            // ✅ 호명 세션은 학생 출석 불가
            if (session.attendanceMethod === "ROLL_CALL") {
                return res.status(400).json({ message: "호명(ROLL_CALL) 세션은 학생 출석 체크가 불가합니다." });
            }

            // 수강생인지 확인
            const enr = await Enrollment.findOne({ where: { courseId: session.courseId, studentId: user.id } });
            if (!enr) return res.status(403).json({ message: "수강생만 출석 가능" });

            // CODE 방식이면 코드 확인
            if (session.attendanceMethod === "CODE") {
                const { code } = req.body;
                if (!code || code !== session.code) {
                    return res.status(400).json({ message: "출석 코드가 올바르지 않음" });
                }
            }

            // 출석 생성(또는 이미 있으면 반환)
            const [attendance, created] = await Attendance.findOrCreate({
                where: { sessionId: session.id, studentId: user.id },
                defaults: { status: 1, checkedAt: new Date() }, // 1=출석
            });

            if (!created) {
                if (!attendance.checkedAt) attendance.checkedAt = new Date();
                if (attendance.status === 0) attendance.status = 1;
                await attendance.save();
            }

            res.json({ attendance });
        } catch (e) {
            console.error(e);
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

// =========================
// 4) 출석 현황 요약
// GET /sessions/:id/attendance/summary (INSTRUCTOR/ADMIN)
// =========================
router.get(
    "/sessions/:id/attendance/summary",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const session = await ClassSession.findByPk(req.params.id);
            if (!session) return res.status(404).json({ message: "세션 없음" });

            const course = await Course.findByPk(session.courseId);
            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                return res.status(403).json({ message: "본인 과목 세션만 조회 가능" });
            }

            const list = await Attendance.findAll({ where: { sessionId: session.id } });

            const summary = { present: 0, late: 0, absent: 0, excused: 0, unknown: 0 };
            for (const a of list) {
                if (a.status === 1) summary.present++;
                else if (a.status === 2) summary.late++;
                else if (a.status === 3) summary.absent++;
                else if (a.status === 4) summary.excused++;
                else summary.unknown++;
            }

            res.json({ session, count: list.length, summary, list });
        } catch (e) {
            console.error(e);
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

// =========================
// 5) 호명(ROLL_CALL) 운영
// =========================

// 5-1) 교원: 수강생 + 출석현황 조회
// GET /sessions/:id/rollcall (INSTRUCTOR/ADMIN)
router.get(
    "/sessions/:id/rollcall",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const session = await ClassSession.findByPk(req.params.id);
            if (!session) return res.status(404).json({ message: "세션 없음" });

            const course = await Course.findByPk(session.courseId);
            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                return res.status(403).json({ message: "본인 과목 세션만 조회 가능" });
            }

            if (session.attendanceMethod !== "ROLL_CALL") {
                return res.status(400).json({ message: "ROLL_CALL 세션이 아닙니다." });
            }

            // 수강생 목록
            const enrollments = await Enrollment.findAll({
                where: { courseId: session.courseId },
                attributes: ["studentId"],
            });
            const studentIds = enrollments.map((e) => Number(e.studentId));

            // 학생 이름까지 같이 보여주고 싶으면(User 조인)
            const users = await User.findAll({
                where: { id: studentIds },
                attributes: ["id", "name", "email", "department"],
            });
            const userMap = new Map(users.map((u) => [Number(u.id), u.toJSON()]));

            // 이미 생성된 Attendance들
            const attends = await Attendance.findAll({
                where: { sessionId: session.id },
            });
            const attMap = new Map(attends.map((a) => [Number(a.studentId), a]));

            const list = studentIds
                .map((sid) => {
                    const a = attMap.get(sid);
                    const u = userMap.get(sid);
                    return {
                        studentId: sid,
                        name: u?.name || null,
                        email: u?.email || null,
                        department: u?.department || null,
                        status: a ? a.status : 0,
                        checkedAt: a ? a.checkedAt : null,
                    };
                })
                .sort((a, b) => a.studentId - b.studentId);

            res.json({ sessionId: session.id, courseId: session.courseId, count: list.length, list });
        } catch (e) {
            console.error(e);
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

// 5-2) 교원: 출석 상태 일괄 저장(없으면 생성)
// PATCH /sessions/:id/rollcall (INSTRUCTOR/ADMIN)
// body: { items: [{studentId, status}, ...] }
router.patch(
    "/sessions/:id/rollcall",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        const t = await sequelize.transaction();
        try {
            const user = req.session.user;
            const session = await ClassSession.findByPk(req.params.id);
            if (!session) {
                await t.rollback();
                return res.status(404).json({ message: "세션 없음" });
            }

            const course = await Course.findByPk(session.courseId);
            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                await t.rollback();
                return res.status(403).json({ message: "본인 과목 세션만 수정 가능" });
            }

            if (session.attendanceMethod !== "ROLL_CALL") {
                await t.rollback();
                return res.status(400).json({ message: "ROLL_CALL 세션이 아닙니다." });
            }

            const { items } = req.body;
            if (!Array.isArray(items) || items.length === 0) {
                await t.rollback();
                return res.status(400).json({ message: "items 배열이 필요합니다." });
            }

            const allowedStatus = new Set([0, 1, 2, 3, 4]);

            // 수강생 여부 체크
            const enr = await Enrollment.findAll({
                where: { courseId: session.courseId },
                attributes: ["studentId"],
                transaction: t,
            });
            const studentSet = new Set(enr.map((e) => Number(e.studentId)));

            const results = { updated: 0, created: 0, skipped: 0 };

            for (const it of items) {
                const studentId = Number(it.studentId);
                const status = Number(it.status);

                if (!studentId || !allowedStatus.has(status)) {
                    results.skipped++;
                    continue;
                }
                if (!studentSet.has(studentId)) {
                    results.skipped++;
                    continue;
                }

                const [attendance, created] = await Attendance.findOrCreate({
                    where: { sessionId: session.id, studentId },
                    defaults: {
                        status,
                        checkedAt: new Date(),
                        // Attendance 모델에 updatedBy가 있으면 자동 반영(없으면 무시됨)
                        updatedBy: user.id,
                    },
                    transaction: t,
                });

                if (!created) {
                    attendance.status = status;
                    attendance.checkedAt = attendance.checkedAt || new Date();
                    if ("updatedBy" in attendance) attendance.updatedBy = user.id;
                    await attendance.save({ transaction: t });
                    results.updated++;
                } else {
                    results.created++;
                }
            }

            await t.commit();
            res.json({ ok: true, sessionId: session.id, results });
        } catch (e) {
            console.error(e);
            try { await t.rollback(); } catch (_) {}
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

// =========================
// 6) 세션 자동 생성(공휴일 제외 + 보강이 빠진 round 채우기)
// POST /courses/:courseId/sessions/generate
// =========================
router.post(
    "/courses/:courseId/sessions/generate",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        const t = await sequelize.transaction();
        try {
            const user = req.session.user;
            const courseId = Number(req.params.courseId);

            const course = await Course.findByPk(courseId);
            if (!course) {
                await t.rollback();
                return res.status(404).json({ message: "과목 없음" });
            }

            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                await t.rollback();
                return res.status(403).json({ message: "본인 과목만 세션 생성 가능" });
            }

            const {
                baseDate,
                weeks,
                meetingDays,
                times,
                room,
                attendanceMethod = "CODE",
                defaultStatus = "CLOSED",
                holidays = [],
                makeups = [],
                mode = "skipExisting",
            } = req.body;

            const base = parseYmd(baseDate);
            if (!base) {
                await t.rollback();
                return res.status(400).json({ message: "baseDate는 YYYY-MM-DD 형식이어야 합니다." });
            }

            const weeksNum = Number(weeks);
            if (!weeksNum || weeksNum < 1 || weeksNum > 30) {
                await t.rollback();
                return res.status(400).json({ message: "weeks는 1~30 범위의 숫자여야 합니다." });
            }

            const dows = normalizeMeetingDays(meetingDays);
            if (!dows) {
                await t.rollback();
                return res.status(400).json({ message: "meetingDays는 [MON,WED] 또는 [1,3] 형태여야 합니다." });
            }

            if (!Array.isArray(times) || times.length === 0) {
                await t.rollback();
                return res.status(400).json({ message: "times는 최소 1개 이상 필요합니다." });
            }

            const timeSpecs = times.map((x) => {
                const hm = parseHm(x.start);
                const dur = Number(x.durationMinutes);
                if (!hm || !dur || dur < 10 || dur > 300) return null;
                return { hm, durationMinutes: dur };
            });

            if (timeSpecs.some((x) => x === null)) {
                await t.rollback();
                return res.status(400).json({ message: "times의 start(HH:MM) 또는 durationMinutes(10~300)가 올바르지 않습니다." });
            }

            const allowedMethods = ["ELECTRONIC", "CODE", "ROLL_CALL"];
            if (!allowedMethods.includes(attendanceMethod)) {
                await t.rollback();
                return res.status(400).json({ message: "attendanceMethod는 ELECTRONIC|CODE|ROLL_CALL 중 하나" });
            }

            if (!["OPEN", "CLOSED", "PAUSED"].includes(defaultStatus)) {
                await t.rollback();
                return res.status(400).json({ message: "defaultStatus는 OPEN|CLOSED|PAUSED 중 하나여야 합니다." });
            }

            if (!["skipExisting", "errorOnConflict", "overwrite"].includes(mode)) {
                await t.rollback();
                return res.status(400).json({ message: "mode는 skipExisting|errorOnConflict|overwrite 중 하나여야 합니다." });
            }

            const holidaySet = new Set((holidays || []).map(String));

            let created = 0;
            let skipped = 0;
            let updated = 0;

            const results = [];
            const skippedHolidays = [];
            const missingByWeek = new Map();

            // round 고정 슬롯 생성
            for (let w = 0; w < weeksNum; w++) {
                const week = w + 1;

                const allSlots = [];
                for (const dow of dows) {
                    const baseDow = base.getDay();
                    const delta = (dow - baseDow + 7) % 7;
                    const dayBase = addDays(base, w * 7 + delta);

                    for (const ts of timeSpecs) {
                        const startAt = buildDateTime(dayBase, ts.hm);
                        const endAt = addMinutes(startAt, ts.durationMinutes);
                        allSlots.push({ startAt, endAt });
                    }
                }

                allSlots.sort((a, b) => a.startAt - b.startAt);

                for (let i = 0; i < allSlots.length; i++) {
                    const round = i + 1;
                    const slot = allSlots[i];
                    const ymd = toYmd(slot.startAt);

                    if (holidaySet.has(ymd)) {
                        skippedHolidays.push({ week, round, date: ymd });
                        if (!missingByWeek.has(week)) missingByWeek.set(week, new Set());
                        missingByWeek.get(week).add(round);
                        continue;
                    }

                    const payload = {
                        courseId,
                        week,
                        round,
                        startAt: slot.startAt,
                        endAt: slot.endAt,
                        room: room || null,
                        attendanceMethod,
                        status: defaultStatus,
                    };

                    // CODE만 code 발급
                    if (attendanceMethod === "CODE") payload.code = random6Digit();
                    else payload.code = null;

                    const existing = await ClassSession.findOne({ where: { courseId, week, round }, transaction: t });

                    if (existing) {
                        if (mode === "errorOnConflict") {
                            await t.rollback();
                            return res.status(409).json({ message: `이미 존재하는 세션: week=${week}, round=${round}` });
                        }
                        if (mode === "overwrite") {
                            const before = existing.toJSON();
                            await existing.update(payload, { transaction: t });
                            updated++;
                            results.push({ action: "updated", sessionId: existing.id, before, after: existing.toJSON() });
                        } else {
                            skipped++;
                            results.push({ action: "skipped", sessionId: existing.id, week, round });
                        }
                    } else {
                        const createdSession = await ClassSession.create(payload, { transaction: t });
                        created++;
                        results.push({ action: "created", sessionId: createdSession.id, week, round });
                    }
                }
            }

            // makeups: missing round 우선 채움
            const appliedMakeups = [];

            if (Array.isArray(makeups) && makeups.length > 0) {
                for (const m of makeups) {
                    const d = parseYmd(m.date);
                    const hm = parseHm(m.start);
                    const dur = Number(m.durationMinutes || timeSpecs[0].durationMinutes);

                    if (!d || !hm || !dur) {
                        await t.rollback();
                        return res.status(400).json({ message: "makeups는 date(YYYY-MM-DD), start(HH:MM) 필수입니다." });
                    }

                    const startAt = buildDateTime(d, hm);
                    const endAt = addMinutes(startAt, dur);

                    let week = Number(m.week);
                    if (!week) {
                        const diffDays = Math.floor((parseYmd(toYmd(d)) - parseYmd(toYmd(base))) / (1000 * 60 * 60 * 24));
                        week = Math.floor(diffDays / 7) + 1;
                    }

                    let round = Number(m.round);
                    if (!round) {
                        const missing = missingByWeek.get(week);
                        if (missing && missing.size > 0) {
                            const sorted = Array.from(missing).sort((a, b) => a - b);
                            round = sorted[0];
                            missing.delete(round);
                        } else {
                            const maxRound = await getMaxRound(courseId, week, t);
                            round = maxRound + 1;
                        }
                    }

                    const method = m.attendanceMethod || attendanceMethod;
                    if (!["ELECTRONIC", "CODE", "ROLL_CALL"].includes(method)) {
                        await t.rollback();
                        return res.status(400).json({ message: "makeups.attendanceMethod가 올바르지 않습니다." });
                    }

                    const payload = {
                        courseId,
                        week,
                        round,
                        startAt,
                        endAt,
                        room: m.room ?? room ?? null,
                        attendanceMethod: method,
                        status: m.status || defaultStatus,
                    };
                    if (method === "CODE") payload.code = random6Digit();
                    else payload.code = null;

                    const existing = await ClassSession.findOne({ where: { courseId, week, round }, transaction: t });

                    if (existing) {
                        if (mode === "errorOnConflict") {
                            await t.rollback();
                            return res.status(409).json({ message: `이미 존재하는 보강 세션: week=${week}, round=${round}` });
                        }
                        if (mode === "overwrite") {
                            await existing.update(payload, { transaction: t });
                            updated++;
                            appliedMakeups.push({ action: "updated_makeup", week, round, sessionId: existing.id });
                        } else {
                            skipped++;
                            appliedMakeups.push({ action: "skipped_makeup", week, round, sessionId: existing.id });
                        }
                    } else {
                        const createdSession = await ClassSession.create(payload, { transaction: t });
                        created++;
                        appliedMakeups.push({ action: "created_makeup", week, round, sessionId: createdSession.id });
                    }
                }
            }

            const missingSummary = {};
            for (const [wk, set] of missingByWeek.entries()) {
                if (set.size > 0) missingSummary[wk] = Array.from(set).sort((a, b) => a - b);
            }

            await t.commit();

            return res.status(201).json({
                message: "sessions generated",
                courseId,
                created,
                updated,
                skipped,
                skippedHolidays,
                appliedMakeups,
                missingSummary,
                sample: results.slice(0, 30),
            });
        } catch (e) {
            console.error(e);
            try { await t.rollback(); } catch (_) {}
            return res.status(500).json({ message: "서버 에러" });
        }
    }
);

module.exports = router;