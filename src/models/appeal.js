// src/models/appeal.js
module.exports = (sequelize) => {
    const { DataTypes } = require("sequelize");

    const Appeal = sequelize.define(
        "Appeal",
        {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

            attendanceId: { type: DataTypes.INTEGER, allowNull: false },
            studentId: { type: DataTypes.INTEGER, allowNull: false },

            // 학생이 남기는 이의 내용
            message: { type: DataTypes.TEXT, allowNull: false },

            // 학생이 원하는 정정 상태(선택): 1=출석,2=지각,3=결석,4=공결
            requestedStatus: { type: DataTypes.INTEGER, allowNull: true },

            status: {
                type: DataTypes.ENUM("PENDING", "ACCEPTED", "REJECTED"),
                allowNull: false,
                defaultValue: "PENDING",
            },

            // 처리자/처리시간/답변
            reviewedBy: { type: DataTypes.INTEGER, allowNull: true },
            reviewedAt: { type: DataTypes.DATE, allowNull: true },
            replyText: { type: DataTypes.TEXT, allowNull: true },
        },
        {
            tableName: "appeals",
            underscored: true,
            timestamps: true,
        }
    );

    return Appeal;
};