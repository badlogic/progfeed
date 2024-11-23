import { Subscription } from "@atproto/xrpc-server";
import { cborToLexRecord, readCar } from "@atproto/repo";

export type FirehosePost = {
	author: string;
	text: string;
	createdAt: string;
	uri: string;
	cid: string;
	isReply: boolean;
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

interface CborPost {
	$type: string;
	text: string;
	reply?: {
		parent: { uri: string; cid: string };
		root: { uri: string; cid: string };
	};
	createdAt: string;
}

export class FirehoseSubscription {
	public sub: Subscription<RepoEvent>;

	constructor(service: string) {
		this.sub = new Subscription({
			service: service,
			method: "com.atproto.sync.subscribeRepos",
			getParams: () => ({}),
			validate: (value: unknown) => value as RepoEvent,
		});
	}

	async run(
		onPost: (post: FirehosePost) => void,
		topLevelOnly: boolean = true,
		subscriptionReconnectDelay: number = 5000,
	) {
		try {
			for await (const evt of this.sub) {
				if (!this.isCommit(evt)) continue;

				try {
					const car = await readCar(evt.blocks);
					for (const op of evt.ops) {
						if (op.action === "create" && op.path.startsWith("app.bsky.feed.post")) {
							const recordBytes = car.blocks.get(op.cid);
							if (!recordBytes) continue;
							const record = cborToLexRecord(recordBytes) as unknown as CborPost;
							if (record.text) {
								if ((topLevelOnly && !record.reply) || !topLevelOnly) {
									onPost({
										author: evt.repo,
										text: record.text,
										createdAt: record.createdAt,
										uri: `at://${evt.repo}/${op.path}`,
										cid: op.cid.toString(),
										isReply: record.reply != undefined,
									});
								}
							}
						}
					}
				} catch (err) {
					console.error("Error processing event:", err);
				}
			}
		} catch (err) {
			console.error("Firehose subscription error:", err);
			setTimeout(() => this.run(onPost, topLevelOnly, subscriptionReconnectDelay), subscriptionReconnectDelay);
		}
	}

	private isCommit(evt: RepoEvent): boolean {
		return evt.$type === "com.atproto.sync.subscribeRepos#commit";
	}
}
