import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	DEPLOYED_LEDGER_STATUS,
	LEDGER_STATUS,
	findRecordedInterventionKeys,
	interventionDedupeKey,
	listPendingReceipts,
	markPendingAttempt,
	markPendingRecorded,
	primaryTargetQuery,
	savePendingReceipt,
	shouldSkipIntervention,
	validatePublishReceipt,
} from './ledger-receipt-store.mjs';

const GSC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT_ID = '1dUd5Zx9I55-jXt-sRhXwYhl3-F1M2fvy0iyF7e7Kx6zpfApkemTwQZIg';
const SCRIPT_EXECUTION_SCOPE = 'https://www.googleapis.com/auth/script.scriptapp';
const FETCH_TIMEOUT_MS = 45_000;

export const EXIT = {
	RECORDED: 0,
	LEDGER_FAILED: 1,
	INVALID_INPUT: 2,
	LEDGER_PENDING: 10,
	RECEIPT_FAILED: 11,
	WRITEBACK_PENDING: 12,
};

export const DEPLOYMENT_RECEIPT_SCHEMA = 'deployment-receipt-v1';

export const PUBLISH_COMPLETION_STATUS = {
	COMPLETE: 'COMPLETE',
	RECEIPT_FAILED: 'RECEIPT_FAILED',
	WRITEBACK_PENDING: 'WRITEBACK_PENDING',
	PRODUCTION_FAILED: 'PRODUCTION_FAILED',
};

function normalizeProductionUrl(raw) {
	const value = asString(raw).replace(/\/+$/, '');
	return value ? `${value}/` : '';
}

function normalizeReceiptPath(raw) {
	const value = asString(raw);
	if (!value || value === '/') return '/';
	return `/${value.replace(/^\/+|\/+$/g, '')}/`;
}

export function validateDeploymentReceiptMinimum(receipt) {
	const required = [
		'receiptKey', 'siteId', 'siteName', 'batchId', 'commitSHA',
		'deploymentURL', 'productionURL', 'productionDeployedAt', 'action',
	];
	const missing = required.filter((key) => !asString(receipt?.[key]));
	if (receipt?.schemaVersion !== DEPLOYMENT_RECEIPT_SCHEMA || missing.length ||
		!Array.isArray(receipt?.affectedPages) || !receipt.affectedPages.length) {
		throw new Error(`invalid deployment receipt fields${missing.length ? `: ${missing.join(', ')}` : ''}`);
	}
	return true;
}

export function buildDeploymentReceiptFromPublishReceipt(receipt) {
	validatePublishReceipt(receipt);
	const common = receipt.common || {};
	const productionUrl = normalizeProductionUrl(common.productionUrl);
	const toPage = (item) => {
		const path = normalizeReceiptPath(item.primaryUrl);
		const action = asString(item.action || common.action).toUpperCase() || 'OTHER';
		return {
			path,
			action,
			primaryURL: `${productionUrl.replace(/\/$/, '')}${path === '/' ? '/' : path}`,
			triggerType: asString(item.triggerType),
			triggerQueries: Array.isArray(item.triggerQueries) ? item.triggerQueries : [],
			triggerSummary: asString(item.triggerSummary),
			sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs : (Array.isArray(item.sourceRefs) ? item.sourceRefs : []),
			reason: asString(item.reason || item.changeSummary),
		};
	};
	return {
		schemaVersion: DEPLOYMENT_RECEIPT_SCHEMA,
		receiptKey: asString(receipt.launchReceiptKey || common.batchId),
		interventionId: asString(receipt.interventionId || `receipt-${common.batchId}`),
		developmentTaskId: asString(common.developmentTaskId),
		opportunityId: asString(common.opportunityId),
		goalId: asString(common.goalId),
		siteId: asString(common.siteId),
		siteName: asString(common.site),
		batchId: asString(common.batchId),
		decisionId: asString(common.decisionId),
		productionDeployedAt: asString(common.deployedAt),
		commitSHA: asString(common.commitSha),
		deploymentURL: asString(common.deploymentUrl),
		productionURL: productionUrl,
		releaseDate: asString(common.releaseDate),
		lifecyclePhase: asString(common.lifecyclePhase),
		action: asString(receipt.batchAction || common.action || receipt.interventions?.[0]?.action).toUpperCase(),
		reason: asString(receipt.reason || receipt.interventions?.[0]?.reason),
		sourceRefs: Array.isArray(receipt.sourceRefs) ? receipt.sourceRefs : [],
		affectedPages: receipt.interventions.map(toPage),
	};
}

function buildDeploymentLedgerResult(value, receipt) {
	const duplicate = value?.result === 'DUPLICATE_ACCEPTED' || value?.result === 'ALREADY_RECORDED';
	return {
		status: DEPLOYED_LEDGER_STATUS.RECORDED,
		ok: true,
		skipped: duplicate,
		result: value?.result || 'ACCEPTED',
		output: `${duplicate ? 'SKIP' : 'PASS'} deployment receipt result=${value?.result || 'ACCEPTED'} receiptKey=${value?.receiptKey || receipt.receiptKey} intervention=${value?.interventionId || receipt.interventionId} contentUpdates=${value?.contentUpdates ?? 0} observations=${value?.observations ?? 0}`,
		error: '',
		summary: {
			batchId: receipt.batchId,
			receiptKey: value?.receiptKey || receipt.receiptKey,
			interventionId: value?.interventionId || receipt.interventionId,
			contentUpdates: value?.contentUpdates ?? 0,
			observations: value?.observations ?? 0,
			baselineDataDate: value?.baselineDataDate || '',
			deployedAt: receipt.productionDeployedAt,
		},
		response: value,
	};
}

function invokeIngestDeploymentReceiptViaClaspCli(receipt, options = {}) {
	validateDeploymentReceiptMinimum(receipt);
	const user = claspUser(options);
	const params = JSON.stringify([receipt]);
	const result = spawnSync('clasp', ['--json', 'run', 'ingestDeploymentReceipt', '--user', user, '--params', params], {
		cwd: options.cwd || GSC_ROOT,
		encoding: 'utf8',
		env: { ...process.env, HOTWORD_CLASP_USER: user },
		timeout: 120_000,
	});
	const stdout = String(result.stdout || '').trim();
	const stderr = String(result.stderr || '').trim();
	const output = `${stdout}\n${stderr}`.trim();
	if (result.error || result.status !== 0) {
		const message = result.error?.message || output;
		return {
			status: isRecoverableLedgerError(message) ? DEPLOYED_LEDGER_STATUS.PENDING : DEPLOYED_LEDGER_STATUS.FAILED,
			ok: false,
			output,
			error: message,
			summary: { batchId: receipt.batchId, receiptKey: receipt.receiptKey },
			transport: 'clasp-cli',
		};
	}
	let response = null;
	try {
		response = JSON.parse(stdout);
	} catch {
		return {
			status: DEPLOYED_LEDGER_STATUS.FAILED,
			ok: false,
			output,
			error: `clasp returned non-JSON output: ${stdout || stderr}`,
			summary: { batchId: receipt.batchId, receiptKey: receipt.receiptKey },
			transport: 'clasp-cli',
		};
	}
	const value = response && (response.response || response.result) ? (response.response || response.result) : response;
	if (!value || value.ok !== true || !['ACCEPTED', 'DUPLICATE_ACCEPTED', 'ALREADY_RECORDED'].includes(value.result)) {
		return {
			status: isRecoverableLedgerError(stdout) ? DEPLOYED_LEDGER_STATUS.PENDING : DEPLOYED_LEDGER_STATUS.FAILED,
			ok: false,
			output: stdout,
			error: stdout,
			summary: { batchId: receipt.batchId, receiptKey: receipt.receiptKey },
			response: value,
			transport: 'clasp-cli',
		};
	}
	return { ...buildDeploymentLedgerResult(value, receipt), transport: 'clasp-cli' };
}

async function invokeIngestDeploymentReceiptViaApi(receipt, options = {}) {
	validateDeploymentReceiptMinimum(receipt);
	const user = claspUser(options);
	const preflight = options.skipPreflight ? { ok: true } : await preflightClaspCredentials({ ...options, claspUser: user });
	if (!preflight.ok) {
		return {
			status: DEPLOYED_LEDGER_STATUS.PENDING,
			ok: false,
			output: preflight.message,
			error: `${preflight.action} ${preflight.reason}`,
			summary: { batchId: receipt.batchId, receiptKey: receipt.receiptKey },
			preflight,
			transport: 'apps-script-api',
		};
	}
	try {
		const response = await fetchWithTimeout(`https://script.googleapis.com/v1/scripts/${SCRIPT_ID}:run`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${preflight.accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				function: 'ingestDeploymentReceipt',
				parameters: [receipt],
				devMode: options.devMode !== false,
			}),
		});
		const body = await response.json();
		if (!response.ok || body.error) {
			const errorText = JSON.stringify(body.error || body);
			return {
				status: isRecoverableLedgerError(errorText) ? DEPLOYED_LEDGER_STATUS.PENDING : DEPLOYED_LEDGER_STATUS.FAILED,
				ok: false,
				output: errorText,
				error: body.error?.message || errorText,
				summary: { batchId: receipt.batchId, receiptKey: receipt.receiptKey },
				transport: 'apps-script-api',
			};
		}
		const value = body.response?.result;
		if (!value || value.ok !== true || !['ACCEPTED', 'DUPLICATE_ACCEPTED', 'ALREADY_RECORDED'].includes(value.result)) {
			const errorText = JSON.stringify(value || body);
			return {
				status: isRecoverableLedgerError(errorText) ? DEPLOYED_LEDGER_STATUS.PENDING : DEPLOYED_LEDGER_STATUS.FAILED,
				ok: false,
				output: errorText,
				error: errorText,
				summary: { batchId: receipt.batchId, receiptKey: receipt.receiptKey },
				response: value,
				transport: 'apps-script-api',
			};
		}
		return { ...buildDeploymentLedgerResult(value, receipt), transport: 'apps-script-api' };
	} catch (error) {
		return {
			status: DEPLOYED_LEDGER_STATUS.PENDING,
			ok: false,
			output: String(error.message || error),
			error: String(error.message || error),
			summary: { batchId: receipt.batchId, receiptKey: receipt.receiptKey },
			transport: 'apps-script-api',
		};
	}
}

export async function invokeIngestDeploymentReceipt(receipt, options = {}) {
	if (options.submit) {
		const submitted = options.submit(receipt);
		return submitted && typeof submitted.then === 'function' ? await submitted : submitted;
	}
	const preferCli = process.env.HOTWORD_LEDGER_TRANSPORT?.trim() === 'clasp-cli';
	if (preferCli) return invokeIngestDeploymentReceiptViaClaspCli(receipt, options);
	const apiResult = await invokeIngestDeploymentReceiptViaApi(receipt, options);
	if (apiResult.ok) return apiResult;
	if (apiResult.status === DEPLOYED_LEDGER_STATUS.FAILED && !isRecoverableLedgerError(apiResult.error || apiResult.output)) {
		return apiResult;
	}
	const cliResult = invokeIngestDeploymentReceiptViaClaspCli(receipt, options);
	if (cliResult.ok) return cliResult;
	if (apiResult.status === DEPLOYED_LEDGER_STATUS.PENDING || cliResult.status === DEPLOYED_LEDGER_STATUS.PENDING) {
		return {
			...cliResult,
			status: DEPLOYED_LEDGER_STATUS.PENDING,
			output: `${apiResult.error || apiResult.output}; clasp-cli fallback: ${cliResult.error || cliResult.output}`,
			error: cliResult.error || apiResult.error,
		};
	}
	return cliResult;
}

export function resolvePublishCompletionStatus({ productionPassed, receiptResult }) {
	if (!productionPassed) return PUBLISH_COMPLETION_STATUS.PRODUCTION_FAILED;
	if (receiptResult?.ok && ['ACCEPTED', 'DUPLICATE_ACCEPTED', 'ALREADY_RECORDED'].includes(receiptResult.result || receiptResult.response?.result)) {
		return PUBLISH_COMPLETION_STATUS.COMPLETE;
	}
	if (receiptResult?.status === DEPLOYED_LEDGER_STATUS.PENDING || isRecoverableLedgerError(receiptResult?.error || receiptResult?.output)) {
		return PUBLISH_COMPLETION_STATUS.WRITEBACK_PENDING;
	}
	return PUBLISH_COMPLETION_STATUS.RECEIPT_FAILED;
}

export async function persistAndSubmitDeploymentReceipt(receipt, options = {}) {
	validateDeploymentReceiptMinimum(receipt);
	let result;
	try {
		result = await invokeIngestDeploymentReceipt(receipt, options);
	} catch (error) {
		result = {
			status: DEPLOYED_LEDGER_STATUS.PENDING,
			ok: false,
			output: String(error.message || error),
			error: String(error.message || error),
			summary: { batchId: receipt.batchId, receiptKey: receipt.receiptKey },
		};
	}
	return {
		...result,
		completionStatus: resolvePublishCompletionStatus({ productionPassed: true, receiptResult: result }),
	};
}

export async function finalizeProductionReceiptWriteback(receipt, options = {}) {
	const publishReceipt = receipt?.schemaVersion === DEPLOYMENT_RECEIPT_SCHEMA ? null : receipt;
	const deploymentReceipt = publishReceipt
		? buildDeploymentReceiptFromPublishReceipt(publishReceipt)
		: receipt;
	let pending = null;
	if (publishReceipt) {
		pending = savePendingReceipt(publishReceipt, {
			rootDir: options.rootDir,
			sourceReceiptPath: options.sourceReceiptPath,
			ledgerStatus: DEPLOYED_LEDGER_STATUS.PENDING,
		});
	}
	const current = await persistAndSubmitDeploymentReceipt(deploymentReceipt, options);
	if (pending) {
		if (current.ok) {
			markPendingRecorded(pending.path, {
				recordedAt: new Date().toISOString(),
				interventionIds: [current.summary?.interventionId || current.response?.interventionId].filter(Boolean),
				baselineDataDates: current.summary?.baselineDataDate ? [current.summary.baselineDataDate] : [],
			});
		} else {
			markPendingAttempt(pending.path, {
				ledgerStatus: current.status || DEPLOYED_LEDGER_STATUS.PENDING,
				error: current.error || current.output,
			});
		}
	}
	return { current, deploymentReceipt, pendingPath: pending?.path || '' };
}

/** @deprecated legacy publish-receipt writer; canonical path is ingestDeploymentReceipt */
export async function ingestDeploymentReceipt(receipt, options = {}) {
	return invokeIngestDeploymentReceipt(receipt, options);
}

function asString(value) {
	return value === undefined || value === null ? '' : String(value).trim();
}

function readClaspConfig() {
	const clasprcPath = path.join(os.homedir(), '.clasprc.json');
	if (!existsSync(clasprcPath)) return null;
	try {
		return JSON.parse(readFileSync(clasprcPath, 'utf8'));
	} catch {
		return null;
	}
}

function isOAuthPendingError(text) {
	const message = String(text || '').toLowerCase();
	return (
		message.includes('invalid_grant')
		|| message.includes('invalid grant')
		|| message.includes('token has been expired')
		|| message.includes('token has been revoked')
	);
}

function isNetworkError(text) {
	const message = String(text || '').toLowerCase();
	return (
		message.includes('fetch failed')
		|| message.includes('connect timeout')
		|| message.includes('und_err_connect_timeout')
		|| message.includes('network')
		|| message.includes('econnreset')
		|| message.includes('etimedout')
		|| message.includes('enotfound')
	);
}

function isRecoverableLedgerError(text) {
	const message = String(text || '').toLowerCase();
	return (
		isOAuthPendingError(message)
		|| isNetworkError(message)
		|| message.includes('missing_script_execution_scope')
		|| message.includes('project settings not found')
		|| message.includes('unable to run script function')
		|| message.includes('permission to run the script function')
		|| message.includes('permission_denied')
		|| message.includes('the caller does not have permission')
	);
}

function claspUser(options = {}) {
	return options.claspUser || process.env.HOTWORD_CLASP_USER?.trim() || 'hotword-ledger';
}

function readClaspToken(user) {
	const data = readClaspConfig();
	return data?.tokens?.[user] || null;
}

function claspOAuthClient(token, config) {
	return {
		clientId: config?.oauth2ClientSettings?.clientId || token?.client_id || '',
		clientSecret: config?.oauth2ClientSettings?.clientSecret || token?.client_secret || '',
	};
}

function claspLoginHint(user) {
	return `Run from ${GSC_ROOT}: clasp login --user ${user} --use-project-scopes`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...options, signal: controller.signal });
	} catch (error) {
		if (error?.name === 'AbortError') {
			throw new Error(`Connect Timeout Error (${timeoutMs}ms) calling ${url}`);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

async function refreshClaspAccessToken(user) {
	const config = readClaspConfig();
	const token = readClaspToken(user);
	if (!token?.refresh_token) {
		return {
			ok: false,
			reason: 'MISSING_CLASP_REFRESH_TOKEN',
			message: `Google ledger writeback is not authenticated for clasp user "${user}". ${claspLoginHint(user)}`,
		};
	}
	const { clientId, clientSecret } = claspOAuthClient(token, config);
	if (!clientId || !clientSecret) {
		return {
			ok: false,
			reason: 'MISSING_CLASP_OAUTH_CLIENT',
			message: `Clasp OAuth client settings are missing for user "${user}". ${claspLoginHint(user)}`,
		};
	}
	try {
		const response = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				refresh_token: token.refresh_token,
				grant_type: 'refresh_token',
			}),
		});
		const body = await response.json();
		if (!response.ok) {
			const reason = body?.error === 'invalid_grant' ? 'OAUTH_INVALID_GRANT' : 'OAUTH_REFRESH_FAILED';
			return {
				ok: false,
				reason,
				message:
					reason === 'OAUTH_INVALID_GRANT'
						? `Google ledger OAuth token for clasp user "${user}" is expired or revoked. ${claspLoginHint(user)}`
						: `Google ledger OAuth refresh failed for clasp user "${user}": ${body?.error || response.status}`,
			};
		}
		return { ok: true, accessToken: body.access_token };
	} catch (error) {
		return {
			ok: false,
			reason: 'OAUTH_NETWORK_ERROR',
			message: `Google OAuth refresh failed (${error.message}). Retry backfill when network is stable.`,
		};
	}
}

async function readAccessTokenScopes(accessToken) {
	try {
		const response = await fetchWithTimeout(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
		if (!response.ok) return [];
		const body = await response.json();
		return String(body.scope || '')
			.split(/\s+/)
			.filter(Boolean);
	} catch {
		return [];
	}
}

function missingExecutionScopeMessage(user) {
	return `Google ledger OAuth for clasp user "${user}" is missing Apps Script execution scope (${SCRIPT_EXECUTION_SCOPE}). ${claspLoginHint(user)}`;
}

/** Fail fast before publish/writeback when clasp OAuth or execution scope is unusable. */
export async function preflightClaspCredentials(options = {}) {
	const user = claspUser(options);
	const refreshed = await refreshClaspAccessToken(user);
	if (!refreshed.ok) {
		return {
			ok: false,
			action: 'ACTION_REQUIRED',
			reason: refreshed.reason,
			claspUser: user,
			message: refreshed.message,
		};
	}
	const scopes = await readAccessTokenScopes(refreshed.accessToken);
	if (!scopes.includes(SCRIPT_EXECUTION_SCOPE)) {
		return {
			ok: false,
			action: 'ACTION_REQUIRED',
			reason: 'MISSING_SCRIPT_EXECUTION_SCOPE',
			claspUser: user,
			message: missingExecutionScopeMessage(user),
		};
	}
	return { ok: true, action: 'READY', claspUser: user, accessToken: refreshed.accessToken };
}

export function preflightClaspCredentialsSync(options = {}) {
	const user = claspUser(options);
	const token = readClaspToken(user);
	if (!token?.refresh_token) {
		return {
			ok: false,
			action: 'ACTION_REQUIRED',
			reason: 'MISSING_CLASP_REFRESH_TOKEN',
			claspUser: user,
			message: `Google ledger writeback is not authenticated for clasp user "${user}". ${claspLoginHint(user)}`,
		};
	}
	return { ok: true, action: 'READY', claspUser: user };
}

export function parseLedgerSummary(output) {
	const text = String(output || '');
	return {
		interventionIds: text.match(/interventions=([^\s]+)/i)?.[1]?.split(',').filter(Boolean) ?? [],
		baselineDataDates: text.match(/baseline=([^\s]+)/i)?.[1]?.split(',').filter(Boolean) ?? [],
		batchId: text.match(/batch=([^\s]+)/i)?.[1] || '',
	};
}

function buildLedgerResultFromValue(value, receipt) {
	const interventionIds = (value.interventions || []).map((item) => item.interventionId).filter(Boolean);
	const baselineDataDates = (value.interventions || []).map((item) => item.baselineDataDate).filter(Boolean);
	return {
		status: DEPLOYED_LEDGER_STATUS.RECORDED,
		ok: true,
		output: `PASS ledger writeback batch=${value.batchId || ''} interventions=${interventionIds.join(',') || '(none)'} baseline=${baselineDataDates.join(',') || '(blank)'} deployedAt=${asString(receipt.common.deployedAt)}`,
		error: '',
		summary: {
			batchId: value.batchId || '',
			interventionIds,
			baselineDataDates,
			deployedAt: asString(receipt.common.deployedAt),
		},
		response: value,
	};
}

function invokeRecordPublishedBatchViaClaspCli(receipt, options = {}) {
	validatePublishReceipt(receipt);
	const user = claspUser(options);
	const params = JSON.stringify([receipt]);
	const result = spawnSync('clasp', ['--json', 'run', 'recordPublishedBatch', '--user', user, '--params', params], {
		cwd: options.cwd || GSC_ROOT,
		encoding: 'utf8',
		env: { ...process.env, HOTWORD_CLASP_USER: user },
		timeout: 120_000,
	});
	const stdout = String(result.stdout || '').trim();
	const stderr = String(result.stderr || '').trim();
	const output = `${stdout}\n${stderr}`.trim();
	if (result.error) {
		const message = result.error.message || output;
		return {
			status: isRecoverableLedgerError(message) ? DEPLOYED_LEDGER_STATUS.PENDING : DEPLOYED_LEDGER_STATUS.FAILED,
			ok: false,
			output,
			error: message,
			summary: parseLedgerSummary(output),
			transport: 'clasp-cli',
		};
	}
	if (result.status !== 0) {
		return {
			status: isRecoverableLedgerError(output) ? DEPLOYED_LEDGER_STATUS.PENDING : DEPLOYED_LEDGER_STATUS.FAILED,
			ok: false,
			output,
			error: output || `exit ${result.status}`,
			summary: parseLedgerSummary(output),
			transport: 'clasp-cli',
		};
	}
	let response = null;
	try {
		response = JSON.parse(stdout);
	} catch {
		return {
			status: isRecoverableLedgerError(output) ? DEPLOYED_LEDGER_STATUS.PENDING : DEPLOYED_LEDGER_STATUS.FAILED,
			ok: false,
			output,
			error: `clasp returned non-JSON output: ${stdout || stderr}`,
			summary: parseLedgerSummary(output),
			transport: 'clasp-cli',
		};
	}
	const value = response && (response.response || response.result) ? (response.response || response.result) : response;
	if (!value || value.ok !== true) {
		return {
			status: isRecoverableLedgerError(stdout) ? DEPLOYED_LEDGER_STATUS.PENDING : DEPLOYED_LEDGER_STATUS.FAILED,
			ok: false,
			output: stdout,
			error: stdout,
			summary: parseLedgerSummary(stdout),
			response: value,
			transport: 'clasp-cli',
		};
	}
	return { ...buildLedgerResultFromValue(value, receipt), transport: 'clasp-cli' };
}

async function invokeRecordPublishedBatchViaApi(receipt, options = {}) {
	validatePublishReceipt(receipt);
	const user = claspUser(options);
	const preflight = options.skipPreflight ? { ok: true } : await preflightClaspCredentials({ ...options, claspUser: user });
	if (!preflight.ok) {
		return {
			status: DEPLOYED_LEDGER_STATUS.PENDING,
			ok: false,
			output: preflight.message,
			error: `${preflight.action} ${preflight.reason}`,
			summary: parseLedgerSummary(''),
			preflight,
			transport: 'apps-script-api',
		};
	}
	try {
		const response = await fetchWithTimeout(`https://script.googleapis.com/v1/scripts/${SCRIPT_ID}:run`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${preflight.accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				function: 'recordPublishedBatch',
				parameters: [receipt],
				devMode: options.devMode !== false,
			}),
		});
		const body = await response.json();
		if (!response.ok || body.error) {
			const errorText = JSON.stringify(body.error || body);
			return {
				status: isRecoverableLedgerError(errorText) ? DEPLOYED_LEDGER_STATUS.PENDING : DEPLOYED_LEDGER_STATUS.FAILED,
				ok: false,
				output: errorText,
				error: body.error?.message || errorText,
				summary: parseLedgerSummary(''),
				transport: 'apps-script-api',
			};
		}
		const value = body.response?.result;
		if (!value || value.ok !== true) {
			const errorText = JSON.stringify(value || body);
			return {
				status: isRecoverableLedgerError(errorText) ? DEPLOYED_LEDGER_STATUS.PENDING : DEPLOYED_LEDGER_STATUS.FAILED,
				ok: false,
				output: errorText,
				error: errorText,
				summary: parseLedgerSummary(''),
				response: value,
				transport: 'apps-script-api',
			};
		}
		return { ...buildLedgerResultFromValue(value, receipt), transport: 'apps-script-api' };
	} catch (error) {
		return {
			status: DEPLOYED_LEDGER_STATUS.PENDING,
			ok: false,
			output: String(error.message || error),
			error: String(error.message || error),
			summary: parseLedgerSummary(''),
			transport: 'apps-script-api',
		};
	}
}

export async function invokeClaspRecordPublishedBatch(receipt, options = {}) {
	if (options.submit) {
		const submitted = options.submit(receipt);
		return submitted && typeof submitted.then === 'function' ? await submitted : submitted;
	}
	const preferCli = process.env.HOTWORD_LEDGER_TRANSPORT?.trim() === 'clasp-cli';
	if (preferCli) {
		return invokeRecordPublishedBatchViaClaspCli(receipt, options);
	}
	const apiResult = await invokeRecordPublishedBatchViaApi(receipt, options);
	if (apiResult.ok) return apiResult;
	if (apiResult.status === DEPLOYED_LEDGER_STATUS.FAILED && !isRecoverableLedgerError(apiResult.error || apiResult.output)) {
		return apiResult;
	}
	const cliResult = invokeRecordPublishedBatchViaClaspCli(receipt, options);
	if (cliResult.ok) return cliResult;
	if (apiResult.status === DEPLOYED_LEDGER_STATUS.PENDING || cliResult.status === DEPLOYED_LEDGER_STATUS.PENDING) {
		return {
			...cliResult,
			status: DEPLOYED_LEDGER_STATUS.PENDING,
			output: `${apiResult.error || apiResult.output}; clasp-cli fallback: ${cliResult.error || cliResult.output}`,
			error: cliResult.error || apiResult.error,
		};
	}
	return cliResult;
}

export async function backfillPublishedBatchReceipt(receipt, options = {}) {
	validatePublishReceipt(receipt);
	return invokeClaspRecordPublishedBatch(receipt, { ...options, forceBackfill: true });
}

export async function persistAndSubmitLedger(receipt, options = {}) {
	const saved = savePendingReceipt(receipt, {
		rootDir: options.rootDir,
		sourceReceiptPath: options.sourceReceiptPath,
		ledgerStatus: DEPLOYED_LEDGER_STATUS.PENDING,
	});
	if (!options.forceBackfill) {
		const recordedKeys = findRecordedInterventionKeys(options.rootDir);
		if (shouldSkipIntervention(receipt, recordedKeys)) {
			markPendingRecorded(saved.path, {
				recordedAt: new Date().toISOString(),
				interventionIds: saved.envelope.interventionIds,
				baselineDataDates: saved.envelope.baselineDataDates,
			});
			return {
				status: DEPLOYED_LEDGER_STATUS.RECORDED,
				ok: true,
				skipped: true,
				pendingPath: saved.path,
				output: `SKIP ledger writeback batch=${receipt.common.batchId} interventions already recorded`,
				summary: { batchId: receipt.common.batchId, interventionIds: saved.envelope.interventionIds, baselineDataDates: saved.envelope.baselineDataDates, deployedAt: receipt.common.deployedAt },
				error: '',
			};
		}
	}
	let result;
	try {
		result = await invokeClaspRecordPublishedBatch(receipt, options);
	} catch (error) {
		result = {
			status: DEPLOYED_LEDGER_STATUS.PENDING,
			ok: false,
			output: String(error.message || error),
			error: String(error.message || error),
			summary: { batchId: receipt.common.batchId, interventionIds: [], baselineDataDates: [] },
		};
	}
	if (result.status === DEPLOYED_LEDGER_STATUS.RECORDED) {
		markPendingRecorded(saved.path, {
			recordedAt: new Date().toISOString(),
			interventionIds: result.summary?.interventionIds || [],
			baselineDataDates: result.summary?.baselineDataDates || [],
		});
	} else {
		markPendingAttempt(saved.path, { ledgerStatus: result.status, error: result.error || result.output });
	}
	return { ...result, skipped: false, pendingPath: saved.path };
}

export async function retryPendingReceipts(options = {}) {
	const pending = options.pendingFiles || [];
	const results = [];
	let skipped = 0;
	for (const entry of pending) {
		const filePath = entry.filePath || entry;
		const envelope = entry.envelope || null;
		const receipt = envelope?.receipt;
		if (!receipt) continue;
		try {
			const recordedKeys = findRecordedInterventionKeys(options.rootDir);
			const batchId = asString(receipt.common.batchId);
			const siteId = asString(receipt.common.siteId);
			const productionUrl = asString(receipt.common.productionUrl);
			const duplicateKeys = receipt.interventions
				.map((item) => interventionDedupeKey(batchId, siteId, item.primaryUrl, item.action, primaryTargetQuery(item), productionUrl))
				.filter((key) => recordedKeys.has(key));
			if (duplicateKeys.length === receipt.interventions.length) {
				markPendingRecorded(filePath, { recordedAt: new Date().toISOString() });
				results.push({ filePath, status: DEPLOYED_LEDGER_STATUS.RECORDED, ok: true, skipped: true, output: 'already recorded' });
				skipped += 1;
				continue;
			}
			const result = await invokeClaspRecordPublishedBatch(receipt, options);
			if (result.status === DEPLOYED_LEDGER_STATUS.RECORDED) {
				markPendingRecorded(filePath, {
					recordedAt: new Date().toISOString(),
					interventionIds: result.summary?.interventionIds || [],
					baselineDataDates: result.summary?.baselineDataDates || [],
				});
			} else {
				markPendingAttempt(filePath, { ledgerStatus: result.status, error: result.error || result.output });
			}
			results.push({ filePath, skipped: false, ...result });
		} catch (error) {
			const message = String(error.message || error);
			markPendingAttempt(filePath, { ledgerStatus: DEPLOYED_LEDGER_STATUS.PENDING, error: message });
			results.push({
				filePath,
				skipped: false,
				status: DEPLOYED_LEDGER_STATUS.PENDING,
				ok: false,
				output: message,
				error: message,
			});
		}
	}
	const recorded = results.filter((item) => item.status === DEPLOYED_LEDGER_STATUS.RECORDED && !item.skipped).length;
	const pendingCount = results.filter((item) => item.status === DEPLOYED_LEDGER_STATUS.PENDING).length;
	const failed = results.filter((item) => item.status === DEPLOYED_LEDGER_STATUS.FAILED).length;
	return { results, recorded, skipped, pendingCount, failed };
}

export async function backfillPendingPublishReceipts(options = {}) {
	const siteId = options.siteId || '';
	const excludeBatchId = asString(options.excludeBatchId);
	const pending = listPendingReceipts({ rootDir: options.rootDir, siteId }).filter(
		({ envelope }) => !excludeBatchId || envelope.batchId !== excludeBatchId,
	);
	if (!pending.length) {
		return { recorded: 0, skipped: 0, pendingCount: 0, failed: 0, results: [] };
	}
	return retryPendingReceipts({ ...options, pendingFiles: pending });
}

export async function finalizeLedgerWriteback(receipt, options = {}) {
	const current = await persistAndSubmitLedger(receipt, options);
	const backfill = await backfillPendingPublishReceipts({
		...options,
		excludeBatchId: asString(receipt.common.batchId),
	});
	return { current, backfill };
}

export function exitCodeForLedgerStatus(status) {
	if (status === DEPLOYED_LEDGER_STATUS.RECORDED || status === LEDGER_STATUS.RECORDED) return EXIT.RECORDED;
	if (status === DEPLOYED_LEDGER_STATUS.PENDING || status === LEDGER_STATUS.LEDGER_PENDING) return EXIT.WRITEBACK_PENDING;
	return EXIT.RECEIPT_FAILED;
}

export function exitCodeForCompletionStatus(status) {
	if (status === PUBLISH_COMPLETION_STATUS.COMPLETE) return EXIT.RECORDED;
	if (status === PUBLISH_COMPLETION_STATUS.WRITEBACK_PENDING) return EXIT.WRITEBACK_PENDING;
	if (status === PUBLISH_COMPLETION_STATUS.RECEIPT_FAILED) return EXIT.RECEIPT_FAILED;
	return EXIT.LEDGER_FAILED;
}
