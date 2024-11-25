import { AtpAgent } from "@atproto/api";
import { ids } from "@atproto/api/dist/client/lexicons";
import { FirehosePost } from "./firehose";
import { FeedStorage } from "./storage";

export const host = "progfeeds.mariozechner.at";
export const serviceDid = `did:web:${host}`;
export type Feed = {
	rkey: string;
	name: string;
	description: string;
	uri?: string;
	isPostRelevant: (post: FirehosePost) => boolean;
};
export const feeds: Feed[] = [];

export async function publishFeed(feed: Feed) {
	const handle = process.env.PROGFEEDS_ACCOUNT;
	const password = process.env.PROGFEEDS_PASSWORD;
	if (!handle || !password) {
		console.error("No handl/password supplied. Set PROGFEEDS_ACCOUNT and PROGFEEDS_PASSWORD env vars");
		process.exit(-1);
	}

	const agent = new AtpAgent({ service: "https://bsky.social" });
	await agent.login({ identifier: handle, password });
	const record = {
		repo: agent.session?.did ?? "",
		collection: ids.AppBskyFeedGenerator,
		rkey: feed.rkey,
		record: {
			did: serviceDid,
			displayName: feed.name,
			description: feed.description,
			createdAt: new Date().toISOString(),
		},
	};
	console.log(`Publishing record for feed ${feed.rkey}`, record);
	const response = await agent.com.atproto.repo.putRecord(record);
	console.log("Succeeded: " + response.success, response.data);
	feed.uri = response.data.uri;
	if (!response.success) {
		console.error(`Could not publish record for feed ${feed.rkey}`);
		process.exit(-1);
	}
}

export async function publishAllFeeds() {
	for (const feed of feeds) {
		await publishFeed(feed);
	}
}

export async function testFeed(feed: Feed) {
	const agent = new AtpAgent({ service: "https://bsky.social" });
	await agent.login({ identifier: process.env.PROGFEEDS_ACCOUNT!, password: process.env.PROGFEEDS_PASSWORD! });

	try {
		console.log(`Testing feed ${feed.name}`);
		const byPublished = await agent.app.bsky.feed.getFeedGenerator({
			feed: feed.uri ?? "",
		});
		console.log("Success:", byPublished);
	} catch (e) {
		console.log(`Error getting feed ${feed.name}:`, e);
	}
}

export function isPostRelevant(post: FirehosePost): string[] {
	const relevantFeeds = [];
	for (const feed of feeds) {
		if (feed.isPostRelevant(post)) relevantFeeds.push(feed.rkey);
	}
	return relevantFeeds;
}

feeds.push({
	rkey: "githubrepos",
	name: "GitHub Repos",
	description: "Skeets with URLs to GitHub repos, sorted chronologically.",
	isPostRelevant: (post) => {
		return post.text.includes("github.com");
	},
});
