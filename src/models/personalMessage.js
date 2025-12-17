const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define(
        "PersonalMessage",
        {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            senderId: { type: DataTypes.INTEGER, allowNull: false },
            receiverId: { type: DataTypes.INTEGER, allowNull: false },

            title: { type: DataTypes.STRING(200), allowNull: false, defaultValue: "" },
            content: { type: DataTypes.TEXT, allowNull: false },

            isRead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
            readAt: { type: DataTypes.DATE, allowNull: true },
        },
        {
            tableName: "personal_messages",
            underscored: true,
            timestamps: true,
            indexes: [
                { fields: ["receiver_id", "is_read"] },
            ],
        }
    );
};