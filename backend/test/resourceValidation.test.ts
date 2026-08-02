/**
 * What a Batch Resource is allowed to be ⟨CP5⟩.
 *
 * The load-bearing property is the one a naive check misses: `.docx`, `.pptx`,
 * `.xlsx`, a renamed `.jar`, and a plain `.zip` all begin with the same four
 * bytes. A magic-byte test accepts an executable JAR renamed to `.docx`, and
 * looks thorough while doing it.
 *
 * These tests build real ZIP containers byte by byte — no fixture files are
 * committed and nothing on disk is needed — so the discrimination is exercised
 * against the actual structure rather than against a mock that agrees with it.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';

import type {ValidatedFile} from '../src/cloudCode/modules/BatchResource/fileValidation';
import type {ResourceErrorCode} from '../src/cloudCode/modules/BatchResource/errors';
import {clearTrackedIntervals, installParseTestGlobal} from './support/parseTestGlobal';

let validation: typeof import('../src/cloudCode/modules/BatchResource/fileValidation');
let constants: typeof import('../src/cloudCode/modules/BatchResource/constants');
let errors: typeof import('../src/cloudCode/modules/BatchResource/errors');

before(async () => {
  installParseTestGlobal();
  validation = await import('../src/cloudCode/modules/BatchResource/fileValidation');
  constants = await import('../src/cloudCode/modules/BatchResource/constants');
  errors = await import('../src/cloudCode/modules/BatchResource/errors');
});

after(() => clearTrackedIntervals());

// ═══════════════════════════════════════════════════════════════════════════
// Builders — real files, made here rather than committed
// ═══════════════════════════════════════════════════════════════════════════

/** A structurally real ZIP containing exactly the named entries. */
function buildZip(entries: {name: string; content?: string}[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content ?? '', 'utf8');
    const compressed = deflateRawSync(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const localRecord = Buffer.concat([local, nameBytes, compressed]);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);

    centrals.push(Buffer.concat([central, nameBytes]));
    locals.push(localRecord);
    offset += localRecord.length;
  }

  const centralBlock = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBlock.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBlock, end]);
}

/** An OOXML package: `[Content_Types].xml` plus the folder that names the type. */
const ooxml = (folder: string) =>
  buildZip([
    {name: '[Content_Types].xml', content: '<Types/>'},
    {name: `${folder}/document.xml`, content: '<w:document/>'},
    {name: '_rels/.rels', content: '<Relationships/>'},
  ]);

const docx = () => ooxml('word');
const pptx = () => ooxml('ppt');
const xlsx = () => ooxml('xl');

/** A JAR: a ZIP with a manifest and **no** `[Content_Types].xml`. */
const jar = () =>
  buildZip([
    {name: 'META-INF/MANIFEST.MF', content: 'Manifest-Version: 1.0'},
    {name: 'Main.class', content: 'class bytes'},
  ]);

const pdf = () => Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const html = () => Buffer.from('<!doctype html><html><body><p>Week one</p></body></html>');
const txt = () => Buffer.from('Week one reading list\nChapter 1\n');
const markdown = () => Buffer.from('# Week one\n\n- Chapter 1\n');

/** A Windows executable: `MZ`, then a NUL-filled header. */
const exe = () => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0x00), Buffer.from('PE\0\0')]);

// ═══════════════════════════════════════════════════════════════════════════
// Assertions
// ═══════════════════════════════════════════════════════════════════════════

/** Assert the upload is accepted, and hand back what it was decided to be. */
function accepted(filename: string, mime: string, buffer: Buffer): ValidatedFile {
  const result = validation.validateUploadedFile({
    originalName: filename,
    declaredMimeType: mime,
    buffer,
  });
  assert.equal(result.ok, true, `${filename} must be accepted`);
  if (!result.ok) throw new Error('unreachable');
  return result.file;
}

/** Assert the upload is refused, and hand back the code the caller would see. */
function refused(filename: string, mime: string, buffer: Buffer): ResourceErrorCode {
  const result = validation.validateUploadedFile({
    originalName: filename,
    declaredMimeType: mime,
    buffer,
  });
  assert.equal(result.ok, false, `${filename} must be refused`);
  if (result.ok) throw new Error('unreachable');
  return result.reason.code;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('the accepted formats', () => {
  test('are exactly the eight the product decided on', () => {
    assert.deepEqual(
      [...constants.RESOURCE_EXTENSIONS],
      ['.pdf', '.html', '.htm', '.docx', '.pptx', '.xlsx', '.txt', '.md']
    );
  });

  test('every one of them is accepted, with real bytes', () => {
    const cases: [string, string, Buffer, string][] = [
      ['week-1.pdf', 'application/pdf', pdf(), 'application/pdf'],
      ['notes.html', 'text/html', html(), 'text/html'],
      ['notes.htm', 'text/html', html(), 'text/html'],
      [
        'brief.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        docx(),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      [
        'deck.pptx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        pptx(),
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ],
      [
        'data.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        xlsx(),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      ['readme.txt', 'text/plain', txt(), 'text/plain'],
      ['readme.md', 'text/markdown', markdown(), 'text/markdown'],
    ];

    for (const [name, mime, bytes, storedMime] of cases) {
      assert.equal(accepted(name, mime, bytes).mimeType, storedMime, name);
    }
  });

  test('the stored MIME type comes from the table, never from the browser', () => {
    // A browser is entitled to say `application/octet-stream` for a PDF. What
    // gets stored — and therefore what a later download is served as — stays the
    // product's decision.
    assert.equal(
      accepted('week-1.pdf', 'application/octet-stream', pdf()).mimeType,
      'application/pdf'
    );
    assert.equal(
      accepted('readme.md', 'application/octet-stream', markdown()).mimeType,
      'text/markdown'
    );
  });

  test('a browser that says nothing at all is not punished for it', () => {
    // Some clients send no type. That is not evidence of anything — but the
    // bytes still have to match.
    assert.equal(accepted('week-1.pdf', '', pdf()).kind, 'pdf');
    assert.equal(refused('week-1.pdf', '', exe()), errors.ResourceError.RESOURCE_TYPE_NOT_ALLOWED);
  });

  test('only a MIME type this product serves can ever be stored', () => {
    for (const mime of constants.RESOURCE_STORED_MIME_TYPES) {
      assert.ok(constants.isStorableMimeType(mime), mime);
    }
    for (const rejected of ['application/x-msdownload', 'image/svg+xml', 'application/zip', '']) {
      assert.equal(constants.isStorableMimeType(rejected), false, rejected);
    }
  });

  test('`.htm` and `.html` are one kind, so the UI need not know the difference', () => {
    assert.equal(accepted('notes.htm', 'text/html', html()).kind, 'html');
    assert.equal(accepted('notes.html', 'text/html', html()).kind, 'html');
  });
});

describe('the ZIP formats, which share a signature', () => {
  test('a .docx is not accepted as a .pptx', () => {
    // Same four leading bytes, different package. This is the check a magic-byte
    // test cannot make.
    refused(
      'deck.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      docx()
    );
  });

  test('a .pptx is not accepted as an .xlsx', () => {
    refused('data.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx());
  });

  test('a JAR renamed to .docx is refused', () => {
    // The attack the container check exists for: a JAR is a ZIP, and its first
    // four bytes are identical to a Word document's.
    assert.equal(
      refused(
        'invoice.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        jar()
      ),
      errors.ResourceError.RESOURCE_TYPE_NOT_ALLOWED
    );
  });

  test('a plain ZIP renamed to .xlsx is refused', () => {
    const plain = buildZip([{name: 'holiday-photo.jpg', content: 'not a spreadsheet'}]);
    refused('data.xlsx', 'application/zip', plain);
  });

  test('an empty archive is refused', () => {
    // A ZIP with no entries is a valid ZIP and is not a document.
    const emptyArchive = buildZip([]);
    refused(
      'brief.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      emptyArchive
    );
  });

  test('reading entry names never decompresses anything', () => {
    // A name table is inert, which is why no ZIP library was added.
    const names = validation.zipEntryNames(docx());
    assert.ok(names.includes('[Content_Types].xml'));
    assert.ok(names.some(name => name.startsWith('word/')));
  });

  test('a malformed archive yields no names rather than throwing', () => {
    const rubbish = Buffer.concat([Buffer.from('PK'), Buffer.alloc(200, 0x41)]);
    assert.doesNotThrow(() => validation.zipEntryNames(rubbish));
  });

  test('a crafted archive cannot make the scan run away', () => {
    const many = buildZip(
      Array.from({length: 40}, (_, index) => ({name: `entry-${index}.xml`, content: 'x'}))
    );
    assert.ok(validation.zipEntryNames(many, 5).length <= 5);
  });
});

describe('disguised and hostile files', () => {
  test('an executable renamed to .pdf is refused', () => {
    assert.equal(
      refused('report.pdf', 'application/pdf', exe()),
      errors.ResourceError.RESOURCE_TYPE_NOT_ALLOWED
    );
  });

  test('an executable renamed to .txt is refused', () => {
    // Text has no signature, so the heuristic has to catch this one: a NUL byte
    // does not appear in something somebody typed.
    refused('readme.txt', 'text/plain', exe());
  });

  test('a double extension resolves to the last one and is refused', () => {
    // `report.pdf.exe` is an `.exe`. It fails on the ordinary rule rather than
    // needing a special case.
    assert.equal(validation.extensionOf('report.pdf.exe'), '.exe');
    refused('report.pdf.exe', 'application/pdf', pdf());
  });

  test('a script hidden behind a document extension is refused', () => {
    assert.equal(
      refused('setup.md.sh', 'text/markdown', markdown()),
      errors.ResourceError.RESOURCE_TYPE_NOT_ALLOWED
    );
  });

  test('every forbidden extension is refused whatever the bytes say', () => {
    for (const extension of constants.FORBIDDEN_EXTENSIONS) {
      assert.equal(
        refused(`payload${extension}`, 'application/pdf', pdf()),
        errors.ResourceError.RESOURCE_TYPE_NOT_ALLOWED,
        extension
      );
    }
  });

  test('an unsupported but harmless extension is refused too', () => {
    // The allow-list is closed. `.csv` is not dangerous; it is simply not one of
    // the eight, and widening the list is a product decision, not a code one.
    for (const name of ['photo.png', 'clip.mp4', 'archive.tar', 'sheet.csv', 'doc.rtf']) {
      refused(name, 'application/octet-stream', txt());
    }
  });

  test('a file with no extension is refused', () => {
    refused('README', 'text/plain', txt());
  });

  test('a MIME type that contradicts the extension is refused', () => {
    // The browser said PDF; the name says `.txt`. One of them is wrong and there
    // is no reason to guess which.
    assert.equal(
      refused('notes.txt', 'application/pdf', txt()),
      errors.ResourceError.RESOURCE_TYPE_NOT_ALLOWED
    );
  });

  test('a MIME type carrying parameters is still matched on its type', () => {
    // `text/plain; charset=utf-8` is a perfectly ordinary thing to send.
    assert.equal(accepted('readme.txt', 'text/plain; charset=utf-8', txt()).extension, '.txt');
  });
});

describe('size and emptiness', () => {
  test('the limit is 20 MiB', () => {
    assert.equal(constants.RESOURCE_MAX_BYTES, 20 * 1024 * 1024);
  });

  test('an empty file is refused as empty, not as the wrong type', () => {
    assert.equal(
      refused('week-1.pdf', 'application/pdf', Buffer.alloc(0)),
      errors.ResourceError.RESOURCE_EMPTY
    );
  });

  test('a file one byte over the limit is refused', () => {
    const oversized = Buffer.alloc(constants.RESOURCE_MAX_BYTES + 1);
    oversized.write('%PDF-1.7');
    assert.equal(
      refused('big.pdf', 'application/pdf', oversized),
      errors.ResourceError.RESOURCE_TOO_LARGE
    );
  });

  test('a file exactly at the limit is accepted', () => {
    // The boundary itself is allowed. "Up to 20 MiB" has to mean 20 MiB, or the
    // number shown in the UI is a lie by one byte.
    const exact = Buffer.alloc(constants.RESOURCE_MAX_BYTES);
    exact.write('%PDF-1.7');
    assert.equal(accepted('big.pdf', 'application/pdf', exact).size, constants.RESOURCE_MAX_BYTES);
  });

  test('size is judged before type, so an enormous file is cheap to refuse', () => {
    const oversized = Buffer.alloc(constants.RESOURCE_MAX_BYTES + 1);
    assert.equal(
      refused('payload.exe', 'application/octet-stream', oversized),
      errors.ResourceError.RESOURCE_TOO_LARGE
    );
  });
});

describe('filenames', () => {
  test('a directory traversal is reduced to a bare name', () => {
    assert.equal(validation.sanitiseFilename('../../etc/passwd'), 'passwd');
    assert.equal(validation.sanitiseFilename('..\\..\\windows\\system32\\cmd'), 'cmd');
    assert.equal(validation.sanitiseFilename('/absolute/path/week-1.pdf'), 'week-1.pdf');
  });

  test('a name that would inject a header is stripped of the means', () => {
    // A CR or LF in a filename lands in `Content-Disposition`, where a newline
    // starts a second header. Both go, and so does the colon.
    const safe = validation.sanitiseFilename('week1\r\nSet-Cookie: admin=1.pdf');
    assert.ok(!safe.includes('\r'), 'no carriage return');
    assert.ok(!safe.includes('\n'), 'no newline');
    assert.ok(!safe.includes(':'), 'no colon to open a header value');
  });

  test('quotes and semicolons, which would end a header parameter, are stripped', () => {
    const safe = validation.sanitiseFilename('week"1;evil.pdf');
    assert.ok(!safe.includes('"'));
    assert.ok(!safe.includes(';'));
  });

  test('a leading dot is removed, so nothing becomes a hidden file', () => {
    assert.ok(!validation.sanitiseFilename('.htaccess').startsWith('.'));
  });

  test('an empty or nonsense name still produces something usable', () => {
    for (const input of ['', '   ', '///', null, undefined, 42, {}]) {
      assert.ok(validation.sanitiseFilename(input).length > 0, String(input));
    }
  });

  test('a very long name is shortened but keeps its extension', () => {
    const safe = validation.sanitiseFilename(`${'a'.repeat(500)}.pdf`);
    assert.ok(safe.length <= constants.RESOURCE_LIMITS.filename.max);
    assert.ok(safe.endsWith('.pdf'), 'losing the extension would be worse than being long');
  });

  test('an Arabic filename survives intact', () => {
    // Non-ASCII is not dangerous; it is somebody's language. This product is
    // bilingual, and a stripped filename would be a bug, not a safeguard.
    const safe = validation.sanitiseFilename('الأسبوع-الأول.pdf');
    assert.ok(safe.includes('الأسبوع'));
    assert.ok(safe.endsWith('.pdf'));
  });

  test('the sanitised name is the one that gets stored', () => {
    assert.equal(accepted('../../week 1.pdf', 'application/pdf', pdf()).filename, 'week 1.pdf');
  });
});

describe('the text heuristic', () => {
  test('accepts ordinary text, including Arabic and emoji', () => {
    assert.ok(validation.looksLikeText(Buffer.from('Hello, world.\nSecond line.\n')));
    assert.ok(validation.looksLikeText(Buffer.from('مرحباً بالعالم')));
    assert.ok(validation.looksLikeText(Buffer.from('Week one 🎉')));
  });

  test('accepts a UTF-8 byte-order mark', () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Week one')]);
    assert.ok(validation.looksLikeText(withBom));
  });

  test('refuses anything containing a NUL byte', () => {
    assert.equal(validation.looksLikeText(Buffer.from([0x41, 0x00, 0x42])), false);
  });

  test('refuses an empty buffer', () => {
    assert.equal(validation.looksLikeText(Buffer.alloc(0)), false);
  });
});
