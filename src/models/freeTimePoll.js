const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define(
        "FreeTimePoll",
        {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            courseId: { type: DataTypes.INTEGER, allowNull: false },
            creatorId: { type: DataTypes.INTEGER, allowNull: false },

            title: { type: DataTypes.STRING(200), allowNull: false },
            description: { type: DataTypes.TEXT, allowNull: true },

            status: { type: DataTypes.ENUM("OPEN", "CLOSED"), allowNull: false, defaultValue: "OPEN" },
            deadlineAt: { type: DataTypes.DATE, allowNull: true },
        },
        {
            tableName: "free_time_polls",
            underscored: true,
            timestamps: true,
        }
    );
};