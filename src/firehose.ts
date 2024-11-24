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
		const run = (cursor?: number) => {
			const jetstream = new Jetstream({ ws: WebSocket, cursor })
			jetstream.onCreate("app.bsky.feed.post", event => {
				const record = event.commit.record as any
				if (record.text) {
					if ((topLevelOnly && !record.reply) || !topLevelOnly) {
						onPost({
							author: event.did,
							text: record.text,
							createdAt: record.createdAt,
							uri: `at://${event.did}/app.bsky.feed.post/${event.commit.rkey}`,
							cid: event.commit.cid,
							isReply: record.reply != undefined,
						})
					}
				}
				this.numEvents++
			})
			jetstream.on("error", (error: Error, cursor) => {
				console.error("Firehose interrupted, retrying in 10 seconds", error)
				jetstream.close()
				setTimeout(() => {
					console.log("Retrying to connect to firehose")
					run()
				}, 10000)
			})
			console.log("Starting Jetstream")
			jetstream.start()
		}
		run()
	}
}
