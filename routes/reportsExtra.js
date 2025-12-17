const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");

const {
    Course,
    ClassSession,
    Attendance,
    Enrollment,
    User,
    ExcuseRequest,
    AuditLog,
    Appeal, // Appeal 모델 있으면 자동 활용(없으면 require 제거)
} = require("../src/models");

const router = express.Router();

function up(x) {
    return x ? String(x).toUpperCase() : null;
}
function parseYmdStart(ymd) {
    if (!ymd) return null;
    const [y, m, d] = String(ymd).split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 0, 0, 0, 0);
}
function parseYmdEnd(ymd) {
    if (!ymd) return null;
    const [y, m, d] = String(ymd).split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 23, 59, 59, 999);
}
function safeJson(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "object") return v;
    const s = String(v);
    try { return JSON.parse(s); } catch (_) { return s; }
}

async function assertCoursePermission(reqUser, courseId) {
    const course = await Course.findByPk(courseId);
    if (!course) return { ok: false, status: 404, message: "과목 없음" };

    if (reqUser.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(reqUser.id)) {
        return { ok: false, status: 403, message: "본인 과목만 조회 가능" };
    }
    return { ok: true, course };
}

/**
 * =========================================
 * 1) 공결 리포트
 * GET /reports/excuses?courseId=1&status=PENDING&week=2
 * - INSTRUCTOR/ADMIN: 과목 공결 신청 목록 + 주차별/상태별 통계
 * =========================================
 */
router.get(
    "/reports/excuses",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const courseId = Number(req.query.courseId);
            const status = up(req.query.status);
            const week = req.query.week ? Number(req.query.week) : null;

            if (!courseId) return res.status(400).json({ message: "courseId가 필요합니다." });
            if (status && !["PENDING", "APPROVED", "REJECTED"].includes(status)) {
                return res.status(400).json({ message: "status는 PENDING|APPROVED|REJECTED" });
            }
            if (week !== null && (!week || week < 1 || week > 40)) {
                return res.status(400).json({ message: "week는 1~40 범위 숫자" });
            }

            const perm = await assertCoursePermission(user, courseId);
            if (!perm.ok) return res.status(perm.status).json({ message: perm.message });
            const course = perm.course;

            // 해당 과목 세션들(week 필터 포함)
            const sessionWhere = { courseId };
            if (week !== null) sessionWhere.week = week;

            const sessions = await ClassSession.findAll({
                where: sessionWhere,
                attributes: ["id", "courseId", "week", "round", "startAt", "endAt"],
            });
            const sessionIds = sessions.map((s) => Number(s.id));
            if (sessionIds.length === 0) {
                return res.json({
                    courseId,
                    courseTitle: course.title,
                    filter: { status, week },
                    count: 0,
                    stats: { byStatus: {}, byWeek: {} },
                    list: [],
                });
            }

            const whereExcuse = { sessionId: sessionIds };
            if (status) whereExcuse.status = status;

            // ExcuseRequest 모델에 createdAt/updatedAt이 있을 거라 가정
            const listRaw = await ExcuseRequest.findAll({
                where: whereExcuse,
                order: [["createdAt", "DESC"]],
            });

            // 학생/세션 정보 붙이기(가벼운 hydration)
            const studentIds = Array.from(new Set(listRaw.map((x) => Number(x.studentId)).filter(Boolean)));
            const users = await User.findAll({
                where: { id: studentIds },
                attributes: ["id", "name", "email", "department"],
            });
            const userMap = new Map(users.map((u) => [Number(u.id), u.toJSON()]));

            const sessionMap = new Map(sessions.map((s) => [Number(s.id), s.toJSON()]));

            // 통계
            const byStatus = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
            const byWeek = {}; // { [week]: {PENDING, APPROVED, REJECTED, total} }

            const list = listRaw.map((x) => {
                const e = x.toJSON();
                const ses = sessionMap.get(Number(e.sessionId));
                const wk = ses?.week ?? null;

                if (e.status in byStatus) byStatus[e.status]++;

                if (wk !== null) {
                    if (!byWeek[wk]) byWeek[wk] = { week: wk, PENDING: 0, APPROVED: 0, REJECTED: 0, total: 0 };
                    byWeek[wk].total++;
                    if (e.status in byWeek[wk]) byWeek[wk][e.status]++;
                }

                return {
                    id: e.id,
                    status: e.status,
                    reasonCode: e.reasonCode ?? null,
                    reasonText: e.reasonText ?? null,
                    filePath: e.filePath ?? null,
                    createdAt: e.createdAt,
                    updatedAt: e.updatedAt,
                    student: userMap.get(Number(e.studentId)) || { id: e.studentId, name: null, email: null, department: null },
                    session: ses || { id: e.sessionId, week: null, round: null, startAt: null, endAt: null },
                };
            });

            // 정렬: week 오름차순으로 byWeek 배열화
            const byWeekArr = Object.values(byWeek).sort((a, b) => Number(a.week) - Number(b.week));

            const total = list.length;
            const approvedRate = total ? Math.round((byStatus.APPROVED / total) * 10000) / 100 : 0;

            return res.json({
                courseId,
                courseTitle: course.title,
                filter: { status, week },
                count: total,
                stats: {
                    byStatus,
                    approvedRate, // %
                    byWeek: byWeekArr,
                },
                list,
            });
        } catch (e) {
            console.error(e);
            return res.status(500).json({ message: "서버 에러" });
        }
    }
);

/**
 * =========================================
 * 2) 감사로그 리포트
 * GET /reports/audits?courseId=1&targetType=ATTENDANCE&action=UPDATE&from=2025-12-01&to=2025-12-31
 *
 * - INSTRUCTOR/ADMIN
 * - courseId 필수(과목 단위 리포트)
 * - targetType/action/date 범위로 필터
 *
 * ※ AuditLog가 courseId를 직접 안 가지는 구조라
 *    targetType별로 "해당 target이 어떤 course에 속하는지"를 역추적해서 필터함.
 * =========================================
 */
router.get(
    "/reports/audits",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        try {
            const user = req.session.user;

            const courseId = Number(req.query.courseId);
            const targetType = up(req.query.targetType); // 예: ATTENDANCE, EXCUSE, APPEAL, SESSION
            const action = up(req.query.action);         // 예: UPDATE, ACCEPT, REJECT, OPEN, CLOSE 등
            const from = parseYmdStart(req.query.from);
            const to = parseYmdEnd(req.query.to);
            const limit = Math.min(Number(req.query.limit || 200), 500);

            if (!courseId) return res.status(400).json({ message: "courseId가 필요합니다." });
            const perm = await assertCoursePermission(user, courseId);
            if (!perm.ok) return res.status(perm.status).json({ message: perm.message });
            const course = perm.course;

            const whereLog = {};
            if (targetType) whereLog.targetType = targetType;
            if (action) whereLog.action = action;
            if (from || to) {
                whereLog.createdAt = {};
                if (from) whereLog.createdAt.$gte = from;
                if (to) whereLog.createdAt.$lte = to;
            }

            // Sequelize 버전에 따라 Op 필요할 수 있음 → 안전하게 import 없이 처리:
            // createdAt 범위 필터가 안 먹으면 아래를 Op로 바꿔줘.
            if (whereLog.createdAt) {
                const { Op } = require("sequelize");
                const x = {};
                if (from) x[Op.gte] = from;
                if (to) x[Op.lte] = to;
                whereLog.createdAt = x;
            }

            const logs = await AuditLog.findAll({
                where: whereLog,
                order: [["createdAt", "DESC"]],
                limit,
            });

            if (logs.length === 0) {
                return res.json({
                    courseId,
                    courseTitle: course.title,
                    filter: { targetType, action, from: req.query.from || null, to: req.query.to || null, limit },
                    count: 0,
                    stats: { byTargetType: {}, byAction: {} },
                    list: [],
                });
            }

            // actor 정보
            const actorIds = Array.from(new Set(logs.map((l) => Number(l.actorId)).filter(Boolean)));
            const actors = await User.findAll({
                where: { id: actorIds },
                attributes: ["id", "name", "email", "role", "department"],
            });
            const actorMap = new Map(actors.map((a) => [Number(a.id), a.toJSON()]));

            // targetType별 targetId 모으기
            const byTypeIds = {};
            for (const l of logs) {
                const tt = String(l.targetType || "");
                const tid = Number(l.targetId);
                if (!tt || !tid) continue;
                if (!byTypeIds[tt]) byTypeIds[tt] = new Set();
                byTypeIds[tt].add(tid);
            }

            // targetType별 courseId 역추적 맵: key `${type}:${id}` -> { courseId, sessionId? }
            const targetCourseMap = new Map();

            // 1) ATTENDANCE -> Attendance.sessionId -> ClassSession.courseId
            if (byTypeIds.ATTENDANCE && byTypeIds.ATTENDANCE.size > 0) {
                const attIds = Array.from(byTypeIds.ATTENDANCE);
                const atts = await Attendance.findAll({
                    where: { id: attIds },
                    attributes: ["id", "sessionId", "studentId", "status"],
                });

                const sesIds = Array.from(new Set(atts.map((a) => Number(a.sessionId)).filter(Boolean)));
                const ses = await ClassSession.findAll({
                    where: { id: sesIds },
                    attributes: ["id", "courseId", "week", "round"],
                });
                const sesMap = new Map(ses.map((s) => [Number(s.id), s.toJSON()]));

                for (const a of atts) {
                    const s = sesMap.get(Number(a.sessionId));
                    if (!s) continue;
                    targetCourseMap.set(`ATTENDANCE:${a.id}`, { courseId: Number(s.courseId), session: s });
                }
            }

            // 2) EXCUSE / EXCUSE_REQUEST -> ExcuseRequest.sessionId -> ClassSession.courseId
            // 네 targetType이 "EXCUSE"로 저장돼 있을 수도 있고 "EXCUSE_REQUEST"일 수도 있어서 둘 다 처리
            for (const keyType of ["EXCUSE", "EXCUSE_REQUEST"]) {
                if (byTypeIds[keyType] && byTypeIds[keyType].size > 0) {
                    const ids = Array.from(byTypeIds[keyType]);
                    const exs = await ExcuseRequest.findAll({
                        where: { id: ids },
                        attributes: ["id", "sessionId", "studentId", "status"],
                    });

                    const sesIds = Array.from(new Set(exs.map((x) => Number(x.sessionId)).filter(Boolean)));
                    const ses = await ClassSession.findAll({
                        where: { id: sesIds },
                        attributes: ["id", "courseId", "week", "round"],
                    });
                    const sesMap = new Map(ses.map((s) => [Number(s.id), s.toJSON()]));

                    for (const x of exs) {
                        const s = sesMap.get(Number(x.sessionId));
                        if (!s) continue;
                        targetCourseMap.set(`${keyType}:${x.id}`, { courseId: Number(s.courseId), session: s });
                    }
                }
            }

            // 3) APPEAL -> Appeal.attendanceId -> Attendance.sessionId -> ClassSession.courseId
            if (byTypeIds.APPEAL && byTypeIds.APPEAL.size > 0 && Appeal) {
                const ids = Array.from(byTypeIds.APPEAL);
                const aps = await Appeal.findAll({
                    where: { id: ids },
                    attributes: ["id", "attendanceId", "studentId", "status"],
                });

                const attIds = Array.from(new Set(aps.map((a) => Number(a.attendanceId)).filter(Boolean)));
                const atts = await Attendance.findAll({
                    where: { id: attIds },
                    attributes: ["id", "sessionId"],
                });

                const sesIds = Array.from(new Set(atts.map((a) => Number(a.sessionId)).filter(Boolean)));
                const ses = await ClassSession.findAll({
                    where: { id: sesIds },
                    attributes: ["id", "courseId", "week", "round"],
                });

                const attMap = new Map(atts.map((a) => [Number(a.id), a.toJSON()]));
                const sesMap = new Map(ses.map((s) => [Number(s.id), s.toJSON()]));

                for (const ap of aps) {
                    const att = attMap.get(Number(ap.attendanceId));
                    const s = att ? sesMap.get(Number(att.sessionId)) : null;
                    if (!s) continue;
                    targetCourseMap.set(`APPEAL:${ap.id}`, { courseId: Number(s.courseId), session: s });
                }
            }

            // 4) SESSION -> ClassSession.courseId (세션 상태 변경 로그 등)
            if (byTypeIds.SESSION && byTypeIds.SESSION.size > 0) {
                const ids = Array.from(byTypeIds.SESSION);
                const ses = await ClassSession.findAll({
                    where: { id: ids },
                    attributes: ["id", "courseId", "week", "round"],
                });
                for (const s of ses) {
                    targetCourseMap.set(`SESSION:${s.id}`, { courseId: Number(s.courseId), session: s.toJSON() });
                }
            }

            // courseId로 필터링 + 통계
            const byTargetType = {};
            const byAction = {};

            const list = [];
            for (const l of logs) {
                const type = String(l.targetType || "");
                const tid = Number(l.targetId);

                // course 역추적 (type alias 고려)
                const probeKeys = [
                    `${type}:${tid}`,
                    // EXCUSE_REQUEST를 EXCUSE로 저장했을 수도 있어서 교차도 한 번
                    type === "EXCUSE" ? `EXCUSE_REQUEST:${tid}` : null,
                    type === "EXCUSE_REQUEST" ? `EXCUSE:${tid}` : null,
                ].filter(Boolean);

                let mapped = null;
                for (const k of probeKeys) {
                    if (targetCourseMap.has(k)) {
                        mapped = targetCourseMap.get(k);
                        break;
                    }
                }

                // courseId 필터가 “필수”이므로, 역추적이 안 되면 제외(원하면 포함하게 바꿔도 됨)
                if (!mapped || Number(mapped.courseId) !== Number(courseId)) continue;

                byTargetType[type] = (byTargetType[type] || 0) + 1;
                byAction[String(l.action || "UNKNOWN")] = (byAction[String(l.action || "UNKNOWN")] || 0) + 1;

                list.push({
                    id: l.id,
                    createdAt: l.createdAt,
                    targetType: type,
                    targetId: tid,
                    action: l.action,
                    courseId: mapped.courseId,
                    session: mapped.session || null,
                    actor: actorMap.get(Number(l.actorId)) || { id: l.actorId, name: null, role: null },
                    before: safeJson(l.beforeValue),
                    after: safeJson(l.afterValue),
                });
            }

            return res.json({
                courseId,
                courseTitle: course.title,
                filter: { targetType, action, from: req.query.from || null, to: req.query.to || null, limit },
                count: list.length,
                stats: { byTargetType, byAction },
                list,
            });
        } catch (e) {
            console.error(e);
            return res.status(500).json({ message: "서버 에러" });
        }
    }
);

module.exports = router;