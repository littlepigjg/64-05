import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { NotificationStorage } from '../storage';
import type { NotificationsDB } from '../types';
import type { Notification } from '../../../types';

/* ------------------------------------------------------------------ */
/*  Helpers — per-test temp dirs so there is zero cross-test pollution  */
/* ------------------------------------------------------------------ */

interface Sandbox {
  dir: string;
  cleanup: () => void;
}

function sandbox(): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-storage-test-'));
  return {
    dir,
    cleanup: () => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

function sampleNotification(id: string, createdAt: number = Date.now()): Notification {
  return {
    id,
    type: 'package_update',
    title: `${id}-update`,
    message: `1.0.0 -> 2.0.0`,
    data: {
      packageName: id,
      registry: 'npm',
      oldVersion: '1.0.0',
      newVersion: '2.0.0',
    },
    read: false,
    createdAt,
  };
}

function makeDB(count: number = 5): NotificationsDB {
  const notifications: Notification[] = [];
  for (let i = 0; i < count; i++) {
    notifications.push(sampleNotification(`n${i}`, Date.now() + i));
  }
  return {
    notifications,
    lastChecked: Date.now(),
    versionCheckResults: {
      'npm:foo': { version: '1.0.0', checkedAt: Date.now() },
    },
  };
}

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir).sort();
}

function countNotifsInFile(p: string): number {
  const json = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return Array.isArray(json.notifications) ? json.notifications.length : -1;
}

/* ------------------------------------------------------------------ */
/*  Suite                                                               */
/* ------------------------------------------------------------------ */

describe('NotificationStorage', () => {

  it('starts with an empty DB when no files exist', () => {
    const { dir, cleanup } = sandbox();
    try {
      const storage = new NotificationStorage(dir);
      const db = storage.getDB();
      assert.deepEqual(db.notifications, []);
      assert.equal(db.lastChecked, 0);
      assert.deepEqual(db.versionCheckResults, {});

      const recovery = storage.getRecoveryInfo();
      assert.equal(recovery.primaryCorrupted, false);
      assert.equal(recovery.recoveredFromBackup, false);
      assert.equal(recovery.backupsAvailable, 0);
    } finally {
      cleanup();
    }
  });

  it('persists a DB and reloads it from the primary file', () => {
    const { dir, cleanup } = sandbox();
    try {
      let storage = new NotificationStorage(dir);
      storage.getDB().notifications.push(sampleNotification('hello', 100));
      storage.getDB().lastChecked = 200;
      storage.persistNow();
      storage = null as any; // no close()

      const storage2 = new NotificationStorage(dir);
      assert.equal(storage2.getDB().notifications.length, 1);
      assert.equal(storage2.getDB().notifications[0].id, 'hello');
      assert.equal(storage2.getDB().lastChecked, 200);

      const bak1 = path.join(dir, 'notifications.json.bak.1');
      assert.ok(fs.existsSync(bak1), 'Expected .bak.1 backup to exist');
      storage2.close();
    } finally {
      cleanup();
    }
  });

  it('keeps exactly MAX_ROLLING_BACKUPS backup files after many persists', () => {
    const { dir, cleanup } = sandbox();
    try {
      const storage = new NotificationStorage(dir);

      for (let i = 0; i < 7; i++) {
        storage.getDB().notifications = [sampleNotification(`v${i}`)];
        storage.persistNow();
      }

      const files = listFiles(dir);
      const backups = files.filter((f) => f.includes('.bak.'));
      assert.equal(
        backups.length,
        5,
        `Expected 5 backup files, got ${backups.length}: ${backups.join(', ')}`
      );
      for (let i = 1; i <= 5; i++) {
        assert.ok(
          files.includes(`notifications.json.bak.${i}`),
          `Expected notifications.json.bak.${i} to exist; files = ${files.join(', ')}`
        );
      }
      assert.equal(files.includes('notifications.json.bak.6'), false);
      storage.close();
    } finally {
      cleanup();
    }
  });

  it('recovers from backup when primary has JSON syntax error', () => {
    const { dir, cleanup } = sandbox();
    try {
      // 1) Seed a healthy DB with 10 notifs.
      let storage = new NotificationStorage(dir);
      const seed = makeDB(10);
      Object.assign(storage.getDB(), seed);
      storage.persistNow();
      storage = null as any; // no close()

      // 2) Corrupt the primary.
      fs.writeFileSync(path.join(dir, 'notifications.json'), '{this is not json', 'utf-8');

      // 3) Restart the storage.
      storage = new NotificationStorage(dir);
      const recovery = storage.getRecoveryInfo();

      assert.equal(recovery.primaryCorrupted, true);
      assert.equal(recovery.recoveredFromBackup, true);
      assert.ok(recovery.backupUsed, 'backupUsed should be set');
      // backupsAvailable is counted at DISCOVERY time (before recovery write-back
      // creates an extra bak), so == 1 original backup here.
      assert.equal(
        recovery.backupsAvailable,
        1,
        `Expected 1 backup counted at discovery time, got ${recovery.backupsAvailable}`
      );
      assert.equal(recovery.backupsFailed, 0);
      assert.equal(
        storage.getDB().notifications.length,
        10,
        'All 10 notifications must be preserved from backup'
      );

      // Corrupted primary must have been quarantined.
      const corrupted = listFiles(dir).filter((f) => f.includes('.corrupted'));
      assert.equal(corrupted.length, 1, `Expected 1 quarantined file, got ${corrupted.join(', ')}`);
      // Fresh healthy primary.
      assert.ok(fs.existsSync(path.join(dir, 'notifications.json')));
      assert.doesNotThrow(() => JSON.parse(
        fs.readFileSync(path.join(dir, 'notifications.json'), 'utf-8')
      ));
      storage.close();
    } finally {
      cleanup();
    }
  });

  it('recovers newest-valid backup first, falling through broken newer backups', () => {
    const { dir, cleanup } = sandbox();
    try {
      let storage = new NotificationStorage(dir);
      storage.getDB().notifications.push(sampleNotification('a', 1));
      storage.persistNow();
      storage.getDB().notifications.push(sampleNotification('b', 2));
      storage.persistNow();
      storage.getDB().notifications.push(sampleNotification('c', 3));
      storage.persistNow();
      storage = null as any; // no close()

      // At this point the rotation state (verified empirically via debug above)
      // stores a 3-notif snapshot in bak.2 due to the recovery-write-back step
      // also writing when instantiated. We just validate:
      //   * primary = corrupted
      //   * bak.1 = corrupted
      //   => the FIRST valid backup encountered (sorted by mtime desc) is used.
      fs.writeFileSync(path.join(dir, 'notifications.json'), 'garbage', 'utf-8');
      fs.writeFileSync(path.join(dir, 'notifications.json.bak.1'), 'also garbage', 'utf-8');

      storage = new NotificationStorage(dir);
      const recovery = storage.getRecoveryInfo();

      assert.equal(recovery.primaryCorrupted, true);
      assert.equal(recovery.recoveredFromBackup, true);
      assert.ok(
        recovery.backupUsed && recovery.backupUsed.endsWith('.bak.2'),
        `Expected recovery from bak.2, used: ${recovery.backupUsed}`
      );
      assert.equal(
        recovery.backupsFailed,
        1,
        `Expected 1 failed backup (bak.1), got ${recovery.backupsFailed}`
      );
      // bak.2 in this exact scenario: after 3 persists it holds the state
      // after persist #2 = 2 notifications.
      assert.equal(
        storage.getDB().notifications.length,
        2,
        `Expected 2 notifs from bak.2 (persist #2 snapshot), got ${storage.getDB().notifications.length}`
      );
      storage.close();
    } finally {
      cleanup();
    }
  });

  it('falls back to empty DB when all files are broken, with full logging + quarantine', () => {
    const { dir, cleanup } = sandbox();
    try {
      let storage = new NotificationStorage(dir);
      storage.getDB().notifications.push(sampleNotification('a'));
      storage.persistNow();
      storage.getDB().notifications.push(sampleNotification('b'));
      storage.persistNow();
      storage = null as any; // no close()

      // Corrupt primary + bak.1 + bak.2.
      fs.writeFileSync(path.join(dir, 'notifications.json'), 'nope', 'utf-8');
      fs.writeFileSync(path.join(dir, 'notifications.json.bak.1'), 'broken', 'utf-8');
      fs.writeFileSync(path.join(dir, 'notifications.json.bak.2'), 'broken too', 'utf-8');

      storage = new NotificationStorage(dir);
      const recovery = storage.getRecoveryInfo();

      assert.equal(recovery.primaryCorrupted, true);
      assert.equal(
        recovery.backupsAvailable,
        2,
        `Expected 2 original backups (counted before any recovery write-back), got ${recovery.backupsAvailable}`
      );
      assert.equal(recovery.backupsFailed, 2);
      assert.equal(recovery.recoveredFromBackup, false);
      assert.deepEqual(storage.getDB().notifications, []);
      assert.equal(
        recovery.errors.length,
        3,
        `Expected exactly 3 errors (1 primary + 2 backups), got ${recovery.errors.length}: ${recovery.errors.join(' / ')}`
      );
      storage.close();
    } finally {
      cleanup();
    }
  });

  it('refuses to persist an invalid DB and records the error', () => {
    const { dir, cleanup } = sandbox();
    try {
      const storage = new NotificationStorage(dir);
      const badDb = storage.getDB() as any;
      badDb.notifications = 'NOT AN ARRAY';

      assert.throws(() => storage.persistNow());

      const diag = storage.getDiagnostics();
      assert.ok(
        diag.lastPersistError !== null && diag.lastPersistError.includes('Shape does not match'),
        `Expected meaningful lastPersistError, got: ${diag.lastPersistError}`
      );
    } finally {
      cleanup();
    }
  });

  it('populates diagnostics with backup list and persist timestamps', () => {
    const { dir, cleanup } = sandbox();
    try {
      const storage = new NotificationStorage(dir);
      const before = Date.now();
      storage.getDB().notifications.push(sampleNotification('a'));
      storage.persistNow();

      const diag = storage.getDiagnostics();
      assert.ok(diag.primaryPath.endsWith('notifications.json'));
      assert.equal(diag.backups.length, 1);
      assert.ok(diag.lastPersistAt != null && diag.lastPersistAt >= before);
      assert.equal(diag.lastPersistError, null);
      assert.ok(diag.backups[0].path.endsWith('.bak.1'));
      assert.ok(diag.backups[0].size > 0);
      assert.ok(diag.backups[0].modifiedAt >= before);
      storage.close();
    } finally {
      cleanup();
    }
  });

  // ------------------------------------------------------------------
  // Extra regression tests that directly exercise the backup-contents
  // contract so we never get confused about which bak.N holds which data.
  // ------------------------------------------------------------------

  it('rotation invariant: persist N writes snapshot N into bak.1, shift the rest', () => {
    const { dir, cleanup } = sandbox();
    try {
      const storage = new NotificationStorage(dir);

      storage.getDB().notifications = [sampleNotification('a')];
      storage.persistNow();
      assert.equal(countNotifsInFile(path.join(dir, 'notifications.json.bak.1')), 1);

      storage.getDB().notifications = [sampleNotification('a'), sampleNotification('b')];
      storage.persistNow();
      assert.equal(countNotifsInFile(path.join(dir, 'notifications.json.bak.1')), 2);
      assert.equal(countNotifsInFile(path.join(dir, 'notifications.json.bak.2')), 1);

      storage.getDB().notifications = [
        sampleNotification('a'), sampleNotification('b'), sampleNotification('c'),
      ];
      storage.persistNow();
      assert.equal(countNotifsInFile(path.join(dir, 'notifications.json.bak.1')), 3);
      assert.equal(countNotifsInFile(path.join(dir, 'notifications.json.bak.2')), 2);
      assert.equal(countNotifsInFile(path.join(dir, 'notifications.json.bak.3')), 1);

      storage.close();
    } finally {
      cleanup();
    }
  });
});
