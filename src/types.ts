export interface ObservabilityErrorPayload {
	source: string;
	event: string;
	message: string;
	stack?: string;
	context?: Record<string, unknown>;
	timestamp: string;
}

export interface ObservabilityServiceBinding {
	reportError(payload: ObservabilityErrorPayload | null | undefined): Promise<void>;
}

export interface Env {
	GH_USERNAME: string;
	GH_TOKEN: string;
	TEA_URL: string;
	TEA_TOKEN: string;
	TEA_ORG: string;
	SYNC_TRIGGER_TOKEN?: string;
	WORKER_NAME: string;
	OBS_SERVICE: ObservabilityServiceBinding;
}
