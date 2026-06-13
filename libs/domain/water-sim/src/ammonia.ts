/**
 * Free-ammonia (NH3) fraction of total ammonia-nitrogen (NH3 + NH4+).
 *
 * Test kits report TOTAL ammonia-nitrogen (TAN). Only the un-ionised NH3 is the
 * acutely toxic form, and its fraction rises sharply with pH and (more mildly)
 * temperature. This is the honest chemistry that makes "your pH is high, so the
 * same ammonia reading is far more dangerous" true in the sim.
 *
 * Equilibrium:  NH4+  ⇌  NH3 + H+ ,  fraction NH3 = 1 / (1 + 10^(pKa − pH))
 *
 * pKa(T) for the aqueous ammonia equilibrium (Emerson, Russo, Lund & Thurston
 * 1975, "Aqueous ammonia equilibrium calculations: effect of pH and
 * temperature", J. Fish. Res. Board Can. 32(12):2379–2383):
 *
 *     pKa = 0.09018 + 2729.92 / T_kelvin
 *
 * This is the standard relation used in fisheries/aquaculture ammonia-toxicity
 * work; it is a real sourced formula, not an approximation.
 */

/**
 * Fraction (0..1) of total ammonia present as toxic un-ionised NH3 at the given
 * pH and temperature.
 *
 * @param ph pH (defended to a plausible 0..14 band).
 * @param temperatureC water temperature in °C.
 */
export function freeAmmoniaFraction(ph: number, temperatureC: number): number {
  const phSafe = clamp(Number.isFinite(ph) ? ph : 7, 0, 14);
  const tC = Number.isFinite(temperatureC) ? temperatureC : 25;
  const tK = tC + 273.15;
  // Emerson et al. 1975 temperature-dependent pKa.
  const pKa = 0.09018 + 2729.92 / tK;
  return 1 / (1 + Math.pow(10, pKa - phSafe));
}

/**
 * Toxic free-ammonia concentration (mg/L as NH3-N) for a total-ammonia reading.
 *
 * @param totalAmmoniaN total ammonia-nitrogen, mg/L (the test-kit number).
 * @param ph pH.
 * @param temperatureC °C.
 */
export function freeAmmonia(totalAmmoniaN: number, ph: number, temperatureC: number): number {
  const total = Number.isFinite(totalAmmoniaN) && totalAmmoniaN > 0 ? totalAmmoniaN : 0;
  return total * freeAmmoniaFraction(ph, temperatureC);
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
