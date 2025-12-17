// src/models/notification.js
module.exports = (sequelize) => {
    const { DataTypes } = require("sequelize");

    const Notification = sequelize.define(
        "Notification",
        {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

            userId: { type: DataTypes.INTEGER, allowNull: false },

            // 예: EXCUSE_APPROVED, APPEAL_ACCEPTED, SESSION_OPENED ...
            type: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "INFO" },

            title: { type: DataTypes.STRING(100), allowNull: false },
            message: { type: DataTypes.TEXT, allowNull: false },

            // 클릭 이동용(선택)
            linkUrl: { type: DataTypes.STRING(255), allowNull: true },

            isRead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
            readAt: { type: DataTypes.DATE, allowNull: true },
        },
        {
            tableName: "notifications",
            underscored: true,
            timestamps: true,
        }
    );

    return Notification;
};