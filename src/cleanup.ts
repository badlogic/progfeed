import { AtpAgent } from "@atproto/api";
import { Feed, feeds, publishAllFeeds, testFeed } from "./feeds";
import { ids } from "@atproto/api/dist/client/lexicons";

// Deletes any feeds that we no longer support, publishes all current feeds.
async function main() {
	const agent = new AtpAgent({ service: "https://bsky.social" });
	await agent.login({ identifier: process.env.PROGFEEDS_ACCOUNT!, password: process.env.PROGFEEDS_PASSWORD! });

	let response = await agent.com.atproto.repo.listRecords({
		repo: agent.session?.did ?? "",
		collection: ids.AppBskyFeedGenerator,
	});

	if (!response.success) {
		console.error("Could not fetch feeds for " + process.env.PROGFEEDS_ACCOUNT);
		process.exit(-1);
	}

	const feedsToDelete = [];
	for (const record of response.data.records) {
		const tokens = record.uri.split("/");
		const rkey = tokens[tokens.length - 1];
		console.log(rkey);

		let found = false;
		for (const feed of feeds) {
			if (feed.rkey == rkey) {
				found = true;
				break;
			}
		}
		if (!found) {
			feedsToDelete.push(rkey);
		}
	}

	console.log("Feeds to delete", feedsToDelete);
	for (const rkey of feedsToDelete) {
		const response = await agent.com.atproto.repo.deleteRecord({
			repo: agent.session?.did ?? "",
			collection: ids.AppBskyFeedGenerator,
			rkey,
		});
		if (!response.success) {
			console.error("Could not delete feed " + rkey);
			process.exit(-1);
		}
	}

	response = await agent.com.atproto.repo.listRecords({
		repo: agent.session?.did ?? "",
		collection: ids.AppBskyFeedGenerator,
	});
	console.log("Remaining feeds:", JSON.stringify(response.data, null, 2));

	/*await publishAllFeeds();
	for (const feed of feeds) {
		await testFeed(feed);
	}*/
}
main();
