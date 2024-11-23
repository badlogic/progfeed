import { Subscription } from "@atproto/xrpc-server";
import { cborToLexRecord, readCar } from "@atproto/repo";

type FirehosePost = {
	author: string;
	text: string;
	createdAt: string;
	uri: string;
	cid: string;
};

interface RepoEvent {
	$type: string;
	seq: number;
	time: string;
	repo: string;
	commit: {
		rev: string;
		data: Uint8Array;
	};
	ops: Array<{
		action: string;
		path: string;
		cid: any;
	}>;
	blocks: Uint8Array;
}

interface Post {
	$type: string;
	text: string;
	reply?: {
		parent: { uri: string; cid: string };
		root: { uri: string; cid: string };
	};
	createdAt: string;
}

class FirehoseSubscription {
	public sub: Subscription<RepoEvent>;

	constructor(service: string) {
		this.sub = new Subscription({
			service: service,
			method: "com.atproto.sync.subscribeRepos",
			getParams: () => ({}),
			validate: (value: unknown) => value as RepoEvent,
		});
	}

	async run(onPost: (post: FirehosePost) => void, subscriptionReconnectDelay: number = 5000) {
		try {
			for await (const evt of this.sub) {
				if (!this.isCommit(evt)) continue;

				try {
					const car = await readCar(evt.blocks);
					for (const op of evt.ops) {
						if (op.action === "create" && op.path.startsWith("app.bsky.feed.post")) {
							const recordBytes = car.blocks.get(op.cid);
							if (!recordBytes) continue;
							const record = cborToLexRecord(recordBytes) as unknown as Post;
							if (!record.reply && record.text) {
								onPost({
									author: evt.repo,
									text: record.text,
									createdAt: record.createdAt,
									uri: `at://${evt.repo}/${op.path}`,
									cid: op.cid.toString(),
								});
							}
						}
					}
				} catch (err) {
					console.error("Error processing event:", err);
				}
			}
		} catch (err) {
			console.error("Firehose subscription error:", err);
			setTimeout(() => this.run(onPost, subscriptionReconnectDelay), subscriptionReconnectDelay);
		}
	}

	private isCommit(evt: RepoEvent): boolean {
		return evt.$type === "com.atproto.sync.subscribeRepos#commit";
	}
}

async function main() {
	try {
		console.log("Starting firehose subscription...");
		const firehose = new FirehoseSubscription("wss://bsky.network");

		process.on("SIGINT", () => {
			console.log("Shutting down...");
			process.exit();
		});

		const posts: FirehosePost[] = [];
		const onPost = (post: FirehosePost) => {
			// console.log(`${post.createdAt}: ${post.text}`);
			posts.push(post);
		};

		let lastNumPosts = 0;
		setInterval(() => {
			const numPosts = posts.length - lastNumPosts;
			const memUsage = process.memoryUsage();
			console.log(
				`${numPosts}/s | Posts: ${posts.length} | Memory: ` +
					`RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB | ` +
					`Heap: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}/${(memUsage.heapTotal / 1024 / 1024).toFixed(
						1,
					)}MB | ` +
					`External: ${(memUsage.external / 1024 / 1024).toFixed(1)}MB | ` +
					`ArrayBuffers: ${(memUsage.arrayBuffers / 1024 / 1024).toFixed(1)}MB`,
			);
			lastNumPosts = posts.length;
		}, 1000);

		await firehose.run(onPost);
	} catch (error) {
		console.error("Error in main:", error);
	}
}

main();
