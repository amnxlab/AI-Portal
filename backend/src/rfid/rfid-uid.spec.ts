import { normalizeUid } from './rfid.service';

/**
 * Card UID normalisation.
 *
 * This is the single point where a physical card becomes a database key, so
 * everything downstream — "is this card already assigned", "whose card is
 * this", "is this a duplicate tap" — is a string comparison against whatever
 * this function returned. If it accepted two spellings of the same UID, one
 * card could be registered to two employees; if it rejected a valid UID, a
 * card would read as unknown forever.
 */
describe('normalizeUid', () => {
    it('upper-cases and strips the separators readers add', () => {
        // The same 4-byte card, written the five ways reader firmware emits it.
        const forms = [
            'a1b2c3d4',
            'A1B2C3D4',
            'a1:b2:c3:d4',
            'A1 B2 C3 D4',
            'a1-b2-c3-d4',
        ];
        for (const form of forms) {
            expect(normalizeUid(form)).toBe('A1B2C3D4');
        }
    });

    it('accepts the three UID lengths ISO 14443-A actually defines', () => {
        expect(normalizeUid('04A1B2C3')).toBe('04A1B2C3');                      // 4 bytes
        expect(normalizeUid('04A1B2C3D4E5F6')).toBe('04A1B2C3D4E5F6');          // 7 bytes
        expect(normalizeUid('04A1B2C3D4E5F6A7B8C9')).toBe('04A1B2C3D4E5F6A7B8C9'); // 10 bytes
    });

    it('rejects lengths no MIFARE card has', () => {
        // A truncated read is the dangerous case: half a UID must never be
        // accepted, because it could collide with a different card.
        expect(normalizeUid('A1B2C3')).toBeNull();        // 3 bytes
        expect(normalizeUid('A1B2C3D4E5')).toBeNull();    // 5 bytes
        expect(normalizeUid('A1')).toBeNull();
        expect(normalizeUid('')).toBeNull();
    });

    it('rejects anything that is not hex', () => {
        expect(normalizeUid('A1B2C3G4')).toBeNull();
        expect(normalizeUid('ZZZZZZZZ')).toBeNull();
        expect(normalizeUid('A1B2C3D')).toBeNull();
    });

    it('rejects non-strings rather than coercing them', () => {
        // A reader sending a number or null must fail the scan, not be
        // stringified into something that happens to look like a UID.
        expect(normalizeUid(null)).toBeNull();
        expect(normalizeUid(undefined)).toBeNull();
        expect(normalizeUid(12345678)).toBeNull();
        expect(normalizeUid({})).toBeNull();
        expect(normalizeUid(['A1B2C3D4'])).toBeNull();
    });

    it('is idempotent, so a stored UID re-normalises to itself', () => {
        const once = normalizeUid('a1:b2:c3:d4');
        expect(once).not.toBeNull();
        expect(normalizeUid(once as string)).toBe(once);
    });
});
