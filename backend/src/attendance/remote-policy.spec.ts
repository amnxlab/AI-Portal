import { remotePolicyOf } from './attendance.service';

/**
 * The per-employee remote-work ceiling.
 *
 * This is the number the weekly-report check uses to decide how many remote
 * hours count as verified, so an error here either silently lets remote
 * hours past the policy or refuses hours the employee is entitled to claim.
 *
 * `weeklyHoursCap` arrives from Postgres as a NUMERIC, which the driver hands
 * back as a *string* — the tests cover that explicitly, because a string
 * slipping into the arithmetic is the failure this function is most likely to
 * have in production and not in a unit test.
 */
const user = (over: Partial<Parameters<typeof remotePolicyOf>[0]> = {}) => ({
    remoteWorkAllowed: true,
    remoteWorkPercent: 20,
    remoteMaxHours: null,
    weeklyHoursCap: 20,
    ...over,
}) as Parameters<typeof remotePolicyOf>[0];

describe('remotePolicyOf', () => {
    it('gives an unauthorised employee a zero ceiling, whatever else is set', () => {
        const p = remotePolicyOf(user({ remoteWorkAllowed: false, remoteWorkPercent: 50, remoteMaxHours: 10 }));
        expect(p.allowed).toBe(false);
        expect(p.limitHours).toBe(0);
    });

    it('takes the percentage of the weekly cap', () => {
        expect(remotePolicyOf(user({ weeklyHoursCap: 20, remoteWorkPercent: 20 })).limitHours).toBe(4);
        expect(remotePolicyOf(user({ weeklyHoursCap: 40, remoteWorkPercent: 25 })).limitHours).toBe(10);
    });

    it('applies the hard ceiling when it is lower than the percentage', () => {
        const p = remotePolicyOf(user({ weeklyHoursCap: 40, remoteWorkPercent: 50, remoteMaxHours: 6 }));
        expect(p.limitHours).toBe(6);
    });

    it('ignores the hard ceiling when the percentage is already lower', () => {
        const p = remotePolicyOf(user({ weeklyHoursCap: 20, remoteWorkPercent: 10, remoteMaxHours: 15 }));
        expect(p.limitHours).toBe(2);
    });

    it('falls back to a standard week when no cap is set', () => {
        // No cap must not mean "no remote limit" — that would make the
        // percentage policy unenforceable for uncapped employees.
        const p = remotePolicyOf(user({ weeklyHoursCap: null, remoteWorkPercent: 20 }));
        expect(p.limitHours).toBeGreaterThan(0);
    });

    it('handles NUMERIC columns arriving as strings', () => {
        const p = remotePolicyOf(user({
            weeklyHoursCap: '40' as unknown as number,
            remoteWorkPercent: '25' as unknown as number,
        }));
        // '40' * '25' / 100 would be NaN if either were concatenated instead
        // of coerced.
        expect(p.limitHours).toBe(10);
        expect(Number.isNaN(p.limitHours)).toBe(false);
    });

    it('never returns a negative ceiling', () => {
        const p = remotePolicyOf(user({ remoteWorkPercent: -10 }));
        expect(p.limitHours).toBeGreaterThanOrEqual(0);
    });

    it('rounds to two decimals rather than carrying float noise', () => {
        const p = remotePolicyOf(user({ weeklyHoursCap: 37.5, remoteWorkPercent: 33 }));
        expect(p.limitHours).toBe(12.38);
    });

    it('reports the policy inputs back, for display alongside the ceiling', () => {
        const p = remotePolicyOf(user({ remoteWorkPercent: 20, remoteMaxHours: 6 }));
        expect(p.percent).toBe(20);
        expect(p.maxHours).toBe(6);
        expect(p.allowed).toBe(true);
    });
});
