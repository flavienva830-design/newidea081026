import { defineConfig } from "prisma/config";

// Migrations run as the table owner (DATABASE_ADMIN_URL). The application
// itself connects as a restricted role (DATABASE_URL) so Row-Level Security applies.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env["DATABASE_ADMIN_URL"] ?? process.env["DATABASE_URL"] ?? "",
  },
});
