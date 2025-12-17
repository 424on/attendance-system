const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define(
        "AnnouncementRead",
        {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            announcementId: { type: DataTypes.INTEGER, allowNull: false },
            userId: { type: DataTypes.INTEGER, allowNull: false },
            readAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        },
        {
            tableName: "announcement_reads",
            underscored: true,
            timestamps: true,
            indexes: [
                { unique: true, fields: ["announcement_id", "user_id"] },
            ],
        }
    );
};