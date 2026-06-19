import { PrismaClient } from "@prisma/client";

export function createDatabaseClient(): PrismaClient {
  return new PrismaClient();
}

export const databaseClient = createDatabaseClient();
