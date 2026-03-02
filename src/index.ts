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

// https:\/\/liveblog[.]zdf[.]de\/api\/channels\/[a-zA-Z\d]+\/blogitems\/
const liveBlogs = [
	{
		name: "Israel und USA greifen Iran an: Alle Nachrichten im Liveblog",
		id: "dyHbPYWpjcfs3nkA2K5TQm",
		blog: "https://liveblog.zdf.de/api/channels/dyHbPYWpjcfs3nkA2K5TQm/blogitems/",
		url: "https://www.zdfheute.de/politik/ausland/iran-israel-usa-angriff-liveblog-100.html",
	},
	{
		name: "Aktuelles zum Krieg in der Ukraine",
		id: "3gAe4KkgHuZ7g9EkU97bcQ",
		blog: "https://liveblog.zdf.de/api/channels/3gAe4KkgHuZ7g9EkU97bcQ/blogitems/",
		url: "https://www.zdfheute.de/politik/ausland/ukraine-russland-konflikt-blog-102.html",
	},
];

export default {
	async scheduled(schedule, env, ctx) {
		env.zdf_liveblog.batch([
			env.zdf_liveblog.prepare("CREATE TABLE IF NOT EXISTS live_blogs (id TEXT PRIMARY KEY, thread_id TEXT)"),
			env.zdf_liveblog.prepare("CREATE TABLE IF NOT EXISTS live_updates (blog_id TEXT, guid TEXT, PRIMARY KEY(blog_id, guid))"),
		]);

		for (const liveBlog of liveBlogs) {
			const response = await fetch(liveBlog.blog + "?limit=10");
			const data = await response.json<Data>();
			console.log("data", data);

			// Check if the blog is already in the database, if not, insert it and create a new thread
			// If it is, get the thread ID for the blog
			let threadId = await env.zdf_liveblog
				.prepare(`SELECT thread_id FROM live_blogs WHERE id = ?`)
				.bind(liveBlog.id)
				.first<string>("thread_id");
			if (!threadId) {
				// Need to create a new thread for this blog
				const thread = await fetch(env.DISCORD_WEBHOOK_URL + "?wait=true&with_components=true", {
					body: JSON.stringify({
						username: "ZDF Liveblog",
						thread_name: liveBlog.name,
						components: [
							{
								type: 10,
								content: `# ${liveBlog.name}`,
							},
							{
								type: 10,
								content: `Hier werden die neuesten Updates zum Liveblog gepostet`,
							},
							{
								type: 1,
								components: [
									{
										type: 2,
										style: 5,
										label: "Zum Liveblog auf ZDF",
										url: liveBlog.url,
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

				await env.zdf_liveblog.prepare(`INSERT INTO live_blogs (id, thread_id) VALUES (?, ?)`).bind(liveBlog.id, threadId).run();
			}

			const receivedGuids = data.results.map((update) => update.guid);
			const existingGuids = await env.zdf_liveblog
				.prepare(`SELECT guid FROM live_updates WHERE blog_id = ? AND guid IN (${receivedGuids.map(() => "?").join(",")})`)
				.bind(liveBlog.id, ...receivedGuids)
				.all<{
					guid: string;
				}>();

			for (const update of data.results.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())) {
				if (existingGuids.results.some((g) => g.guid === update.guid)) {
					continue;
				}

				console.log(`New update: ${update.title} (${update.guid})`);

				// Post the update to the thread
				const body = {
					flags: 1 << 15, // components v2
					components: [
						{
							type: 10,
							content: `# [${update.title}](${new URL(update.sharing_url, "https://liveblog.zdf.de").toString()})`,
						},
						{
							type: 10,
							content:
								`-# <t:${Math.floor(new Date(update.start).getTime() / 1000)}:R>` +
								(update.is_top_blogitem ? ` - **Wichtige Meldung**` : ""),
						},
						{
							type: 10,
							content: decode(update.text).replaceAll("<p>", "").replaceAll("</p>", "\n").trim().slice(0, 2000),
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
					],
				};
				console.log(JSON.stringify(body));
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
				await env.zdf_liveblog.prepare(`INSERT INTO live_updates (blog_id, guid) VALUES (?, ?)`).bind(liveBlog.id, update.guid).run();
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
	// these are only available for real images, "image" is reused for a video thumbnail
	image_description?: string;
	image_alt_text?: string;
	image_source?: string;
	// there's also videos, but they're HLS only and we can't embed those in Discord
}
