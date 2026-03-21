import type { Env, ObservabilityErrorPayload } from './types';

type LogLevel = 'info' | 'warn' | 'error';
type LogContext = Record<string, unknown>;

export function logInfo(env: Env, event: string, context: LogContext = {}): void {
	emitStructuredLog('info', env, event, context);
}

export function logWarn(env: Env, event: string, context: LogContext = {}): void {
	emitStructuredLog('warn', env, event, context);
}

export function logError(env: Env, event: string, context: LogContext = {}): void {
	emitStructuredLog('error', env, event, context);
}

export async function reportErrorToObservability(env: Env, event: string, error: unknown, context: LogContext = {}): Promise<void> {
	const payload: ObservabilityErrorPayload = {
		source: resolveWorkerName(env),
		event,
		message: getErrorMessage(error),
		stack: error instanceof Error ? error.stack : undefined,
		context,
		timestamp: new Date().toISOString(),
	};

	logError(env, payload.event, {
		message: payload.message,
		stack: payload.stack,
		...(payload.context || {}),
	});

	try {
		await env.OBS_SERVICE.reportError(payload);
	} catch (forwardError: unknown) {
		logError(env, 'observability.forward_failed', {
			original_event: payload.event,
			message: getErrorMessage(forwardError),
		});
	}
}

function emitStructuredLog(level: LogLevel, env: Env, event: string, context: LogContext): void {
	const workerName = resolveWorkerName(env);
	const payload = {
		level,
		event,
		title: `[${workerName}] ${event}`,
		worker_name: workerName,
		timestamp: new Date().toISOString(),
		...context,
	};

	if (level === 'error') {
		console.error(payload);
		return;
	}

	if (level === 'warn') {
		console.warn(payload);
		return;
	}

	console.log(payload);
}

function resolveWorkerName(env: Env): string {
	return env.WORKER_NAME;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
