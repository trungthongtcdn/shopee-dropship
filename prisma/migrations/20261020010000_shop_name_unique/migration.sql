-- Two shops can't share a name in any letter case, even when two renames race. Prisma's
-- schema language can't express an index on lower(name), so it lives only here.
CREATE UNIQUE INDEX "shops_name_lower_key" ON "shops" (lower("name"));
