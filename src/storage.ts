import fs from "fs/promises"
import path from "path"
import { FirehosePost } from "./firehose"

export interface FeedResponse {
	posts: FirehosePost[]
	cursor?: string
}

export class FeedStorage {
	public feeds: Map<string, FirehosePost[]>
	private dataDir: string

	constructor(dataDir: string = "/data") {
		this.feeds = new Map()
		this.dataDir = dataDir
	}

	public async initialize(feedNames: string[]): Promise<void> {
		await this.ensureDataDirectory()

		for (const feedName of feedNames) {
			await this.loadFeed(feedName)
		}
	}

	public async addPost(feedName: string, post: FirehosePost): Promise<void> {
		if (!this.feeds.has(feedName)) {
			this.feeds.set(feedName, [])
		}

		const feedPosts = this.feeds.get(feedName)!
		feedPosts.push(post)
		await this.appendToFile(feedName, post)
	}

	public getPosts(feedName: string, limit: number, cursor?: string): FeedResponse {
		const feedPosts = this.feeds.get(feedName) || []
		const length = feedPosts.length

		if (!cursor) {
			const posts = feedPosts.slice(Math.max(0, length - limit)).reverse()

			return {
				posts,
				cursor: posts.length === limit ? (length - limit).toString() : undefined,
			}
		}

		const cursorIndex = parseInt(cursor)
		if (isNaN(cursorIndex) || cursorIndex < 0 || cursorIndex >= length) {
			return { posts: [] }
		}

		const posts = feedPosts.slice(Math.max(0, cursorIndex - limit), cursorIndex).reverse()

		return {
			posts,
			cursor: posts.length === limit ? (cursorIndex - limit).toString() : undefined,
		}
	}

	private async loadFeed(feedName: string): Promise<void> {
		try {
			const filePath = this.getFilePath(feedName)
			const content = await fs.readFile(filePath, "utf-8")
			const posts: FirehosePost[] = content
				.split("\n")
				.filter(line => line.trim())
				.map(line => JSON.parse(line))

			this.feeds.set(feedName, posts)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				this.feeds.set(feedName, [])
			} else {
				throw error
			}
		}
	}

	private async appendToFile(feedName: string, post: FirehosePost): Promise<void> {
		const filePath = this.getFilePath(feedName)
		await fs.appendFile(filePath, JSON.stringify(post) + "\n")
	}

	private async ensureDataDirectory(): Promise<void> {
		try {
			await fs.mkdir(this.dataDir, { recursive: true })
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
				throw error
			}
		}
	}

	getFilePath(feedName: string): string {
		return path.join(this.dataDir, `${feedName}.json`)
	}
}
