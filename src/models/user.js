const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    const User = sequelize.define(
        "User",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            role: {
                type: DataTypes.ENUM("ADMIN", "INSTRUCTOR", "STUDENT"),
                allowNull: false,
            },
            name: { type: DataTypes.STRING(50), allowNull: false },
            email: { type: DataTypes.STRING(100), allowNull: false, unique: true },
            passwordHash: { type: DataTypes.STRING(100), allowNull: false },
            department: { type: DataTypes.STRING(100), allowNull: true },
        },
        {
            tableName: "users",
            underscored: true,
            timestamps: true,
        }
    );

    return User;
};