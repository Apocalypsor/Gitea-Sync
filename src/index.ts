interface WorkerEnv {
	GH_USERNAME: string;
	GH_TOKEN: string;
	TEA_URL: string;
	TEA_TOKEN: string;
	TEA_ORG: string;
	SYNC_TRIGGER_TOKEN?: string;
}

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

function githubHeaders(env: WorkerEnv): HeadersInit {
	return {
		Authorization: `Bearer ${env.GH_TOKEN}`,
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
		'User-Agent': 'gitea-sync-worker',
	};
}

function assertEnv(env: WorkerEnv): void {
	const required: Array<keyof WorkerEnv> = ['GH_USERNAME', 'GH_TOKEN', 'TEA_URL', 'TEA_TOKEN', 'TEA_ORG'];
	const missing = required.filter((key) => !env[key]);
	if (missing.length > 0) {
		throw new Error(`Missing required env vars: ${missing.join(', ')}`);
	}
}

async function fetchGithubRepos(env: WorkerEnv): Promise<SourceRepo[]> {
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
			throw new Error(`GitHub list repos failed: ${res.status} ${await res.text()}`);
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

function teaHeaders(env: WorkerEnv): HeadersInit {
	return {
		Authorization: `Bearer ${env.TEA_TOKEN}`,
		'Content-Type': 'application/json',
		'User-Agent': 'gitea-sync-worker',
	};
}

async function fetchTeaRepos(env: WorkerEnv): Promise<DestRepo[]> {
	const repos: DestRepo[] = [];
	let page = 1;

	while (true) {
		const url = new URL(`${env.TEA_URL.replace(/\/$/, '')}/api/v1/orgs/${encodeURIComponent(env.TEA_ORG)}/repos`);
		url.searchParams.set('page', String(page));
		url.searchParams.set('limit', '50');

		const res = await fetch(url, { headers: teaHeaders(env) });
		if (!res.ok) {
			throw new Error(`Gitea list repos failed: ${res.status} ${await res.text()}`);
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

async function createMirror(env: WorkerEnv, repo: SourceRepo): Promise<boolean> {
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
		console.error(`Failed to create ${repo.name}: ${res.status} ${await res.text()}`);
		return false;
	}

	return true;
}

async function deleteMirror(env: WorkerEnv, repoName: string): Promise<boolean> {
	const res = await fetch(
		`${env.TEA_URL.replace(/\/$/, '')}/api/v1/repos/${encodeURIComponent(env.TEA_ORG)}/${encodeURIComponent(repoName)}`,
		{
			method: 'DELETE',
			headers: teaHeaders(env),
		},
	);
	return res.status === 204;
}

async function unwatchMirrors(env: WorkerEnv, repos: DestRepo[]): Promise<string[]> {
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
		}
	}

	return failed;
}

async function syncRepos(env: WorkerEnv): Promise<SyncSummary> {
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

function isAuthorized(request: Request, env: WorkerEnv): boolean {
	if (!env.SYNC_TRIGGER_TOKEN) {
		return true;
	}
	const auth = request.headers.get('authorization');
	return auth === `Bearer ${env.SYNC_TRIGGER_TOKEN}`;
}

export default {
	async scheduled(_controller, env): Promise<void> {
		const summary = await syncRepos(env as WorkerEnv);
		console.log(`Sync completed: ${JSON.stringify(summary)}`);
	},

	async fetch(request, env): Promise<Response> {
		const workerEnv = env as WorkerEnv;
		const url = new URL(request.url);

		if (request.method === 'GET' && url.pathname === '/health') {
			return Response.json({ ok: true });
		}

		if (request.method === 'POST' && url.pathname === '/sync') {
			if (!isAuthorized(request, workerEnv)) {
				return new Response('Unauthorized', { status: 401 });
			}
			try {
				const summary = await syncRepos(workerEnv);
				return Response.json({ ok: true, summary });
			} catch (error) {
				console.error(error);
				const message = error instanceof Error ? error.message : 'Unknown error';
				return Response.json({ ok: false, error: message }, { status: 500 });
			}
		}

		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
