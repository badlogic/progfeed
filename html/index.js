const content = document.querySelector("#content")

function dom(html, target) {
	const parent = document.createElement("div")
	parent.innerHTML = html
	const elements = Array.from(parent.children)
	if (target) {
		target.innerHTML = ""
		target.append(...elements)
	}
	return elements
}

const map = (array, fn) => array.map(e => fn(e)).join("")

async function update() {
	const resp = await fetch("/api/stats")
	if (!resp.ok) {
		content.textContent = "Could not fetch statistics"
		return
	}
	const stats = await resp.json()

	dom(
		/*html*/ `<div class="flex flex-col gap-2 items-center">
            <span>${stats.numPosts} posts processed</span>
            <span>${stats.postsPerSecond.toFixed(0)} posts/second </span>
            <span>${stats.numEvents} events processed</span>
            <span>${stats.eventsPerSecond.toFixed(0)} events/second </span>
            <div class="flex flex-col" style="padding: 1em">
            <span><b>Feeds</b></span>
            ${map(
				stats.feedStats,
				feed =>
					/*html*/ `<span>${feed.feed}: ${feed.numPosts} posts, ${(feed.fileSize / 1024).toFixed(
						0,
					)} KB</span>`,
			)}
            </div>
        </div>`,
		content,
	)
}

setInterval(update, 1000)
update()
