require("dotenv").config();

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

async function migrate() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  const migrationPath = path.join(
    __dirname,
    "database",
    "migrations",
    "001_create_products.sql"
  );
  const seedPath = path.join(
    __dirname,
    "database",
    "seeders",
    "001_seed_products.sql"
  );
  let connected = false;

  try {
    const sql = fs.readFileSync(migrationPath, "utf8");
    const seedSql = fs.readFileSync(seedPath, "utf8");

    await client.connect();
    connected = true;
    await client.query(sql);
    console.log("Migration completed successfully");
    await client.query(seedSql);
    console.log("Seeding completed successfully");
  } catch (error) {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (connected) {
      try {
        await client.end();
      } catch (error) {
        console.error("Failed to close database connection:", error.message);
        process.exitCode = 1;
      }
    }
  }
}

migrate();
