import { test } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";

interface TmpFixture {
	tmp: string;
}

export default test.extend<TmpFixture>({
	tmp: async ({}, use) => {
		// create ./tmp dir if necessary
		const tmpRoot = path.resolve(import.meta.dirname, "..", "tmp");
		await fs.mkdir(tmpRoot, { recursive: true });

		// create random fixture-123456 dir
		const tmpPrefix = path.join(tmpRoot, "fixture-");
		const tmpDir = await fs.mkdtemp(tmpPrefix);

		// pass to tests
		await use(tmpDir);

		// clean up
		await fs.rm(tmpDir, { recursive: true });
	},
});
