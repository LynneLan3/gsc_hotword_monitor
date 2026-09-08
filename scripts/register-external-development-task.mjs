#!/usr/bin/env node

/**
 * Register an already-approved external Research Pack into the existing
 * 「开发任务」Sheet via Apps Script registerExternalDevelopmentTask.
 *
 * Usage:
 *   node scripts/register-external-development-task.mjs '<json>'
 *   node scripts/register-external-development-task.mjs --file ./task.json
 *
 * Prints one machine-readable JSON object on success.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	EXIT,
	preflightClaspCredentials,
	runAppsScriptFunction,
} from './lib/ledger-receipt-client.mjs';

function usage() {
	return [
		'Usage:',
		"  node scripts/register-external-development-task.mjs '<json>'",
		'  node scripts/register-external-development-task.mjs --file <path.json>',
	].join('\n');
}

function parseArgv(argv) {
	if (!argv.length) throw new Error(usage());
	if (argv[0] === '--file' || argv[0] === '-f') {
		const filePath = argv[1];
		if (!filePath) throw new Error('--file requires a path');
		return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
	}
	if (argv[0] === '--help' || argv[0] === '-h') {
		throw new Error(usage());
	}
	return JSON.parse(argv[0]);
}

function validateInput(input) {
	const required = ['siteId', 'pagePath', 'actionType', 'taskType', 'taskReason', 'priority', 'sourceReference'];
	const missing = required.filter((key) => !String(input?.[key] ?? '').trim());
	const hasSiteOrGame = String(input?.site || input?.game || input?.siteOrGame || input?.['site/game'] || '').trim();
	if (!hasSiteOrGame) missing.push('site|game');
	if (!String(input?.evidenceReference || input?.EvidenceReference || '').trim() &&
		!String(input?.sourceReference || '').trim()) {
		missing.push('evidenceReference');
	}
	if (missing.length) {
		throw new Error(`missing required fields: ${missing.join(', ')}`);
	}
	return input;
}

async function main() {
	let input;
	try {
		input = validateInput(parseArgv(process.argv.slice(2)));
	} catch (error) {
		console.error(`FAIL ${error.message}`);
		process.exit(EXIT.INVALID_INPUT);
	}

	const preflight = await preflightClaspCredentials();
	if (!preflight.ok) {
		console.error(`${preflight.action} ${preflight.reason}: ${preflight.message}`);
		process.exit(EXIT.WRITEBACK_PENDING);
	}

	const result = await runAppsScriptFunction('registerExternalDevelopmentTask', [input], {
		accessToken: preflight.accessToken,
		skipPreflight: true,
	});
	if (!result.ok) {
		console.error(`FAIL ${result.error || result.output}`);
		process.exit(result.status === 'PENDING' ? EXIT.WRITEBACK_PENDING : EXIT.LEDGER_FAILED);
	}

	const value = result.value;
	if (!value || value.ok !== true || !value.DevelopmentTaskID) {
		console.error(`FAIL invalid registration response: ${JSON.stringify(value)}`);
		process.exit(EXIT.LEDGER_FAILED);
	}

	console.log(JSON.stringify(value));
	process.exit(EXIT.RECORDED);
}

main().catch((error) => {
	console.error(`FAIL ${error.message || error}`);
	process.exit(EXIT.LEDGER_FAILED);
});
