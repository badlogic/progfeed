import { parentPort } from "worker_threads";
import { isPostRelevant } from "./feeds";
import { Firehose, FirehosePost } from "./firehose";

async function runWorker() {
	const firehose = new Firehose();
	let processedPosts = 0;
	let lastStatsSent = performance.now();

	const onPost = (post: FirehosePost) => {
		processedPosts++;

		const feeds = isPostRelevant(post);
		if (feeds.length > 0) {
			const message = {
				type: "post",
				feeds,
				post,
			};
			if (process.send) process.send(message);
			parentPort?.postMessage(message);
		}

		if (performance.now() - lastStatsSent > 1000) {
			const message = {
				type: "stats",
				processedPosts,
				processedEvents: firehose.numEvents,
			};
			if (process.send) process.send(message);
			parentPort?.postMessage(message);
			lastStatsSent = performance.now();
		}
	};

	try {
		await firehose.run(onPost, false);
	} catch (error) {
		const message = {
			type: "error",
			error: (error as any).message,
		};
		if (process.send) process.send(message);
		parentPort?.postMessage(message);
		setTimeout(() => process.exit(1), 1000);
	}
}

process.on("message", (message) => {
	if ((message as any).type === "shutdown") {
		process.exit(0);
	}
});

runWorker();
