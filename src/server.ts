import express from "express";
import { FirehosePost, FirehoseSubscription } from "./firehose";
import { feeds, processPost, publishAllFeeds, serviceDid, storage } from "./feeds";

const POSTS_PER_PAGE = 5;
const startTime = performance.now();
let processedPosts = 0;
const posts: FirehosePost[] = [];

async function main() {
	process.on("SIGINT", () => {
		console.log("Shutting down...");
		process.exit();
	});

	const app = express();
	const port = process.env.PORT ?? 3333;

	await publishAllFeeds();

	app.get("/api/stats", (req, res) => {
		const postsPerSecond = (processedPosts / (performance.now() - startTime)) * 1000;
		const memUsage = process.memoryUsage();
		memUsage.rss /= 1024 * 1024;
		memUsage.heapUsed /= 1024 * 1024;
		memUsage.external /= 1024 * 1024;
		memUsage.arrayBuffers /= 1024 * 1024;

		res.json({
			postsPerSecond,
			memUsage,
		});
	});

	app.get("/.well-known/did.json", (req, res) => {
		res.json({
			"@context": ["https://www.w3.org/ns/did/v1"],
			id: serviceDid,
			service: [
				{
					id: "#bsky_fg",
					type: "BskyFeedGenerator",
					serviceEndpoint: "https://progfeeds.mariozechner.at",
				},
			],
		});
	});

	app.get("/xrpc/app.bsky.feed.describeFeedGenerator", (req, res) => {
		res.json({
			did: serviceDid,
			feeds: feeds.map(feed => {
				return {
					uri: feed.uri,
					created_at: new Date().toISOString(),
					name: feed.name,
					description: feed.description,
				};
			}),
		});
	});

	app.get("/xrpc/app.bsky.feed.getFeedSkeleton", (req, res) => {
		try {
			const feedUri = req.query.feed as string;
			if (!feedUri) {
				res.status(400).json({ error: "Missing feed parameter" });
				return;
			}
			const tokens = feedUri.split("/");
			const feedName = tokens[tokens.length - 1];
			const cursor = req.query.cursor as string | undefined;
			console.log(`Feed ${feedName} requested${cursor ? ` with cursor ${cursor}` : ""}`);

			const { posts, cursor: nextCursor } = storage.getPosts(feedName, POSTS_PER_PAGE, cursor);
			const feedItems = posts.map(post => ({
				post: post.uri,
			}));

			const response: {
				feed: Array<{ post: string }>;
				cursor?: string;
			} = {
				feed: feedItems,
				cursor: nextCursor,
			};

			res.json(response);
		} catch (error) {
			console.error("Error processing feed request:", error);
			res.status(500).json({ error: "Internal server error" });
		}
	});

	app.listen(port, async () => {
		console.log(`Feed generator server running on port ${port}`);

		console.log("Starting firehose subscription...");
		const onPost = (post: FirehosePost) => {
			processedPosts++;
			processPost(post);
		};
		const firehose = new FirehoseSubscription("wss://bsky.network");
		await firehose.run(onPost, false);
	});
}

main();
