/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { decode } from "he";

const LIVEBLOG_RE = />Liveblog<\/div.*?href="([^"]*)"/g;
const LD_JSON_RE = /ld[+]json">({.*?})<\/script>/g;
const BLOG_API_RE = /https:\/\/liveblog[.]zdf[.]de\/api\/channels\/[a-zA-Z\d]+\/blogitems\//;

const username = "ZDF Liveblog";
const avatarUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/ZDF_logo.svg/960px-ZDF_logo.svg.png";

export default {
	async scheduled(schedule, env, ctx) {
		env.zdf_liveblog.batch([
			env.zdf_liveblog.prepare("CREATE TABLE IF NOT EXISTS live_blogs (url TEXT PRIMARY KEY, blog_url TEXT NOT NULL, thread_id TEXT)"),
			env.zdf_liveblog.prepare("CREATE TABLE IF NOT EXISTS live_updates (guid TEXT PRIMARY KEY)"),
		]);

		const res = await fetch("https://www.zdfheute.de/politik/ausland");
		const html = await res.text();
		const liveBlogUrls = Array.from(html.matchAll(LIVEBLOG_RE)).map((x) => new URL(x[1], "https://www.zdfheute.de").toString());

		for (const liveBlogUrl of liveBlogUrls) {
			console.log("fetching", liveBlogUrl);
			let data = await env.zdf_liveblog.prepare("SELECT * FROM live_blogs WHERE url = ?").bind(liveBlogUrl).first<{
				blog_url: string;
				thread_id: string;
			}>();

			let blogUrl: string | undefined, threadId: string | undefined;
			if (data) {
				blogUrl = data.blog_url;
				threadId = data.thread_id;
			}

			if (!blogUrl || !threadId) {
				const res = await fetch(liveBlogUrl);
				const html = await res.text();

				const ldAll = Array.from(html.matchAll(LD_JSON_RE)).map((x) => JSON.parse(x[1]));

				console.log(ldAll);
				const ld = ldAll.find((x) => x["@type"] === "LiveBlogPosting");

				const title: string = ld["headline"];
				const description: string = ld["description"];
				blogUrl = html.match(BLOG_API_RE)![0];

				// Need to create a new thread for this blog
				const thread = await fetch(env.DISCORD_WEBHOOK_URL + "?wait=true&with_components=true", {
					body: JSON.stringify({
						username,
						avatar_url: avatarUrl,
						thread_name: title,
						components: [
							{
								type: 10,
								content: `# ${title}`,
							},
							{
								type: 10,
								content: description,
							},
							{
								type: 1,
								components: [
									{
										type: 2,
										style: 5,
										label: "Zum Liveblog auf ZDF",
										url: liveBlogUrl,
									},
								],
							},
						],
						flags: 1 << 15, // components v2
					}),
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
				});
				const message = await thread.json<any>();
				console.log("created thread", message);
				threadId = message.channel_id;

				await env.zdf_liveblog
					.prepare(`INSERT INTO live_blogs (url, blog_url, thread_id) VALUES (?, ?, ?)`)
					.bind(liveBlogUrl, blogUrl, threadId)
					.run();
			}

			const response = await fetch(blogUrl + "?limit=10");
			const blogData = await response.json<Data>();
			console.log("data", data);

			const receivedGuids = blogData.results.map((update) => update.guid);
			const existingGuids = await env.zdf_liveblog
				.prepare(`SELECT guid FROM live_updates WHERE guid IN (${receivedGuids.map(() => "?").join(",")})`)
				.bind(...receivedGuids)
				.all<{
					guid: string;
				}>();

			for (const update of blogData.results.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())) {
				if (existingGuids.results.some((g) => g.guid === update.guid)) {
					continue;
				}

				console.log(`New update: ${update.title} (${update.guid})`);

				// Post the update to the thread
				const body = {
					username,
					avatar_url: avatarUrl,
					flags: 1 << 15, // components v2
					components: [
						{
							type: 10,
							content: `# [${update.title}](${new URL(update.sharing_url, "https://liveblog.zdf.de").toString()})`,
						},
						{
							type: 10,
							content: [
								`-# <t:${Math.floor(new Date(update.start).getTime() / 1000)}:R>`,
								update.is_top_blogitem && "**`[Wichtige Meldung]`**",
								update.video_metadata && "`[Video]`",
								update.url && "`[Artikel]`",
							]
								.filter(Boolean)
								.join(" "),
						},
						{
							type: 10,
							content: decode(update.text)
								.replaceAll("<p>", "")
								.replaceAll("</p>", "\n")
								.replaceAll("<br>", "\n")
								.replace(/<em>([^<]+)<\/em>/g, "_$1_")
								.replace(/<\/?[ul]>/g, "")
								.replaceAll("<li>", "* ")
								.replaceAll("</li>", "")
								.replace(/<a href="([^"]+)"(?: target="_blank")?(?: rel="noopener")?>([^<]+)<\/a>/g, "[$2]($1)")
								.trim()
								.slice(0, 2000),
						},
						...(update.image
							? [
									{
										type: 12,
										items: [
											{
												media: {
													url: new URL(update.image.url, "https://liveblog.zdf.de").toString(),
													description:
														[update.image_alt_text || update.image_description, update.image_source].filter(Boolean).join(" - ") ||
														undefined,
												},
											},
										],
									},
								]
							: []),
						...(update.slides
							? [
									{
										type: 12,
										items: update.slides.map((slide) => ({
											media: {
												url: slide.image.url,
												description: [slide.alt_text || slide.description, slide.source].filter(Boolean).join(" - ") || undefined,
											},
										})),
									},
								]
							: []),
						...(update.url
							? [
									{
										type: 1,
										components: [
											{
												type: 2,
												style: 5,
												label: "Kompletter Beitrag",
												url: update.url,
											},
										],
									},
								]
							: []),
					],
				};
				const res = await fetch(env.DISCORD_WEBHOOK_URL + `?thread_id=${threadId}&wait=true&with_components=true`, {
					method: "POST",
					body: JSON.stringify(body),
					headers: {
						"Content-Type": "application/json",
					},
				});
				const resbody = await res.json();
				if (res.status > 299) {
					console.error("Failed to post update to Discord", res.status, resbody);
				}

				// Insert the update into the database
				await env.zdf_liveblog.prepare(`INSERT INTO live_updates (guid) VALUES (?)`).bind(update.guid).run();
			}
		}
	},
} satisfies ExportedHandler<Env>;

interface Data {
	results: Array<LiveUpdate>;
}

interface LiveUpdate {
	guid: string;
	title: string;
	is_top_blogitem: boolean; // "Wichtige Meldung"
	start: string; // ISO date string
	sharing_url: string; // the canonical URL to the update
	text: string; // has HTML encoded special characters, e.g. &quot; for " (does JSON.parse() decode these automatically?)
	image?: {
		url: string;
	};
	video_metadata?: {};
	slides?: Array<{
		description: string;
		alt_text: string;
		source: string;
		image: {
			url: string;
		};
	}>;
	url?: string;
	// these are only available for real images, "image" is reused for a video thumbnail
	image_description?: string;
	image_alt_text?: string;
	image_source?: string;
	// there's also videos, but they're HLS only and we can't embed those in Discord
}
