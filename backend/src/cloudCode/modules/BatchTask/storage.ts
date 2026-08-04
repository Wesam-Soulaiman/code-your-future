/**
 * Private storage for Task attachments ⟨CP7⟩.
 *
 * ── One GridFS layer, two key namespaces ────────────────────────────────────
 * Checkpoint 5 already solved this problem — see
 * `modules/BatchResource/storage.ts` for why `Parse.File` is unusable here and
 * how the configured `GridFSBucketAdapter` is reached in-process instead. None
 * of that is worth having twice, so this module re-exports it and adds the one
 * thing that must differ: the key prefix.
 *
 * Separate prefixes (`task_` and `resource_`) are not decoration. They mean an
 * operator reading the bucket can tell what a binary belongs to, and a cleanup
 * that ever needs to sweep one feature's files cannot accidentally take the
 * other's.
 */

import {randomBytes} from 'crypto';

import {ATTACHMENT_KEY_BYTES, ATTACHMENT_KEY_PREFIX} from './constants';

export {
  openBinaryStream,
  removeBinary,
  removeBinaryQuietly,
  storageIsUsable,
  storeBinary,
} from '../BatchResource/storage';

/**
 * A storage key nobody can guess and nothing can collide with.
 *
 * Random rather than derived: a key built from the filename would leak the
 * filename to anybody who saw a key, and one built from the Task id would let
 * somebody who knew a Task id address its bytes directly.
 */
export function newAttachmentKey(): string {
  return `${ATTACHMENT_KEY_PREFIX}${randomBytes(ATTACHMENT_KEY_BYTES).toString('hex')}`;
}
