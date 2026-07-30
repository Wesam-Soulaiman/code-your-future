/**
 * Cloud Code Entry Point
 *
 * This file is the main entry for Parse Server Cloud Code.
 * It is loaded once on server start and registers:
 *   1. Models  — Parse.Object subclasses (auto-loaded from /models)
 *   2. Modules — Cloud functions and triggers (auto-loaded from /modules)
 *   3. LiveQuery hooks — beforeSubscribe guards (add below)
 *
 * Files are auto-discovered via dynamic imports — you do NOT need
 * to manually import new model or module files.
 */

import {join} from 'path';
import {importFiles} from '@90soft/parse-server-kit';

// ── 1. Import Models ─────────────────────────────────────────
// Each file in /models registers a Parse.Object subclass with schema decorators.
console.log('|||||||||||| Import Models ||||||||||||');
const mainModelsPath = join(__dirname, 'models');
importFiles(mainModelsPath);

// ── 2. Import Modules ────────────────────────────────────────
// Each file in /modules registers cloud functions and triggers.
console.log('|||||||||||| Import Modules ||||||||||||');
const mainModulesPath = join(__dirname, 'modules');
importFiles(mainModulesPath);

// ── 3. LiveQuery: beforeSubscribe Hooks ──────────────────────
// If you enable LiveQuery for any class (in parseConfig.ts → liveQuery.classNames),
// register a beforeSubscribe hook here to enforce authentication.
//
// This pattern bypasses a Parse Server 9.9.0 issue where role-based CLP
// is not properly resolved during LiveQuery subscription checks.
// Object-level ACL still controls which records each user receives.
//
// Example — uncomment and add your class names:
//
// const liveQueryClasses = ['Notification', 'ChatMessage'];
// for (const className of liveQueryClasses) {
//   (Parse.Cloud as any).beforeSubscribe(className, (request: any) => {
//     if (!request.user) {
//       throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Must be authenticated');
//     }
//   });
// }

console.log('---main.js File Initialized---');
