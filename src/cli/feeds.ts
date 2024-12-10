import { AtpAgent } from "@atproto/api";
import chalk from "chalk";
import { getFeeds } from "../feeds";
import { ids } from "@atproto/api/dist/client/lexicons";

async function main() {
	const agent = new AtpAgent({ service: "https://bsky.social" });
	await agent.login({ identifier: process.env.PROGFEEDS_ACCOUNT!, password: process.env.PROGFEEDS_PASSWORD! });

	if (process.argv.length == 2) {
		const feeds = await getFeeds(agent);
		for (const feed of feeds) {
			console.log(chalk.green(`${feed.displayName}`));
			console.log(chalk.gray(`did: ${feed.did}`));
			console.log(chalk.gray(`rkey: ${feed.uri.split("/")[4]}`));
		}
	} else {
		const rkeys = process.argv.slice(2);
		for (const rkey of rkeys) {
			console.log(chalk.red(`Deleting rkey ${rkey}`));
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
	}
}

main();
