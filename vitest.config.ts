import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		dir: "test",
		mockReset: true,
		expandSnapshotDiff: true,
	},
});
