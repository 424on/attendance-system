const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define(
        "Announcement",
        {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            scope: { type: DataTypes.ENUM("GLOBAL", "COURSE"), allowNull: false, defaultValue: "COURSE" },
            courseId: { type: DataTypes.INTEGER, allowNull: true },
            authorId: { type: DataTypes.INTEGER, allowNull: false },

            title: { type: DataTypes.STRING(200), allowNull: false },
            content: { type: DataTypes.TEXT, allowNull: false },
            pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        },
        {
            tableName: "announcements",
            underscored: true,
            timestamps: true,
        }
    );
};