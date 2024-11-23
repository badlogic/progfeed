import { parentPort } from "worker_threads";
import { isPostRelevant } from "./feeds";
import { FirehoseSubscription, FirehosePost } from "./firehose";

async function runWorker() {
	const firehose = new FirehoseSubscription("wss://bsky.network");
	let processedPosts = 0;
	let lastStatsSent = performance.now();

	const onPost = (post: FirehosePost) => {
		processedPosts++;

		const feeds = isPostRelevant(post);
		if (feeds.length > 0) {
			parentPort?.postMessage({
				type: "post",
				feeds,
				post,
			});
		}

		if (performance.now() - lastStatsSent > 1000) {
			parentPort?.postMessage({
				type: "stats",
				processedPosts,
			});
			lastStatsSent = performance.now();
		}
	};

	try {
		await firehose.run(onPost, false);
	} catch (error) {
		parentPort?.postMessage({
			type: "error",
			error: (error as any).message,
		});
		setTimeout(() => process.exit(1), 1000);
	}
}

process.on("message", message => {
	if ((message as any).type === "shutdown") {
		process.exit(0);
	}
});

runWorker();
