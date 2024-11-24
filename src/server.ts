import express, { Express } from "express"
import { feeds, publishAllFeeds, serviceDid } from "./feeds"
import { FeedStorage } from "./storage"
import path from "path"
import { Worker } from "worker_threads"
import { fork } from "child_process"
import * as fs from "fs"

const POSTS_PER_PAGE = 5
let workerStats = {
	start: performance.now(),
	numPosts: 0,
	numEvents: 0,
}

const storage = new FeedStorage()
storage.initialize(feeds.map(feed => feed.rkey))

function setupRoutes(app: Express) {
	app.get("/api/stats", (req, res) => {
		const postsPerSecond = (workerStats.numPosts / (performance.now() - workerStats.start)) * 1000
		const eventsPerSecond = (workerStats.numEvents / (performance.now() - workerStats.start)) * 1000
		const memStats = process.memoryUsage()
		memStats.rss /= 1024 * 1024
		memStats.heapUsed /= 1024 * 1024
		memStats.external /= 1024 * 1024
		memStats.arrayBuffers /= 1024 * 1024

		const feedStats: { feed: string; numPosts: number; fileSize: number }[] = []
		for (const rkey of storage.feeds.keys()) {
			const posts = storage.feeds.get(rkey)
			feedStats.push({
				feed: rkey,
				numPosts: posts?.length ?? 0,
				fileSize: fs.statSync(storage.getFilePath(rkey)).size,
			})
		}
		feedStats.sort((a, b) => a.feed.localeCompare(b.feed))

		res.json({
			numPosts: workerStats.numPosts,
			numEvents: workerStats.numEvents,
			postsPerSecond,
			eventsPerSecond,
			feedStats,
			memStats,
		})
	})

	app.get("/.well-known/did.json", (req, res) => {
		console.log("did.json requested")
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
		})
	})

	app.get("/xrpc/app.bsky.feed.describeFeedGenerator", (req, res) => {
		console.log("Feed description requested")
		res.json({
			did: serviceDid,
			feeds: feeds.map(feed => {
				return {
					uri: feed.uri,
					created_at: new Date().toISOString(),
					name: feed.name,
					description: feed.description,
				}
			}),
		})
	})

	app.get("/xrpc/app.bsky.feed.getFeedSkeleton", (req, res) => {
		try {
			const feedUri = req.query.feed as string
			if (!feedUri) {
				console.log("Missing feed parameter")
				res.status(400).json({ error: "Missing feed parameter" })
				return
			}
			const tokens = feedUri.split("/")
			const feedName = tokens[tokens.length - 1]
			const cursor = req.query.cursor as string | undefined
			console.log(`Feed ${feedName} requested${cursor ? ` with cursor ${cursor}` : ""}`)

			const { posts, cursor: nextCursor } = storage.getPosts(feedName, POSTS_PER_PAGE, cursor)
			const feedItems = posts.map(post => ({
				post: post.uri,
			}))

			const response: {
				feed: Array<{ post: string }>
				cursor?: string
			} = {
				feed: feedItems,
				cursor: nextCursor,
			}

			res.json(response)
		} catch (error) {
			console.error("Error processing feed request:", error)
			res.status(500).json({ error: "Internal server error" })
		}
	})
}

function startFirehoseWorker() {
	const isDebugMode = process.execArgv.some(arg => arg.startsWith("--inspect-brk=") || arg.startsWith("--inspect="))
	// Use child process in prod, better perf
	const worker = isDebugMode ? new Worker(path.join(__dirname, "worker.js")) : fork(path.join(__dirname, "worker.js"))
	console.log("Worker mode: " + (isDebugMode ? "thread" : "child process"))

	worker.on("message", (message: any) => {
		if (message.type === "stats") {
			workerStats.numPosts = message.processedPosts
			workerStats.numEvents = message.processedEvents
		} else if (message.type === "error") {
			console.error(`Worker error:`, message.error)
			process.exit(-1)
		} else if (message.type === "post") {
			for (const feed of message.feeds) {
				storage.addPost(feed, message.post)
			}
		}
	})

	worker.on("error", error => {
		console.error(`Worker failed:`, error)
		process.exit(-1)
	})

	worker.on("exit", code => {
		if (code !== 0) {
			console.error(`Worker stopped with exit code ${code}`)
			process.exit(-1)
		}
	})
}

async function main() {
	process.on("SIGINT", () => {
		console.log("Shutting down...")
		process.exit(-1)
	})

	// await publishAllFeeds()

	const app = express()
	const port = process.env.PORT ?? 3333
	setupRoutes(app)
	app.listen(port, async () => {
		console.log(`Feed generator server running on port ${port}`)
		console.log("Starting firehose worker")
		startFirehoseWorker()
	})
}

main()
