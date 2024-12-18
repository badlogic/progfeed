import { AppBskyActorDefs, AtpAgent } from "@atproto/api";
import { blocksToCarFile } from "@atproto/repo";

interface Account {
	handle: string;
	displayName?: string;
	avatar?: string;
	created?: string;
	description?: string;
	postsCount: number;
	followsCount: number;
	followersCount: number;
	loggedIn?: {
		following: boolean;
		blocked: boolean;
		muted: boolean;

		followedBy: boolean;
		blockedBy: boolean;
		mutedBy: boolean;
	};
}

function mapViewerState(state?: AppBskyActorDefs.ViewerState): Account["loggedIn"] {
	if (!state) {
		return undefined;
	}

	return {
		following: !!state.following,
		blocked: !!state.blocking,
		muted: !!state.muted,
		followedBy: !!state.followedBy,
		blockedBy: !!state.blockedBy,
		mutedBy: !!state.mutedByList,
	};
}

type BlueskyScannerResults = {
	accounts: Account[];
	numNoDescription: number;
	numNoPosts: number;
	totalFollowers: number;
};

class BlueskyScanner {
	private progressCallback: (message: string) => void;
	private errorCallback: (message: string) => void;
	private resultsCallback: (results: BlueskyScannerResults) => void;

	constructor(
		progressCallback: (message: string) => void,
		errorCallback: (message: string) => void,
		resultsCallback: (results: any) => void
	) {
		this.progressCallback = progressCallback;
		this.errorCallback = errorCallback;
		this.resultsCallback = resultsCallback;
	}

	async scanAccount(handle: string, loginHandle?: string, loginPassword?: string) {
		try {
			let agent: AtpAgent;
			let loggedIn = false;
			if (!loginHandle || !loginPassword) {
				agent = new AtpAgent({ service: "https://public.api.bsky.app" });
			} else {
				agent = new AtpAgent({ service: "https://bsky.social" });
				const resp = await agent.login({ identifier: loginHandle, password: loginPassword });
				if (!resp.success) {
					this.errorCallback("Could not log in. Check your user name and password");
					return;
				}
			}

			handle = handle.replaceAll("@", "");
			const followers: AppBskyActorDefs.ProfileView[] = [];
			let cursor: string | undefined = undefined;

			const history = localStorage.getItem(handle);
			if (history && location.hostname.includes("localhost")) {
				this.progressCallback("Showing previos results for " + handle);
				this.resultsCallback(JSON.parse(history));
				return;
			}

			do {
				const resp = await agent.app.bsky.graph.getFollowers({
					actor: handle,
					cursor,
					limit: 100,
				});

				if (!resp.success) {
					throw new Error("Failed to fetch followers");
				}

				followers.push(...resp.data.followers);
				cursor = resp.data.cursor;
				this.progressCallback(`Fetched ${followers.length} followers...`);
			} while (cursor);

			let numNoDescription = 0;
			let numNoPosts = 0;
			const accounts: Account[] = [];

			const CHUNK_SIZE = 25;
			for (let i = 0; i < followers.length; i += CHUNK_SIZE) {
				const chunk = followers.slice(i, i + CHUNK_SIZE);
				const dids = chunk.map((f) => f.did);

				try {
					const profiles = await agent.app.bsky.actor.getProfiles({
						actors: dids,
					});

					for (let j = 0; j < chunk.length; j++) {
						const follower = chunk[j];
						const profile = profiles.data.profiles[j];

						if (!follower.description || follower.description.trim().length == 0) {
							numNoDescription++;
						}

						if (profile.postsCount === 0) {
							numNoPosts++;
						}

						accounts.push({
							handle: follower.handle,
							displayName: follower.displayName,
							avatar: follower.avatar,
							created: follower.createdAt,
							description: follower.description
								?.replace(/[\u2800\u2000-\u200F\u2028-\u202F\u205F-\u206F]/g, "")
								.trim(),
							postsCount: profile.postsCount ?? 0,
							followsCount: profile.followsCount ?? 0,
							followersCount: profile.followersCount ?? 0,
							loggedIn: mapViewerState(profile.viewer),
						});
					}

					await new Promise((resolve) => setTimeout(resolve, 100));

					this.progressCallback(
						`Analyzed ${Math.min(i + CHUNK_SIZE, followers.length)}/${followers.length} followers...`
					);
				} catch (error) {
					this.errorCallback(`Error fetching profiles batch ${i}-${i + CHUNK_SIZE}`);
					console.error(error);
				}
			}

			const result = {
				accounts,
				numNoDescription,
				numNoPosts,
				totalFollowers: followers.length,
			};
			if (location.hostname.includes("localhost")) localStorage.setItem(handle, JSON.stringify(result));
			this.resultsCallback(result);
		} catch (error) {
			this.errorCallback("Error scanning account: " + (error as Error).message);
			console.error(error);
		}
	}
}

const getTimeAgo = (dateString: string): string => {
	const date = new Date(dateString);
	const now = new Date();
	const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	const months = Math.floor(days / 30);
	const years = Math.floor(days / 365);

	if (years > 0) return `${years} ${years === 1 ? "year" : "years"} ago`;
	if (months > 0) return `${months} ${months === 1 ? "month" : "months"} ago`;
	if (days > 0) return `${days} ${days === 1 ? "day" : "days"} ago`;
	if (hours > 0) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
	if (minutes > 0) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
	return "just now";
};

const renderResults = (results: BlueskyScannerResults) => {
	const resultsDiv = document.getElementById("results") as HTMLDivElement;
	const { accounts, totalFollowers } = results;
	const ITEMS_PER_PAGE = 20;
	let currentPage = 0;
	let filteredResults: Account[] = [];
	const handle = document.querySelector<HTMLInputElement>("#handle")!.value.toLowerCase().trim();
	const loginHandle = document.querySelector<HTMLInputElement>("#loginHandle")!.value.toLowerCase().trim();
	const loggedIn = loginHandle.trim().length > 0;

	const renderAccount = (account: Account, required: string[], optional: string[]) => /*html*/ `
        <div class="flex flex-col gap-2 mb-2" style="border: 1px solid #ccc; border-radius: 0.5em; padding: 1em;">
            <div class="flex gap-2 items-center">
                ${
					account.avatar
						? `<img loading="lazy" style="width: 64px; height: 64px; border-radius: 100%;" src="${account.avatar}">`
						: `<span class="sus">No Pic</span>`
				}
				<div class="flex flex-col">
                	<a href="https://bsky.app/profile/${account.handle}">${account.displayName || account.handle}</a>
					${
						account.displayName
							? /*html*/ `<a href="https://bsky.app/profile/${account.handle}" class="text-sm" style="color: #777">${account.handle}</a>`
							: ""
					}
				</div>
            </div>
            <div class="text-sm">Created ${getTimeAgo(account.created ?? new Date().toISOString())}</div>
            ${
				account.description
					? `<div style="word-break: break-word; overflow-wrap: break-word;">${highlightTokens(
							account.description,
							required,
							optional
					  )}</div>`
					: `<div style="color: red;">No bio</div>`
			}
            <div class="flex items-center gap-2 text-sm">
                <span class="${account.followersCount == 0 ? "sus" : ""}">${account.followersCount} Followers</span>
                <span class="${account.followsCount == 0 ? "sus" : ""}">${account.followsCount} Follows</span>
                <span class="${account.postsCount == 0 ? "sus" : ""}">${account.postsCount} Posts</span>
            </div>
			${
				account.loggedIn
					? /*html*/ `<div class="flex gap-2">
				${account.loggedIn.following ? `<span class="following">Following</span>` : ""}
				${account.loggedIn.muted ? `<span class="blocked">Muted</span>` : ""}
				${account.loggedIn.blocked ? `<span class="blocked">Blocked</span>` : ""}

				${
					account.loggedIn && loginHandle != handle
						? `${account.loggedIn.followedBy ? `<span class="following">Follows you</span>` : ""}
				${account.loggedIn.mutedBy ? `<span class="blocked">Muted you</span>` : ""}
				${account.loggedIn.blockedBy ? `<span class="blocked">Blocked you</span>` : ""}`
						: ""
				}
			</div>`
					: ""
			}
        </div>
    `;

	const loadMoreAccounts = () => {
		const start = currentPage * ITEMS_PER_PAGE;
		const end = start + ITEMS_PER_PAGE;
		const newAccounts = filteredResults.slice(start, end);

		// Clean up existing observer if there is one
		cleanupLoadMoreObserver();

		const accountsList = document.getElementById("accountsList");
		if (accountsList) {
			const searchText = (document.getElementById("search-text") as HTMLInputElement).value;
			const searchTokens = parseSearchTokens(searchText);
			newAccounts.forEach((account) => {
				const div = document.createElement("div");
				div.innerHTML = renderAccount(account, searchTokens.required, searchTokens.optional);
				accountsList.appendChild(div.childNodes[1]);
			});
		}

		// Update or remove the Load More button
		const loadMoreWrapper = document.getElementById("loadMoreWrapper");
		if (loadMoreWrapper) {
			if (filteredResults.length > end) {
				loadMoreWrapper.innerHTML = `
				<div id="loadMore" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
					Loading more... (${filteredResults.length - end} remaining)
				</div>`;
				setupLoadMoreObserver();
			} else {
				loadMoreWrapper.innerHTML = "";
			}
		}
	};

	let currentObserver: IntersectionObserver | null = null;

	const cleanupLoadMoreObserver = () => {
		if (currentObserver) {
			currentObserver.disconnect();
			currentObserver = null;
		}
	};

	const setupLoadMoreObserver = () => {
		const loadMore = document.getElementById("loadMore");
		if (loadMore) {
			// Clean up any existing observer first
			cleanupLoadMoreObserver();

			currentObserver = new IntersectionObserver(
				(entries) => {
					const entry = entries[0];
					if (entry.isIntersecting) {
						currentPage++;
						loadMoreAccounts();
					}
				},
				{
					rootMargin: "200px",
				}
			);

			currentObserver.observe(loadMore);
		}
	};

	const parseSearchTokens = (searchText: string) => {
		const tokens = searchText
			.trim()
			.split(/\s+/)
			.filter((t) => t);
		const required = tokens.filter((t) => t.startsWith("+")).map((t) => t.slice(1).toLowerCase());
		const excluded = tokens.filter((t) => t.startsWith("-")).map((t) => t.slice(1).toLowerCase());
		const optional = tokens.filter((t) => !t.startsWith("+") && !t.startsWith("-")).map((t) => t.toLowerCase());
		return { required, excluded, optional };
	};

	const highlightTokens = (text: string, required: string[], optional: string[]) => {
		if (!text || !required || !optional) return text;

		// Create a regex pattern that matches partial words
		const createPattern = (tokens: string[]) => {
			if (tokens.length === 0) return null;
			// Escape special regex characters and join with |
			const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
			return new RegExp(`(${escaped.join("|")})`, "gi");
		};

		const requiredPattern = createPattern(required);
		const optionalPattern = createPattern(optional);

		let result = text;

		// Highlight required tokens in green
		if (requiredPattern) {
			result = result.replace(
				requiredPattern,
				'<span style="background-color: #90EE90; padding: 0 2px; border-radius: 2px;">$1</span>'
			);
		}

		// Highlight optional tokens in yellow
		if (optionalPattern) {
			result = result.replace(
				optionalPattern,
				'<span style="background-color: #FFE4B5; padding: 0 2px; border-radius: 2px;">$1</span>'
			);
		}

		return result;
	};

	const BLUESKY_LAUNCH_DATE = "2023-02-17"; // Bluesky's public launch date

	resultsDiv.innerHTML = /*html*/ `
        <div class="text-bold flex gap-2 items-center mb-2" style="font-size: 1.25em">
			<span>${totalFollowers} Followers analyzed</span>
			<span id="download" class="json">JSON</span>
		</div>

        <div class="filters flex flex-col gap-2" style="border: 1px solid #ccc; border-radius: 8px; padding: 1em;">
            <div style="font-weight: 700; font-size: 1.25em;">Filters</div>

            <!-- Search box -->
            <div class="flex flex-col gap-2">
                <span class="text-bold">Search handles & bios</span>
                <input type="text" id="search-text" placeholder="e.g. developer +engineer -recruiter" class="filter-input">
                <div class="text-sm text-gray-600">
                    +word: must contain word, -word: must not contain word
                </div>
            </div>

            <!-- Bio filter row -->
            <div class="flex gap-4 items-center">
                <label class="flex gap-2 items-center">
                    <input type="checkbox" id="with-bio" checked>
                    <span>With Bio</span>
                </label>
                <label class="flex gap-2 items-center">
                    <input type="checkbox" id="without-bio" checked>
                    <span>Without Bio</span>
                </label>
            </div>

			${
				loggedIn
					? /*html*/ `<!-- Following filter -->
			<div class="flex gap-4 items-center">
                <label class="flex gap-2 items-center">
                    <input type="checkbox" id="with-following" checked>
                    <span>Followed by you</span>
                </label>
                <label class="flex gap-2 items-center">
                    <input type="checkbox" id="without-following" checked>
                    <span>Not followed by you</span>
                </label>
            </div>`
					: ""
			}

            <!-- Posts range row -->
            <div class="flex gap-2 items-center">
				<span class="text-bold" style="min-width: 75px;">Posts</span>
                <input class="filter-input" type="number" id="min-posts" min="0" value="0" placeholder="Min posts">
                <span>to</span>
                <input class="filter-input" type="number" id="max-posts" min="0" value="${10000000}" placeholder="Max posts">
            </div>

            <!-- Follows range row -->
            <div class="flex gap-2 items-center">
				<span class="text-bold" style="min-width: 75px;">Follows</span>
                <input class="filter-input" type="number" id="min-follows" min="0" value="0" placeholder="Min follows">
                <span>to</span>
                <input class="filter-input" type="number" id="max-follows" min="0" value="${10000000}" placeholder="Max follows">
            </div>

            <!-- Followers range row -->
            <div class="flex gap-2 items-center">
				<span class="text-bold" style="min-width: 75px;">Followers</span>
                <input class="filter-input" type="number" id="min-followers" min="0" value="0" placeholder="Min followers">
                <span>to</span>
                <input class="filter-input" type="number" id="max-followers" min="0" value="${10000000}" placeholder="Max followers">
            </div>

            <!-- Created date row -->
            <div class="flex gap-4 items-center">
				<span class="text-bold">Profile created after:</span>
                <input type="date" class="filter-input" id="created-after" value="${BLUESKY_LAUNCH_DATE}">
            </div>

			<button id="reset-filters">Reset</button>
        </div>

        <!-- Sorting row -->
        <div class="flex gap-2 items-center" style="margin-top: 1em; border: 1px solid #ccc; border-radius: 8px; padding: 1em;">
            <span class="text-bold">Sort by</span>
            <select id="sort-feature">
				<option value="followedAt">Follow Date</option>
                <option value="created">Profile created Date</option>
                <option value="posts">Posts</option>
                <option value="follows">Follows</option>
                <option value="followers">Followers</option>
            </select>
            <select id="sort-direction">
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
            </select>
        </div>

        <div class="flex flex-col gap-4" style="margin: 2em 0">
			<div class="text-bold flex gap-2 items-center">
				<div class="text-bold" id="numFilteredAccounts"></div>
				<span id="download-filtered" class="json">JSON</span>
			</div>

            <div id="accountsList"></div>
            <div id="loadMoreWrapper"></div>
        </div>

    `;

	const filterAndSortAccounts = () => {
		cleanupLoadMoreObserver();
		currentPage = 0; // Reset to first page when filters change
		const withBio = (document.getElementById("with-bio") as HTMLInputElement).checked;
		const withoutBio = (document.getElementById("without-bio") as HTMLInputElement).checked;
		const searchText = (document.getElementById("search-text") as HTMLInputElement).value;
		const searchTokens = parseSearchTokens(searchText);

		const minPosts = parseInt((document.getElementById("min-posts") as HTMLInputElement).value) || 0;
		const maxPosts =
			parseInt((document.getElementById("max-posts") as HTMLInputElement).value) || Number.MAX_SAFE_INTEGER;
		const minFollows = parseInt((document.getElementById("min-follows") as HTMLInputElement).value) || 0;
		const maxFollows =
			parseInt((document.getElementById("max-follows") as HTMLInputElement).value) || Number.MAX_SAFE_INTEGER;
		const minFollowers = parseInt((document.getElementById("min-followers") as HTMLInputElement).value) || 0;
		const maxFollowers =
			parseInt((document.getElementById("max-followers") as HTMLInputElement).value) || Number.MAX_SAFE_INTEGER;
		const createdAfter = (document.getElementById("created-after") as HTMLInputElement).value;
		const sortFeature = (document.getElementById("sort-feature") as HTMLSelectElement).value;
		const sortDirection = (document.getElementById("sort-direction") as HTMLSelectElement).value;

		let withFollowing = false;
		let withoutFollowing = false;
		if (loggedIn) {
			withFollowing = (document.getElementById("with-following") as HTMLInputElement).checked;
			withoutFollowing = (document.getElementById("without-following") as HTMLInputElement).checked;
		}

		// Filter accounts
		filteredResults = accounts.filter((account) => {
			// Bio filter logic: account must match at least one selected option
			const bioMatches = account.description ? withBio : withoutBio;
			if (!bioMatches) return false;

			// Followed by you filter: account must match at least one selected option
			if (account.loggedIn) {
				const followingMatches = account.loggedIn.following ? withFollowing : withoutFollowing;
				if (!followingMatches) return false;
			}

			// Search text filter
			if (searchText) {
				const searchableText = `${account.handle} ${account.displayName ?? ""} ${
					account.description || ""
				}`.toLowerCase();

				// Check excluded terms
				if (searchTokens.excluded.some((term) => searchableText.includes(term))) {
					return false;
				}

				// Check required terms
				if (!searchTokens.required.every((term) => searchableText.includes(term))) {
					return false;
				}

				// Check optional terms - if any exist, at least one must match
				if (
					searchTokens.optional.length > 0 &&
					!searchTokens.optional.some((term) => searchableText.includes(term))
				) {
					return false;
				}
			}

			const matchesPosts = account.postsCount >= minPosts && account.postsCount <= maxPosts;
			const matchesFollows = account.followsCount >= minFollows && account.followsCount <= maxFollows;
			const matchesFollowers = account.followersCount >= minFollowers && account.followersCount <= maxFollowers;

			let matchesCreated = true;
			if (account.created && createdAfter) {
				matchesCreated = new Date(account.created) >= new Date(createdAfter);
			}

			return matchesPosts && matchesFollows && matchesFollowers && matchesCreated;
		});

		// Sort accounts
		filteredResults.sort((a, b) => {
			let comparison = 0;
			switch (sortFeature) {
				case "followedAt":
					// Nothing to do here.
					break;
				case "created":
					comparison = new Date(a.created || 0).getTime() - new Date(b.created || 0).getTime();
					break;
				case "posts":
					comparison = a.postsCount - b.postsCount;
					break;
				case "follows":
					comparison = a.followsCount - b.followsCount;
					break;
				case "followers":
					comparison = a.followersCount - b.followersCount;
					break;
			}
			return sortDirection === "desc" ? -comparison : comparison;
		});
		if (sortFeature == "followedAt" && sortDirection !== "desc") {
			filteredResults.reverse();
		}

		// Clear existing accounts and load first page
		const accountsList = document.getElementById("accountsList");
		if (accountsList) {
			accountsList.innerHTML = "";
			document.querySelector("#numFilteredAccounts")!.textContent =
				"Matched " + filteredResults.length + " of " + results.accounts.length + " accounts";
			loadMoreAccounts();
		}
	};

	const filterInputs = [
		"search-text",
		"with-bio",
		"without-bio",
		"with-following",
		"without-following",
		"min-posts",
		"max-posts",
		"min-follows",
		"max-follows",
		"min-followers",
		"max-followers",
		"created-after",
		"sort-feature",
		"sort-direction",
	];

	filterInputs.forEach((id) => {
		const element = document.getElementById(id);
		if (element) {
			element.addEventListener("input", filterAndSortAccounts);
		}
	});

	// Reset filters
	const resetButton = document.querySelector<HTMLButtonElement>("#reset-filters")!;
	resetButton.addEventListener("click", () => {
		(document.getElementById("with-bio") as HTMLInputElement).checked = true;
		(document.getElementById("without-bio") as HTMLInputElement).checked = true;
		(document.getElementById("with-following") as HTMLInputElement).checked = true;
		(document.getElementById("without-following") as HTMLInputElement).checked = true;
		(document.getElementById("search-text") as HTMLInputElement).value = "";
		(document.getElementById("min-posts") as HTMLInputElement).value = "0";
		(document.getElementById("max-posts") as HTMLInputElement).value = "10000000";
		(document.getElementById("min-follows") as HTMLInputElement).value = "0";
		(document.getElementById("max-follows") as HTMLInputElement).value = "10000000";
		(document.getElementById("min-followers") as HTMLInputElement).value = "0";
		(document.getElementById("max-followers") as HTMLInputElement).value = "10000000";
		(document.getElementById("created-after") as HTMLInputElement).value = BLUESKY_LAUNCH_DATE;
		(document.getElementById("sort-feature") as HTMLSelectElement).value = "followedAt";
		(document.getElementById("sort-direction") as HTMLSelectElement).value = "desc";
		filterAndSortAccounts();
	});

	// Download all followers
	const downloadButton = document.querySelector<HTMLButtonElement>("#download")!;
	downloadButton.addEventListener("click", () => {
		const handle = (document.getElementById("handle") as HTMLInputElement).value
			.trim()
			.toLowerCase()
			.replace("@", "");
		downloadFile(results.accounts, `${handle}.json`);
	});

	// Download filtered followers
	const downloadFilteredButton = document.querySelector<HTMLButtonElement>("#download-filtered")!;
	downloadFilteredButton.addEventListener("click", () => {
		const handle = (document.getElementById("handle") as HTMLInputElement).value
			.trim()
			.toLowerCase()
			.replace("@", "");
		downloadFile(filteredResults, `${handle}-filtered.json`);
	});

	// Initial render
	filterAndSortAccounts();
};

function downloadFile(data: any, filename: string, type?: string): void {
	let content: string;
	let mimeType: string;

	if (typeof data === "object") {
		content = JSON.stringify(data, null, 2);
		mimeType = type || "application/json";
	} else {
		content = String(data);
		mimeType = type || "text/plain";
	}

	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);

	const downloadLink = document.createElement("a");
	downloadLink.href = url;
	downloadLink.download = filename;

	document.body.appendChild(downloadLink);
	downloadLink.click();
	document.body.removeChild(downloadLink);

	URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", () => {
	const handleInput = document.getElementById("handle") as HTMLInputElement;
	const scanButton = document.getElementById("scanButton") as HTMLButtonElement;
	const progressDiv = document.getElementById("progress") as HTMLDivElement;
	const infoDiv = document.getElementById("info") as HTMLDivElement;
	const errorDiv = document.getElementById("error") as HTMLDivElement;
	const resultsDiv = document.getElementById("results") as HTMLDivElement;

	const scanner = new BlueskyScanner(
		(message: string) => {
			progressDiv.textContent = message;
		},
		(message: string) => {
			progressDiv.classList.add("hidden");
			infoDiv.classList.add("hidden");
			errorDiv.classList.remove("hidden");
			errorDiv.textContent = message;
		},
		(results) => {
			progressDiv.classList.add("hidden");
			infoDiv.classList.add("hidden");
			renderResults(results);
		}
	);

	scanButton.addEventListener("click", async () => {
		const handle = handleInput.value.trim().toLowerCase();
		if (!handle) {
			errorDiv.textContent = "Please enter a handle";
			return;
		}

		errorDiv.textContent = "";
		errorDiv.classList.add("hidden");
		progressDiv.textContent = "Starting scan...";
		progressDiv.classList.remove("hidden");
		infoDiv.classList.remove("hidden");
		infoDiv.textContent = "Scanning can take a long time. Do not switch away from the tab on mobile.";
		resultsDiv.innerHTML = "";

		scanButton.disabled = true;

		try {
			const loginHandle = document.querySelector<HTMLInputElement>("#loginHandle")!.value;
			const loginPassword = document.querySelector<HTMLInputElement>("#loginPassword")!.value;
			await scanner.scanAccount(handle, loginHandle, loginPassword);
		} finally {
			scanButton.disabled = false;
			progressDiv.textContent = "Scan complete";
		}
	});

	if (location.hostname.includes("localhost")) {
		// scanButton.click()
	}
});
