import {
	logError,
	logInfo,
	logWarn,
	reportErrorToObservability,
} from './observability';
import type { Env } from './types';

interface SourceRepo {
	name: string;
	fullName: string;
	cloneUrl: string;
	description: string | null;
	private: boolean;
}

interface DestRepo {
	name: string;
	fullName: string;
	htmlUrl: string;
}

interface SyncSummary {
	sourceCount: number;
	destinationCount: number;
	created: string[];
	creationFailed: string[];
	deleted: string[];
	deletionFailed: string[];
	unwatchFailed: string[];
}

const GITHUB_API_BASE = 'https://api.github.com';
const RESPONSE_BODY_SNIPPET_LIMIT = 4000;

function githubHeaders(env: Env): HeadersInit {
	return {
		Authorization: `Bearer ${env.GH_TOKEN}`,
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
		'User-Agent': 'gitea-sync-worker',
	};
}

function assertEnv(env: Env): void {
	const required: Array<keyof Env> = ['GH_USERNAME', 'GH_TOKEN', 'TEA_URL', 'TEA_TOKEN', 'TEA_ORG'];
	const missing = required.filter((key) => !env[key]);
	if (missing.length > 0) {
		throw new Error(`Missing required env vars: ${missing.join(', ')}`);
	}
}

async function fetchGithubRepos(env: Env): Promise<SourceRepo[]> {
	const repos: SourceRepo[] = [];
	let page = 1;

	while (true) {
		const url = new URL(`${GITHUB_API_BASE}/user/repos`);
		url.searchParams.set('type', 'owner');
		url.searchParams.set('per_page', '100');
		url.searchParams.set('page', String(page));

		const res = await fetch(url, {
			headers: githubHeaders(env),
		});
		if (!res.ok) {
			const responseBody = await readResponseBodySnippet(res);
			throw new Error(`GitHub list repos failed: ${res.status} ${responseBody}`);
		}

		const data = (await res.json()) as Array<{
			name: string;
			full_name: string;
			clone_url: string;
			description: string | null;
			private: boolean;
			archived: boolean;
		}>;

		if (data.length === 0) {
			break;
		}

		for (const repo of data) {
			if (repo.archived) {
				continue;
			}
			repos.push({
				name: repo.name,
				fullName: repo.full_name,
				cloneUrl: repo.clone_url,
				description: repo.description,
				private: repo.private,
			});
		}

		page += 1;
	}

	return repos;
}

function teaHeaders(env: Env): HeadersInit {
	return {
		Authorization: `Bearer ${env.TEA_TOKEN}`,
		'Content-Type': 'application/json',
		'User-Agent': 'gitea-sync-worker',
	};
}

async function fetchTeaRepos(env: Env): Promise<DestRepo[]> {
	const repos: DestRepo[] = [];
	let page = 1;

	while (true) {
		const url = new URL(`${env.TEA_URL.replace(/\/$/, '')}/api/v1/orgs/${encodeURIComponent(env.TEA_ORG)}/repos`);
		url.searchParams.set('page', String(page));
		url.searchParams.set('limit', '50');

		const res = await fetch(url, { headers: teaHeaders(env) });
		if (!res.ok) {
			const responseBody = await readResponseBodySnippet(res);
			throw new Error(`Gitea list repos failed: ${res.status} ${responseBody}`);
		}

		const data = (await res.json()) as Array<{
			name: string;
			full_name: string;
			html_url: string;
		}>;

		if (data.length === 0) {
			break;
		}

		for (const repo of data) {
			repos.push({
				name: repo.name,
				fullName: repo.full_name,
				htmlUrl: repo.html_url,
			});
		}

		page += 1;
	}

	return repos;
}

async function createMirror(env: Env, repo: SourceRepo): Promise<boolean> {
	const res = await fetch(`${env.TEA_URL.replace(/\/$/, '')}/api/v1/repos/migrate`, {
		method: 'POST',
		headers: teaHeaders(env),
		body: JSON.stringify({
			auth_username: env.GH_USERNAME,
			auth_token: env.GH_TOKEN,
			clone_addr: repo.cloneUrl,
			description: repo.description,
			issues: false,
			milestones: true,
			mirror: true,
			private: repo.private,
			pull_requests: true,
			releases: true,
			repo_name: repo.name,
			repo_owner: env.TEA_ORG,
			wiki: true,
		}),
	});

	if (!res.ok) {
		const responseBody = await readResponseBodySnippet(res);
		logError(env, 'sync.create_mirror_failed', {
			repo: repo.name,
			status: res.status,
			response_body: responseBody,
		});
		return false;
	}

	return true;
}

async function deleteMirror(env: Env, repoName: string): Promise<boolean> {
	const res = await fetch(
		`${env.TEA_URL.replace(/\/$/, '')}/api/v1/repos/${encodeURIComponent(env.TEA_ORG)}/${encodeURIComponent(repoName)}`,
		{
			method: 'DELETE',
			headers: teaHeaders(env),
		},
	);

	if (res.status !== 204) {
		const responseBody = await readResponseBodySnippet(res);
		logError(env, 'sync.delete_mirror_failed', {
			repo: repoName,
			status: res.status,
			response_body: responseBody,
		});
		return false;
	}

	return true;
}

async function unwatchMirrors(env: Env, repos: DestRepo[]): Promise<string[]> {
	const failed: string[] = [];

	for (const repo of repos) {
		const res = await fetch(
			`${env.TEA_URL.replace(/\/$/, '')}/api/v1/repos/${encodeURIComponent(env.TEA_ORG)}/${encodeURIComponent(repo.name)}/subscription`,
			{
				method: 'DELETE',
				headers: teaHeaders(env),
			},
		);
		if (res.status !== 204) {
			failed.push(repo.name);
			const responseBody = await readResponseBodySnippet(res);
			logWarn(env, 'sync.unwatch_failed', {
				repo: repo.name,
				status: res.status,
				response_body: responseBody,
			});
		}
	}

	return failed;
}

async function syncRepos(env: Env): Promise<SyncSummary> {
	assertEnv(env);
	const sourceRepos = await fetchGithubRepos(env);
	const destinationRepos = await fetchTeaRepos(env);

	const sourceNames = new Set(sourceRepos.map((r) => r.name));
	const destinationNames = new Set(destinationRepos.map((r) => r.name));

	const created: string[] = [];
	const creationFailed: string[] = [];
	const deleted: string[] = [];
	const deletionFailed: string[] = [];

	for (const repo of sourceRepos) {
		if (destinationNames.has(repo.name)) {
			continue;
		}
		if (await createMirror(env, repo)) {
			created.push(repo.name);
		} else {
			creationFailed.push(repo.name);
		}
	}

	for (const repo of destinationRepos) {
		if (sourceNames.has(repo.name)) {
			continue;
		}
		if (await deleteMirror(env, repo.name)) {
			deleted.push(repo.name);
		} else {
			deletionFailed.push(repo.name);
		}
	}

	const refreshedDestRepos = await fetchTeaRepos(env);
	const unwatchFailed = await unwatchMirrors(env, refreshedDestRepos);

	return {
		sourceCount: sourceRepos.length,
		destinationCount: destinationRepos.length,
		created,
		creationFailed,
		deleted,
		deletionFailed,
		unwatchFailed,
	};
}

function isAuthorized(request: Request, env: Env): boolean {
	if (!env.SYNC_TRIGGER_TOKEN) {
		return true;
	}
	const auth = request.headers.get('authorization');
	return auth === `Bearer ${env.SYNC_TRIGGER_TOKEN}`;
}

async function runSyncWithObservability(env: Env, trigger: 'manual' | 'scheduled'): Promise<SyncSummary> {
	const startedAt = Date.now();
	logInfo(env, 'sync.started', { trigger });
	try {
		const summary = await syncRepos(env);
		logInfo(env, 'sync.completed', {
			trigger,
			duration_ms: Date.now() - startedAt,
			source_count: summary.sourceCount,
			destination_count: summary.destinationCount,
			created_count: summary.created.length,
			creation_failed_count: summary.creationFailed.length,
			deleted_count: summary.deleted.length,
			deletion_failed_count: summary.deletionFailed.length,
			unwatch_failed_count: summary.unwatchFailed.length,
		});

		if (summary.creationFailed.length > 0) {
			logWarn(env, 'sync.creation_failed_repositories', { repos: summary.creationFailed });
		}
		if (summary.deletionFailed.length > 0) {
			logWarn(env, 'sync.deletion_failed_repositories', { repos: summary.deletionFailed });
		}
		if (summary.unwatchFailed.length > 0) {
			logWarn(env, 'sync.unwatch_failed_repositories', { repos: summary.unwatchFailed });
		}

		return summary;
	} catch (error: unknown) {
		await reportErrorToObservability(env, 'sync.failed', error, {
			trigger,
			duration_ms: Date.now() - startedAt,
		});
		throw error;
	}
}

async function readResponseBodySnippet(response: Response): Promise<string> {
	try {
		const text = await response.text();
		if (!text) {
			return '<empty response body>';
		}
		if (text.length <= RESPONSE_BODY_SNIPPET_LIMIT) {
			return text;
		}
		return `${text.slice(0, RESPONSE_BODY_SNIPPET_LIMIT)}...<truncated>`;
	} catch (error: unknown) {
		return `failed to read response body: ${error instanceof Error ? error.message : String(error)}`;
	}
}

export default {
	async scheduled(_controller, env: Env): Promise<void> {
		await runSyncWithObservability(env, 'scheduled');
	},

	async fetch(request: Request, workerEnv: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'GET' && url.pathname === '/health') {
			return Response.json({ ok: true });
		}

		if (request.method === 'POST' && url.pathname === '/sync') {
			if (!isAuthorized(request, workerEnv)) {
				logWarn(workerEnv, 'http.sync_unauthorized', {
					method: request.method,
					pathname: url.pathname,
				});
				return new Response('Unauthorized', { status: 401 });
			}
			try {
				const summary = await runSyncWithObservability(workerEnv, 'manual');
				return Response.json({ ok: true, summary });
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				return Response.json({ ok: false, error: message }, { status: 500 });
			}
		}

		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
