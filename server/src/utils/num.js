// Quantification à 3 décimales (alignée avec DECIMAL(12,3) en DB)
export const SCALE = 1000;
export const EPS = 1 / (2 * SCALE); // 0.0005

export function q3(x) {
    return Math.round(Number(x) * SCALE) / SCALE;
}
export function gt(x) {
    return Number(x) > EPS; // strictement > 0.0005
}
// export function nz(x) { // "near zero" -> 0
//     const y = q3(x);
//     return Math.abs(y) <= EPS ? 0 : y;
// }
