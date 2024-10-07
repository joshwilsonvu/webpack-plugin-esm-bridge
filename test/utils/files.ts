import fs from "node:fs/promises";
import path from "node:path";

export async function writeFiles(tmp: string, files: Record<string, string>) {
	await Promise.all(
		Object.entries(files).map(async ([p, content]) => {
			p = path.resolve(tmp, p.replace(/\//g, path.sep));
			await fs.mkdir(path.dirname(p), { recursive: true }); // add folder if necessary
			await fs.writeFile(p, content, { encoding: "utf-8" });
		}),
	);
}

export async function readFiles(tmp: string): Promise<Record<string, string>> {
	const files = (
		await fs.readdir(tmp, {
			recursive: true,
			withFileTypes: true,
			encoding: "utf-8",
		})
	)
		.filter((file) => file.isFile())
		.map((file) => path.join(file.parentPath ?? file.path, file.name));

	return Object.fromEntries(
		await Promise.all(
			files.map(async (file) => [
				path.relative(tmp, file).replace(/\\/g, "/"),
				await fs.readFile(file, "utf-8"),
			]),
		),
	);
}
