import { isBuiltin } from "node:module";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: isBuiltin("node:sqlite") ? configDefaults.exclude : [...configDefaults.exclude, "test/catalog.test.ts"],
  },
});
