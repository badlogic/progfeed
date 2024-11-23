import esbuild from "esbuild";

let watch = process.argv.length >= 3 && process.argv[2] == "--watch";

const config = {
	entryPoints: {
		"feed-server": "src/server.ts",
		cleanup: "src/cleanup.ts",
		worker: "src/worker.ts",
	},
	bundle: true,
	sourcemap: true,
	platform: "node",
	target: "node20",
	format: "esm",
	mainFields: ["module", "main"],
	external: ["fsevents", "crypto"],
	outdir: "build/",
	logLevel: "info",
	minify: false,
	loader: {
		".ttf": "dataurl",
		".woff": "dataurl",
		".woff2": "dataurl",
		".eot": "dataurl",
		".html": "text",
		".svg": "text",
		".css": "text",
	},
	banner: {
		js: `
            import { createRequire } from 'module';
            import { fileURLToPath } from 'url';
            import { dirname } from 'path';
            const require = createRequire(import.meta.url);
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
        `,
	},
};

if (!watch) {
	console.log("Building server");
	await esbuild.build(config);
} else {
	const buildContext = await esbuild.context(config);
	buildContext.watch();
}
