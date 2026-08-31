'use strict';
const fs=require('fs'),assert=require('assert'),root=__dirname+'/..',src=fs.readFileSync(root+'/RawExport.gs','utf8'),raw=fs.readFileSync(root+'/MonitoringHistory.gs','utf8'),code=fs.readFileSync(root+'/Code.gs','utf8'),hotfix=fs.readFileSync(root+'/TimeoutRetentionHotfix.gs','utf8');
assert(/function exportMonitoringRawNow\(\)/.test(src));
assert(/saveGscMonitoringRaw_\(runId, new Date\(\)\)/.test(src));
assert(/Utilities\.getUuid\(\)/.test(src));
['每日快照','GSC日数据','Query明细','Page明细','Query页面明细','URL索引','决策历史','干预观察','干预时间线'].forEach(n=>assert(raw.includes("'"+n+"'"),n));
assert(!/syncGscMonitoringHistory/.test(code+hotfix));
assert(/saveGscMonitoringRaw_\('gsc-daily-'/.test(code+hotfix));
console.log('PASS GSC RAW export contract');
