const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define(
        "Enrollment",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            courseId: { type: DataTypes.INTEGER, allowNull: false },
            studentId: { type: DataTypes.INTEGER, allowNull: false },
        },
        {
            tableName: "enrollments",
            underscored: true,
            timestamps: true,
            indexes: [{ unique: true, fields: ["course_id", "student_id"] }],
        }
    );
};