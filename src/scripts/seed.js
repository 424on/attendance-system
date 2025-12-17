require("dotenv").config();
const bcrypt = require("bcrypt");
const { sequelize, User } = require("../models");

async function seed() {
    try {
        await sequelize.sync();

        const pw = await bcrypt.hash("1234", 10);

        await User.findOrCreate({
            where: { email: "admin@school.com" },
            defaults: { role: "ADMIN", name: "관리자", passwordHash: pw, department: "총무" },
        });

        await User.findOrCreate({
            where: { email: "instructor@school.com" },
            defaults: { role: "INSTRUCTOR", name: "교원", passwordHash: pw, department: "컴퓨터공학" },
        });

        await User.findOrCreate({
            where: { email: "student@school.com" },
            defaults: { role: "STUDENT", name: "학생", passwordHash: pw, department: "컴퓨터공학" },
        });

        console.log("✅ Seed done (pw: 1234)");
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

seed();