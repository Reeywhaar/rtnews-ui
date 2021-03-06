import {
	apiRoot,
	sortings,
	postRecentness,
	postLevels,
	PostRecentness,
	PostLevel,
	Sorting,
} from "./settings";
import { first, retry, sleep, fromServerTime, padStart } from "./utils";
import { ArticleInit, Article } from "./articleInterface";
import { Feed } from "./feedInterface";
import { ThemeType } from "./themeInterface";

const whitespaceRegex = /(\t|\s)+/g;
const longWordRegex = /([^\s\\]{16})/gm;

export class ArticleParseError extends TypeError {}

function processArticle(article: ArticleInit): Article {
	if (typeof article !== "object" || article === null)
		throw new ArticleParseError("Article type is wrong");
	const output = { ...article } as Article;
	if (output.hasOwnProperty("snippet")) {
		output.snippet = output.snippet
			.replace(whitespaceRegex, " ")
			.replace(longWordRegex, "$1&shy;");
	}
	if (output.hasOwnProperty("ts")) {
		output.parsedts = Date.parse(output.ts);
	}
	if (output.hasOwnProperty("ats")) {
		output.parsedats = Date.parse(output.ats);
	}
	if (output.hasOwnProperty("activets")) {
		output.parsedactivets = Date.parse(output.activets);
	}
	if (output.domain === "") {
		try {
			const url = new URL(output.origlink);
			output.domain = url.hostname;
		} catch (e) {}
	}
	return output;
}

/**
 * Converts raw object to Article
 *
 * @param articles raw articles from server
 */
function processArticles(articles: ArticleInit[]): Article[] {
	return articles.map(processArticle);
}

/**
 * Gets proposed topics url
 */
export function getPrepTopicsURL(): Promise<string | null> {
	return fetch("https://radio-t.com/site-api/last/1?categories=prep")
		.then(resp => {
			if (resp.status >= 400) {
				return new Error(resp.statusText);
			}
			return resp.json();
		})
		.then(data => {
			if (data.length < 1) return null;
			return data[0].url || null;
		});
}

/**
 * returns next Podcast issue number
 */
export function getIssueNumber(): Promise<{
	number: number;
	link: string | null;
} | null> {
	return retry(() =>
		fetch("https://radio-t.com/site-api/last/1?categories=podcast,prep")
	)
		.then(resp => resp.json())
		.then((json: { title: string; url: string }[]) => {
			const passedReg = /^Темы для (\d+)$/i;
			const upcomingReg = /^Радио-Т (\d+)$/i;
			const match = json[0].title.match(passedReg);
			if (match && match.length > 1) {
				const number = parseInt(match[1], 10);
				return {
					number,
					link: json[0].url + "#remark42",
				};
			}
			const upcomingMatch = json[0].title.match(upcomingReg);
			if (upcomingMatch && upcomingMatch.length > 1) {
				const number = parseInt(upcomingMatch[1], 10) + 1;
				return {
					number,
					link: null,
				};
			}
			return null;
		})
		.catch(() => null);
}

function request(
	endpoint: string,
	options: RequestInit = {}
): Promise<unknown> {
	if (!options.hasOwnProperty("headers")) {
		options.headers = new Headers();
	}
	if (localStorage.getItem("rt-news.auth")) {
		(options.headers as any).append(
			"Authorization",
			"Basic " + localStorage.getItem("rt-news.auth")
		);
	}
	return fetch(
		apiRoot + endpoint + `?timestamp=${new Date().getTime()}`,
		Object.assign(
			{
				mode: "cors",
				credentials: "omit",
			},
			options
		)
	).then(req => {
		if (req.status >= 400) throw req;
		return req.json().catch(() => null);
	});
}

/**
 * Updates articles on the server
 */
export function update(): Promise<null> {
	return request("/news/reload", { method: "PUT" }) as Promise<null>;
}

/**
 * Gets articles from the server
 */
export function getNews(): Promise<Article[]> {
	return (request("/news") as Promise<ArticleInit[]>).then(processArticles);
}

/**
 * Gets archive articles from the server
 */
export function getArchiveNews(): Promise<Article[]> {
	return (request("/news/archive") as Promise<ArticleInit[]>).then(
		processArticles
	);
}

/**
 * Gets deleted articles from the server
 */
export function getDeletedNews(): Promise<Article[]> {
	return (request("/news/del") as Promise<ArticleInit[]>).then(processArticles);
}

/**
 * maps slug to article
 */
const articlesCache: Map<string, Article> = new Map();

/**
 * maps id to slug
 */
const articlesIdSlugMap: Map<string, string> = new Map();

/**
 * Gets article by id
 */
export async function getArticle(id: string): Promise<Article | null> {
	if (articlesIdSlugMap.has(id))
		return Promise.resolve(articlesCache.get(articlesIdSlugMap.get(
			id
		) as string) as Article);
	const articleInit: object = (await request(
		"/news/id/" + encodeURIComponent(id)
	)) as Promise<object>;
	if (!articleInit.hasOwnProperty("id")) {
		return null;
	}
	const article = processArticle(articleInit as ArticleInit);
	articlesCache.set(article.slug, article);
	articlesIdSlugMap.set(article.id, article.slug);
	return article;
}

/**
 * Gets article by slug
 */
export async function getArticleBySlug(slug: string): Promise<Article | null> {
	if (articlesCache.has(slug))
		return Promise.resolve(articlesCache.get(slug) as Article);
	const articleInit: object = (await request(
		"/news/slug/" + encodeURIComponent(slug)
	)) as Promise<object>;
	if (!articleInit.hasOwnProperty("id")) return null;
	const article = processArticle(articleInit as ArticleInit);
	articlesCache.set(slug, article);
	articlesIdSlugMap.set(article.id, article.slug);
	return article;
}

/**
 * @return active article id
 */
export function getActiveArticle(): Promise<string | null> {
	return (request(`/news/active/id`) as Promise<{ id?: string }>)
		.then(x => x.id || null)
		.catch(() => null);
}

/**
 * Polls server for active article change
 *
 * @param ms polling timeout. default: 295
 */
export async function pollActiveArticle(ms: number = 295): Promise<string> {
	while (true) {
		try {
			const req = (await request(`/news/active/wait/${ms}`)) as {
				id?: string;
			} | null;
			if (req != null && req.hasOwnProperty("id")) return req.id!;
		} catch (e) {
			console.error("Error while polling for active article");
			await sleep(3000);
		}
	}
}

/**
 * Adds article or updates it ifs title already exists on server
 *
 */
export function addArticle(
	link: string,
	title: string = "",
	snippet: string = "",
	content: string = "",
	position: number | null = null
): Promise<null> {
	const body: {
		link: string;
		title?: string;
		snippet?: string;
		content?: string;
		position?: number;
	} = { link };
	const isManual = !!(title || snippet || content || position);

	if (title && title.length > 0) body.title = title;
	if (snippet && snippet.length > 0) body.snippet = snippet;
	if (content && content.length > 0) body.content = content;
	if (position) body.position = position;

	const headers = new Headers();
	headers.append("Content-Type", "application/json");

	const url = isManual ? "/news/manual" : "/news";

	for (let [slug, article] of articlesCache.entries()) {
		if (article.title === title) {
			articlesCache.delete(slug);
			articlesIdSlugMap.delete(article.id);
		}
	}

	return request(url, {
		method: "POST",
		body: JSON.stringify(body),
		headers,
	}) as Promise<null>;
}

export function updateArticle(updated: Partial<Article>): Promise<null> {
	for (let [slug, article] of articlesCache.entries()) {
		if (article.id === updated.id) {
			articlesCache.delete(slug);
			articlesIdSlugMap.delete(article.id);
		}
	}

	const headers = new Headers();
	headers.append("Content-Type", "application/json");

	return request("/news/manual", {
		method: "POST",
		body: JSON.stringify(updated),
		headers,
	}) as Promise<null>;
}

export function archiveArticle(id: string): Promise<null> {
	return request(`/news/archive/${id}`, { method: "PUT" }) as Promise<null>;
}

export function activateArticle(id: string): Promise<null> {
	return request(`/news/active/${id}`, { method: "PUT" }) as Promise<null>;
}

export function removeArticle(id: string): Promise<null> {
	return request(`/news/${id}`, { method: "DELETE" }) as Promise<null>;
}

export function restoreArticle(id: string): Promise<null> {
	return request(`/news/undelete/${id}`, { method: "PUT" }) as Promise<null>;
}

export function moveArticle(
	id: string,
	offset: number
): Promise<{ [id: string]: number }> {
	return request(`/news/moveid/${id}/${offset}`, { method: "PUT" }) as Promise<{
		[id: string]: number;
	}>;
}

/**
 * Moves article to top
 */
export async function makeArticleFirst(
	id: string
): Promise<{ [id: string]: number }> {
	const positions = (await request("/news/positions")) as {
		[id: string]: number;
	};
	if (!positions.hasOwnProperty(id))
		throw new Error("Can't find id's position");
	const pos = positions[id];
	const maxPos = Object.values(positions).reduce((c, x) => Math.max(c, x), 0);
	const offset = maxPos - pos;
	return request(`/news/moveid/${id}/${offset}`, { method: "PUT" }) as Promise<{
		[id: string]: number;
	}>;
}

/**
 * Makes article Geek
 */
export function makeArticleGeek(id: string): Promise<null> {
	return request(`/news/geek/${id}`, { method: "PUT" }) as Promise<null>;
}

/**
 * Removes geek indicator from article
 */
export function makeArticleNotGeek(id: string): Promise<null> {
	return request(`/news/nogeek/${id}`, { method: "PUT" }) as Promise<null>;
}

export function getFeeds(): Promise<Feed[]> {
	return request("/feeds") as Promise<Feed[]>;
}

export function addFeed(url: string): Promise<null> {
	const headers = new Headers();
	headers.append("Content-Type", "application/json");
	const body = JSON.stringify({
		feedlink: url,
	});
	return request("/feeds", { method: "POST", headers, body }) as Promise<null>;
}

export function removeFeed(id: string): Promise<null> {
	return request("/feeds/" + id, { method: "DELETE" }) as Promise<null>;
}

/**
 * Converts date to yyyymmdd-hhmmss which server requires
 *
 * @param date
 */
function toShowStartTimeURLParameter(date: Date): string {
	const d = new Date(date);
	d.setUTCHours(d.getUTCHours() - 6);
	const pad = (i: string | number) => padStart(i, 2, "0");
	return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(
		d.getUTCDate()
	)}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/**
 *
 * @param date show start datetime, current time if null
 */
export function startShow(date?: Date): Promise<null> {
	const appendix = date
		? `/${encodeURIComponent(toShowStartTimeURLParameter(date))}`
		: "";
	return request("/show/start" + appendix, { method: "PUT" }) as Promise<null>;
}

export function getShowStartTime(): Promise<Date | null> {
	return (request("/show/start") as Promise<{ started?: string }>)
		.then(obj => {
			return obj.started ? fromServerTime(obj.started) : null;
		})
		.catch(e => {
			console.error(e);
			return null;
		});
}

export function getRecentness(): PostRecentness {
	const s = localStorage.getItem("recentness");
	return first(postRecentness, x => x.title === s) || postRecentness[0];
}

export function setRecentness(value: PostRecentness): void {
	localStorage.setItem("recentness", value.title);
}

export function getPostLevel(): PostLevel {
	const s = localStorage.getItem("postLevel");
	return first(postLevels, x => x.title === s) || postLevels[0];
}

export function setPostLevel(value: PostLevel): void {
	localStorage.setItem("postLevel", value.title);
}

export function getSorting(): Sorting {
	const s = localStorage.getItem("sorting");
	return first(sortings, x => x.title === s) || sortings[0];
}

export function setSorting(value: Sorting): void {
	localStorage.setItem("sorting", value.title);
}

export function getTheme(): ThemeType {
	const s = localStorage.getItem("theme") as ThemeType;
	if (s !== null) return s;

	//check system night mode
	const mode = (() => {
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		return query.matches ? "night" : "day";
	})();

	return mode || "day";
}

export function setTheme(value: ThemeType): void {
	localStorage.setItem("theme", value);
}

function loginViaHeader(header: string): Promise<boolean> {
	const headers = new Headers();
	headers.append("Authorization", "Basic " + header);
	return fetch(apiRoot + "/news/reload", {
		method: "PUT",
		headers: headers,
		credentials: "omit",
		mode: "cors",
	})
		.then(response => {
			if (response.status === 200) return true;
			return false;
		})
		.catch(() => false);
}

export function login(user: string, password: string): Promise<boolean> {
	const auth = btoa(user + ":" + password);
	return loginViaHeader(auth).then(result => {
		if (result) localStorage.setItem("rt-news.auth", auth);
		return result;
	});
}

export function loginViaStorage(): Promise<boolean> {
	if (!localStorage.getItem("rt-news.auth")) return Promise.resolve(false);
	const auth = localStorage.getItem("rt-news.auth")!;
	return retry(() => loginViaHeader(auth), 3, 1000);
}

export function logout(): void {
	localStorage.removeItem("rt-news.auth");
}
