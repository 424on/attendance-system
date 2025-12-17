const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");

const { Course, ClassSession, Attendance, Enrollment } = require("../src/models");

const router = express.Router();

function rate(num, den) {
    if (!den || den <= 0) return 0;
    return Math.round((num / den) * 10000) / 100; // 소수 2자리(%)
}

/**
 * GET /reports/attendance?courseId=1&week=2
 * - INSTRUCTOR/ADMIN: 과목 주차별 통계
 * - week 미지정이면 전체 주차 반환
 */
router.get(
    "/reports/attendance",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const courseId = Number(req.query.courseId);
            const week = req.query.week ? Number(req.query.week) : null;

            if (!courseId) return res.status(400).json({ message: "courseId가 필요합니다." });
            if (week !== null && (!week || week < 1 || week > 40)) {
                return res.status(400).json({ message: "week는 1~40 범위 숫자" });
            }

            const course = await Course.findByPk(courseId);
            if (!course) return res.status(404).json({ message: "과목 없음" });

            // 교원은 본인 과목만
            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                return res.status(403).json({ message: "본인 과목만 조회 가능" });
            }

            // 수강생 수
            const enrolledCount = await Enrollment.count({ where: { courseId } });

            // 세션들
            const whereSession = { courseId };
            if (week !== null) whereSession.week = week;

            const sessions = await ClassSession.findAll({
                where: whereSession,
                order: [["week", "ASC"], ["round", "ASC"]],
            });

            if (sessions.length === 0) {
                return res.json({
                    courseId,
                    courseTitle: course.title,
                    enrolledCount,
                    filter: { week },
                    sessionsCount: 0,
                    byWeek: [],
                    sessions: [],
                });
            }

            const sessionIds = sessions.map((s) => Number(s.id));

            // 한 번에 Attendance들 가져오기
            const rows = await Attendance.findAll({
                where: { sessionId: sessionIds },
                attributes: ["sessionId", "studentId", "status"],
            });

            // sessionId -> {counts, set}
            const perSession = new Map();
            for (const s of sessions) {
                perSession.set(Number(s.id), {
                    present: 0,
                    late: 0,
                    absent: 0,
                    excused: 0,
                    unknown0: 0, // status=0 인 것
                    seen: new Set(), // attendance 레코드가 존재하는 학생들
                });
            }

            for (const r of rows) {
                const sid = Number(r.sessionId);
                const st = Number(r.status);
                const obj = perSession.get(sid);
                if (!obj) continue;

                obj.seen.add(Number(r.studentId));

                if (st === 1) obj.present++;
                else if (st === 2) obj.late++;
                else if (st === 3) obj.absent++;
                else if (st === 4) obj.excused++;
                else obj.unknown0++; // 0 또는 기타
            }

            // 세션별 요약 만들기
            const sessionSummaries = sessions.map((s) => {
                const sid = Number(s.id);
                const data = perSession.get(sid);

                const recorded = data.seen.size;
                const missing = Math.max(0, enrolledCount - recorded); // 레코드 자체가 없는 수강생
                const unknown = data.unknown0 + missing;

                const totalSlots = enrolledCount; // 세션 1회 기준 슬롯 = 수강생 수
                const attended = data.present + data.late + data.excused; // (출석+지각+공결)을 “참여”로 볼 때

                return {
                    sessionId: sid,
                    week: s.week,
                    round: s.round,
                    startAt: s.startAt,
                    endAt: s.endAt,
                    status: s.status,
                    attendanceMethod: s.attendanceMethod,

                    totalSlots,
                    present: data.present,
                    late: data.late,
                    absent: data.absent,
                    excused: data.excused,
                    unknown,

                    rates: {
                        presentRate: rate(data.present, totalSlots),
                        attendedRate: rate(attended, totalSlots), // 출석(1)+지각(2)+공결(4)
                        absenceRate: rate(data.absent, totalSlots),
                        unknownRate: rate(unknown, totalSlots),
                    },
                };
            });

            // 주차별 합산(“주차 내 세션 수 × 수강생 수”를 분모로)
            const weekMap = new Map();
            for (const ss of sessionSummaries) {
                const wk = Number(ss.week);
                if (!weekMap.has(wk)) {
                    weekMap.set(wk, {
                        week: wk,
                        sessionCount: 0,
                        totalSlots: 0,
                        present: 0,
                        late: 0,
                        absent: 0,
                        excused: 0,
                        unknown: 0,
                    });
                }
                const w = weekMap.get(wk);
                w.sessionCount++;
                w.totalSlots += ss.totalSlots;
                w.present += ss.present;
                w.late += ss.late;
                w.absent += ss.absent;
                w.excused += ss.excused;
                w.unknown += ss.unknown;
            }

            const byWeek = Array.from(weekMap.values())
                .sort((a, b) => a.week - b.week)
                .map((w) => {
                    const attended = w.present + w.late + w.excused;
                    return {
                        ...w,
                        rates: {
                            presentRate: rate(w.present, w.totalSlots),
                            attendedRate: rate(attended, w.totalSlots),
                            absenceRate: rate(w.absent, w.totalSlots),
                            unknownRate: rate(w.unknown, w.totalSlots),
                        },
                    };
                });

            return res.json({
                courseId,
                courseTitle: course.title,
                enrolledCount,
                filter: { week },
                sessionsCount: sessions.length,
                byWeek,
                sessions: sessionSummaries,
            });
        } catch (e) {
            console.error(e);
            return res.status(500).json({ message: "서버 에러" });
        }
    }
);

module.exports = router;