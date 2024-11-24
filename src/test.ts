import { Jetstream } from "@skyware/jetstream"

const jetstream = new Jetstream()
jetstream.onCreate("app.bsky.feed.post", event => {
	console.log("New post:", (event.commit.record as any).text)
})
jetstream.start()
