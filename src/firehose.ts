import { Jetstream } from "@skyware/jetstream"
import WebSocket from "ws"

export type FirehosePost = {
	author: string
	text: string
	createdAt: string
	uri: string
	cid: string
	isReply: boolean
}

export class Firehose {
	numEvents = 0

	async run(onPost: (post: FirehosePost) => void, topLevelOnly: boolean = true) {
		const jetstream = new Jetstream({ ws: WebSocket })
		jetstream.onCreate("app.bsky.feed.post", event => {
			const record = event.commit.record as any
			if (record.text) {
				if ((topLevelOnly && !record.reply) || !topLevelOnly) {
					onPost({
						author: event.did,
						text: record.text,
						createdAt: record.createdAt,
						uri: `at://${event.did}/"app.bsky.feed.post"/${event.commit.rkey}`,
						cid: event.commit.cid,
						isReply: record.reply != undefined,
					})
				}
			}
			this.numEvents++
		})
		jetstream.start()
	}
}
