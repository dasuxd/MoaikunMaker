/**
 * ROM-independent level file import/export.
 *
 * The file deliberately stores only map/enemy bytes plus descriptive metadata.
 * ROM addresses, mapper type and editor internals are never serialized.
 */
class LevelFile {
    static LEVEL_FORMAT = 'moaikun-level';
    static PACK_FORMAT = 'moaikun-level-pack';
    static DRAFT_PACK_FORMAT = 'moaikun-draft-pack';
    static VERSION = 1;

    static createId(prefix = 'level') {
        if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
            return `${prefix}-${globalThis.crypto.randomUUID()}`;
        }
        return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    static normalizeBytes(value, fieldName, { minLength = 1, maxLength = 4096 } = {}) {
        if (!Array.isArray(value) && !(value instanceof Uint8Array)) {
            throw new Error(i18n.t('levelFileInvalidByteArray', { field: fieldName }));
        }

        const bytes = Array.from(value);
        if (bytes.length < minLength || bytes.length > maxLength) {
            throw new Error(i18n.t('levelFileInvalidLength', {
                field: fieldName,
                min: minLength,
                max: maxLength
            }));
        }

        for (const byte of bytes) {
            if (!Number.isInteger(byte) || byte < 0 || byte > 0xFF) {
                throw new Error(i18n.t('levelFileInvalidByte', { field: fieldName }));
            }
        }
        return bytes;
    }

    static checksum(mapData, monsterData) {
        // FNV-1a 32 bit. This is for accidental corruption detection, not security.
        let hash = 0x811C9DC5;
        const bytes = [...mapData, 0xFF, ...monsterData];
        for (const byte of bytes) {
            hash ^= byte;
            hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        return hash.toString(16).toUpperCase().padStart(8, '0');
    }

    static validateLevel(value, fallbackName = '') {
        if (!value || typeof value !== 'object') {
            throw new Error(i18n.t('levelFileInvalidLevel'));
        }

        // "data" is accepted for migration from the old backup structure.
        const mapData = this.normalizeBytes(value.mapData ?? value.data, 'mapData', {
            minLength: 4,
            maxLength: 4096
        });
        const monsterData = this.normalizeBytes(value.monsterData, 'monsterData', {
            minLength: 1,
            maxLength: 255
        });

        const validEmptyEnemyMarker = monsterData.length === 1 && monsterData[0] === 0;
        if ((monsterData.length & 1) === 0 ||
            (!validEmptyEnemyMarker && monsterData[0] !== monsterData.length)) {
            throw new Error(i18n.t('levelFileInvalidMonsterData'));
        }

        if (mapData.slice(4).includes(0xFF)) {
            throw new Error(i18n.t('levelFileContainsMapTerminator'));
        }
        // Exercise the normal decoder as a final structural check.
        DataConverter.fromROMtoEditor(mapData, monsterData);

        const calculatedChecksum = this.checksum(mapData, monsterData);
        if (value.checksum && String(value.checksum).toUpperCase() !== calculatedChecksum) {
            throw new Error(i18n.t('levelFileChecksumMismatch'));
        }

        return {
            id: typeof value.id === 'string' && value.id ? value.id : this.createId('level'),
            name: typeof value.name === 'string' && value.name.trim()
                ? value.name.trim().slice(0, 80)
                : fallbackName,
            mapData,
            monsterData,
            checksum: calculatedChecksum,
            source: typeof value.source === 'string' ? value.source : 'file',
            levelIndex: Number.isInteger(value.levelIndex) ? value.levelIndex : null,
            createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now()
        };
    }

    static createLevelRecord(mapData, monsterData, metadata = {}) {
        return this.validateLevel({
            ...metadata,
            mapData: [...mapData],
            monsterData: [...monsterData]
        }, metadata.name || '');
    }

    static createSingle(levelRecord) {
        const level = this.validateLevel(levelRecord, i18n.t('importedLevelDefaultName'));
        return {
            format: this.LEVEL_FORMAT,
            version: this.VERSION,
            exportedAt: new Date().toISOString(),
            level
        };
    }

    static createPack(levelRecords, draftRecords = []) {
        if (!Array.isArray(levelRecords) || levelRecords.length === 0) {
            throw new Error(i18n.t('levelPackEmpty'));
        }
        return {
            format: this.PACK_FORMAT,
            version: this.VERSION,
            exportedAt: new Date().toISOString(),
            levels: levelRecords.map((level, index) =>
                this.validateLevel(level, i18n.t('levelLabel', { level: index + 1 }))),
            drafts: Array.isArray(draftRecords)
                ? draftRecords.map((level, index) =>
                    this.validateLevel(level, i18n.t('draftDefaultName', { number: index + 1 })))
                : []
        };
    }

    static createDraftPack(draftRecords) {
        if (!Array.isArray(draftRecords) || draftRecords.length === 0) {
            throw new Error(i18n.t('draftPackEmpty'));
        }
        return {
            format: this.DRAFT_PACK_FORMAT,
            version: this.VERSION,
            exportedAt: new Date().toISOString(),
            drafts: draftRecords.map((level, index) =>
                this.validateLevel(level, i18n.t('draftDefaultName', { number: index + 1 })))
        };
    }

    static parse(text) {
        let value;
        try {
            value = JSON.parse(text);
        } catch (error) {
            throw new Error(i18n.t('levelFileInvalidJson'));
        }

        // Accept the earliest/simple {mapData, monsterData} form as an import convenience.
        if (value && !value.format && (value.mapData || value.data) && value.monsterData) {
            return {
                type: 'level',
                level: this.validateLevel(value, i18n.t('importedLevelDefaultName'))
            };
        }

        if (!value || value.version !== this.VERSION) {
            throw new Error(i18n.t('levelFileUnsupportedVersion'));
        }

        if (value.format === this.LEVEL_FORMAT) {
            return {
                type: 'level',
                level: this.validateLevel(value.level, i18n.t('importedLevelDefaultName'))
            };
        }

        if (value.format === this.PACK_FORMAT) {
            if (!Array.isArray(value.levels) || value.levels.length === 0) {
                throw new Error(i18n.t('levelPackEmpty'));
            }
            return {
                type: 'pack',
                levels: value.levels.map((level, index) =>
                    this.validateLevel(level, i18n.t('levelLabel', { level: index + 1 }))),
                drafts: Array.isArray(value.drafts)
                    ? value.drafts.map((level, index) =>
                        this.validateLevel(level, i18n.t('draftDefaultName', { number: index + 1 })))
                    : []
            };
        }

        if (value.format === this.DRAFT_PACK_FORMAT) {
            if (!Array.isArray(value.drafts) || value.drafts.length === 0) {
                throw new Error(i18n.t('draftPackEmpty'));
            }
            return {
                type: 'draft-pack',
                drafts: value.drafts.map((level, index) =>
                    this.validateLevel(level, i18n.t('draftDefaultName', { number: index + 1 })))
            };
        }

        throw new Error(i18n.t('levelFileUnknownFormat'));
    }

    static download(data, fileName) {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json;charset=utf-8'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    static safeFileName(value, fallback) {
        const result = String(value || '')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim();
        return result || fallback;
    }
}
