import { AppBskyActorDefs, AtpAgent } from "@atproto/api"

interface SuspiciousAccount {
	handle: string
	avatar?: string
	created?: string
	description?: string
	postsCount: number
	followsCount: number
	followersCount: number
}

type BlueskyScannerResults = {
	suspiciousAccounts: SuspiciousAccount[]
	numNoDescription: number
	numNoPosts: number
	totalFollowers: number
}

class BlueskyScanner {
	private agent: AtpAgent
	private progressCallback: (message: string) => void
	private errorCallback: (message: string) => void
	private resultsCallback: (results: BlueskyScannerResults) => void

	constructor(
		progressCallback: (message: string) => void,
		errorCallback: (message: string) => void,
		resultsCallback: (results: any) => void,
	) {
		this.agent = new AtpAgent({ service: "https://public.api.bsky.app" })
		this.progressCallback = progressCallback
		this.errorCallback = errorCallback
		this.resultsCallback = resultsCallback
	}

	async scanAccount(handle: string) {
		try {
			handle = handle.replaceAll("@", "")
			const followers: AppBskyActorDefs.ProfileView[] = []
			let cursor: string | undefined = undefined

			const history = localStorage.getItem(handle)
			if (history && location.hostname.includes("localhost")) {
				this.progressCallback("Showing previos results for " + handle)
				this.resultsCallback(JSON.parse(history))
				return
			}

			do {
				const resp = await this.agent.app.bsky.graph.getFollowers({
					actor: handle,
					cursor,
					limit: 100,
				})

				if (!resp.success) {
					throw new Error("Failed to fetch followers")
				}

				followers.push(...resp.data.followers)
				cursor = resp.data.cursor
				this.progressCallback(`Fetched ${followers.length} followers...`)
			} while (cursor)

			let numNoDescription = 0
			let numNoPosts = 0
			const suspiciousAccounts: SuspiciousAccount[] = []

			const CHUNK_SIZE = 25
			for (let i = 0; i < followers.length; i += CHUNK_SIZE) {
				const chunk = followers.slice(i, i + CHUNK_SIZE)
				const dids = chunk.map((f) => f.did)

				try {
					const profiles = await this.agent.app.bsky.actor.getProfiles({
						actors: dids,
					})

					for (let j = 0; j < chunk.length; j++) {
						const follower = chunk[j]
						const profile = profiles.data.profiles[j]
						let sus = false

						if (!follower.description || follower.description.trim().length == 0) {
							sus = true
							numNoDescription++
						}

						if (profile.postsCount === 0) {
							sus = true
							numNoPosts++
						}

						if (sus) {
							suspiciousAccounts.push({
								handle: follower.handle,
								avatar: follower.avatar,
								created: follower.createdAt,
								description: follower.description?.trim(),
								postsCount: profile.postsCount ?? 0,
								followsCount: profile.followsCount ?? 0,
								followersCount: profile.followersCount ?? 0,
							})
						}
					}

					await new Promise((resolve) => setTimeout(resolve, 100))

					this.progressCallback(
						`Analyzed ${Math.min(i + CHUNK_SIZE, followers.length)}/${followers.length} followers...`,
					)
				} catch (error) {
					this.errorCallback(`Error fetching profiles batch ${i}-${i + CHUNK_SIZE}`)
					console.error(error)
				}
			}

			const result = {
				suspiciousAccounts,
				numNoDescription,
				numNoPosts,
				totalFollowers: followers.length,
			}
			if (location.hostname.includes("localhost")) localStorage.setItem(handle, JSON.stringify(result))
			this.resultsCallback(result)
		} catch (error) {
			this.errorCallback("Error scanning account: " + (error as Error).message)
			console.error(error)
		}
	}
}

const renderResults = (results: BlueskyScannerResults) => {
	const resultsDiv = document.getElementById("results") as HTMLDivElement
	const { suspiciousAccounts, numNoDescription, numNoPosts, totalFollowers } = results

	const renderSelection = (accounts: SuspiciousAccount[]) => {
		return /*html*/ `<div class="flex flex-col gap-4" style="margin: 2em 0em">
            ${suspiciousAccounts
				.map(
					(account: any) => /*html*/ `
                <div class="flex flex-col gap-2" style="border: 1px solid #ccc; border-radius: 0.5em; padding: 1em;">
                    <div class="flex gap-2 items-center">
						${
							account.avatar
								? /*html*/ `<img style="width: 64px; height: 64px; border-radius: 100%;" src="${account.avatar}">`
								: /*html*/ `<span class="sus">No Pic</span>`
						}
                        <a href="https://${account.handle}" target="_blank">${account.handle}</a>
                    </div>
                    ${
						account.description
							? /*html*/ `<div>${account.description}</div>`
							: /*html*/ `<div style="color: red;">No bio</div>`
					}
                    <div class="flex items-center gap-2 text-sm">
						<span class="${account.followersCount == 0 ? "sus" : ""}">${account.followersCount} Followers</span>
						<span class="${account.followsCount == 0 ? "sus" : ""}">${account.followsCount} Follows</span>
						<span class="${account.postsCount == 0 ? "sus" : ""}">${account.postsCount} Posts</span>
					</div>
                </div>
            `,
				)
				.join("")}
            </div>`
	}

	resultsDiv.innerHTML = /*html*/ `
            <h2>Scan Results</h2>
            <p>Total followers analyzed: ${totalFollowers}</p>
            <p>Accounts with no description: ${numNoDescription}</p>
            <p>Accounts with no posts: ${numNoPosts}</p>
            <h3>Suspicious Accounts</h3>
            <div class="flex items-center gap-4">
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="no-bio" checked>
                    <span>No Bio</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="no-posts" checked>
                    <span>No Posts</span>
                </label>
            </div>

			<div id="fileredAccounts">
            	${renderSelection(suspiciousAccounts)}
			</div>
        `
}

document.addEventListener("DOMContentLoaded", () => {
	const handleInput = document.getElementById("handle") as HTMLInputElement
	const scanButton = document.getElementById("scanButton") as HTMLButtonElement
	const progressDiv = document.getElementById("progress") as HTMLDivElement
	const errorDiv = document.getElementById("error") as HTMLDivElement
	const resultsDiv = document.getElementById("results") as HTMLDivElement

	const scanner = new BlueskyScanner(
		(message: string) => {
			progressDiv.textContent = message
		},
		(message: string) => {
			errorDiv.textContent = message
		},
		renderResults,
	)

	scanButton.addEventListener("click", async () => {
		const handle = handleInput.value.trim().toLowerCase()
		if (!handle) {
			errorDiv.textContent = "Please enter a handle"
			return
		}

		errorDiv.textContent = ""
		resultsDiv.innerHTML = ""
		progressDiv.textContent = "Starting scan..."

		scanButton.disabled = true

		try {
			await scanner.scanAccount(handle)
		} finally {
			scanButton.disabled = false
			progressDiv.textContent = "Scan complete"
		}
	})

	if (location.hostname.includes("localhost")) scanButton.click()
})
