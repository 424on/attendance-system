require("dotenv").config();
const { Sequelize, DataTypes } = require("sequelize");

// ✅ Railway(MySQL 플러그인) 변수 우선, 없으면 로컬 .env(DB_*) 사용
const host = process.env.MYSQLHOST || process.env.DB_HOST || "127.0.0.1";
const port = Number(process.env.MYSQLPORT || process.env.DB_PORT || 3306);
const user = process.env.MYSQLUSER || process.env.DB_USER || "root";
const pass = process.env.MYSQLPASSWORD || process.env.DB_PASS || "";
const name = process.env.MYSQLDATABASE || process.env.DB_NAME || "attendance_db";

// ✅ 여기서 위 변수들을 반드시 사용해야 함
const sequelize = new Sequelize(name, user, pass, {
    host,
    port,
    dialect: "mysql",
    logging: false,
});

// ----- 아래는 네가 작성한 모델 로딩/관계 그대로 -----
const UserFactory = require("./user");
const CourseFactory = require("./course");
const EnrollmentFactory = require("./enrollment");
const ClassSessionFactory = require("./classSession");
const AttendanceFactory = require("./attendance");
const ExcuseRequestFactory = require("./excuseRequest");
const AuditLogFactory = require("./auditLog");
const AttendancePolicyFactory = require("./attendancePolicy");
const AppealFactory = require("./appeal");
const NotificationFactory = require("./notification");
const AnnouncementFactory = require("./announcement");
const AnnouncementReadFactory = require("./announcementRead");
const PersonalMessageFactory = require("./personalMessage");
const FreeTimePollFactory = require("./freeTimePoll");
const FreeTimePollOptionFactory = require("./freeTimePollOption");
const FreeTimePollVoteFactory = require("./freeTimePollVote");

// ✅ 모델 팩토리 호출
const User = UserFactory(sequelize);
const Course = CourseFactory(sequelize);
const Enrollment = EnrollmentFactory(sequelize);
const ClassSession = ClassSessionFactory(sequelize);
const Attendance = AttendanceFactory(sequelize);
const ExcuseRequest = ExcuseRequestFactory(sequelize);
const AuditLog = AuditLogFactory(sequelize);
const Appeal = AppealFactory(sequelize);
const AttendancePolicy = AttendancePolicyFactory(sequelize, DataTypes); // 이 형태면 OK
const Notification = NotificationFactory(sequelize);
const Announcement = AnnouncementFactory(sequelize);
const AnnouncementRead = AnnouncementReadFactory(sequelize);
const PersonalMessage = PersonalMessageFactory(sequelize);
const FreeTimePoll = FreeTimePollFactory(sequelize);
const FreeTimePollOption = FreeTimePollOptionFactory(sequelize);
const FreeTimePollVote = FreeTimePollVoteFactory(sequelize);

// =========================
// 관계(Association) - 네 코드 그대로 OK
// =========================
Course.belongsTo(User, { foreignKey: "instructorId", as: "instructor" });

Enrollment.belongsTo(User, { foreignKey: "studentId", as: "student" });
Enrollment.belongsTo(Course, { foreignKey: "courseId", as: "course" });

ClassSession.belongsTo(Course, { foreignKey: "courseId", as: "course" });

Attendance.belongsTo(ClassSession, { foreignKey: "sessionId", as: "session" });
Attendance.belongsTo(User, { foreignKey: "studentId", as: "student" });

ExcuseRequest.belongsTo(ClassSession, { foreignKey: "sessionId", as: "session" });
ExcuseRequest.belongsTo(User, { foreignKey: "studentId", as: "student" });

Course.hasOne(AttendancePolicy, { foreignKey: "courseId", as: "policy" });
AttendancePolicy.belongsTo(Course, { foreignKey: "courseId", as: "course" });

Appeal.belongsTo(Attendance, { foreignKey: "attendanceId", as: "attendance" });
Appeal.belongsTo(User, { foreignKey: "studentId", as: "student" });

Notification.belongsTo(User, { foreignKey: "userId", as: "user" });
User.hasMany(Notification, { foreignKey: "userId", as: "notifications" });

Announcement.belongsTo(User, { foreignKey: "authorId", as: "author" });
Announcement.belongsTo(Course, { foreignKey: "courseId", as: "course" });

AnnouncementRead.belongsTo(Announcement, { foreignKey: "announcementId", as: "announcement" });
AnnouncementRead.belongsTo(User, { foreignKey: "userId", as: "user" });
Announcement.hasMany(AnnouncementRead, { foreignKey: "announcementId", as: "reads" });

PersonalMessage.belongsTo(User, { foreignKey: "senderId", as: "sender" });
PersonalMessage.belongsTo(User, { foreignKey: "receiverId", as: "receiver" });

FreeTimePoll.belongsTo(Course, { foreignKey: "courseId", as: "course" });
FreeTimePoll.belongsTo(User, { foreignKey: "creatorId", as: "creator" });

FreeTimePollOption.belongsTo(FreeTimePoll, { foreignKey: "pollId", as: "poll" });
FreeTimePoll.hasMany(FreeTimePollOption, { foreignKey: "pollId", as: "options" });

FreeTimePollVote.belongsTo(FreeTimePoll, { foreignKey: "pollId", as: "poll" });
FreeTimePollVote.belongsTo(FreeTimePollOption, { foreignKey: "optionId", as: "option" });
FreeTimePollVote.belongsTo(User, { foreignKey: "voterId", as: "voter" });

FreeTimePoll.hasMany(FreeTimePollVote, { foreignKey: "pollId", as: "votes" });

module.exports = {
    sequelize,
    User, Course, Enrollment, ClassSession, Attendance, ExcuseRequest, AuditLog, AttendancePolicy,
    Notification, Appeal,
    Announcement, AnnouncementRead, PersonalMessage,
    FreeTimePoll, FreeTimePollOption, FreeTimePollVote,
};