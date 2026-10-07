/**
 * Percentage basis par amount split karne ka safe helper.
 *
 * Simple `amount * percent / 100` karne se problem ye aati hai ki har part ko
 * 2 decimal par round karte hi kuch paisa ya fraction gayab ho jaata hai — aur
 * salary page par worker ke boxes aur table ka total alag dikhne lagte hain.
 *
 * Isliye har part ko niche (floor) kiya jaata hai aur jo bacha hua remainder
 * sabse bade part me daal diya jaata hai. Result: parts ka total hamesha original
 * amount ke EXACTLY barabar hota hai — koi paisa lost ya gain nahi hota.
 */

export type WeightedShare = {
  key: string;
  label: string;
  percent: number;
};

/** Do decimal tak round karo, floating point drift se bachate hue. */
export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Amount ko weights ke hisaab se baanto. Percentages ka total 100 ya koi bhi
 * number ho sakta hai — relative weights ki tarah treat hote hain.
 *
 * @returns key -> allocated amount (2 decimal)
 */
export const splitByPercent = (
  amount: number,
  shares: WeightedShare[]
): Record<string, number> => {
  const result: Record<string, number> = {};
  const total = Number(amount || 0);
  const weightSum = shares.reduce((sum, s) => sum + (Number(s.percent) || 0), 0);

  if (!shares.length || weightSum <= 0 || total <= 0) {
    shares.forEach((s) => {
      result[s.key] = 0;
    });
    return result;
  }

  let allocated = 0;
  let largestKey = shares[0].key;

  // Parts ka total hamesha 2-decimal wale amount ke barabar hona chahiye, kyunki
  // page par wahi figure dikhta hai. (Jaise 2.675 ko chaar 2-decimal parts me
  // exactly fit nahi kar sakte — isliye 2.68 maana jaata hai.)
  const target = round2(total);

  shares.forEach((share) => {
    const raw = (target * (Number(share.percent) || 0)) / weightSum;
    // Neeche ki taraf round — isse hamesha target se kam ya barabar hota hai.
    const floored = Math.floor((raw + Number.EPSILON) * 100) / 100;
    result[share.key] = floored;
    allocated += floored;
    if ((Number(share.percent) || 0) > (Number(shares.find((s) => s.key === largestKey)?.percent) || 0)) {
      largestKey = share.key;
    }
  });

  const remainder = round2(target - allocated);
  if (remainder !== 0) {
    result[largestKey] = round2((result[largestKey] || 0) + remainder);
  }

  return result;
};

/**
 * Worker share — FIXED percentage, dobara normalize NAHI hota.
 *
 * Ye jaan-boojh kar alag rakha hai `splitByPercent` se. Chutti par baaki workers
 * ko "unka wala extra" nahi milta: har worker ko apne hi % par usi charge ka
 * hissa milta hai, aur jo nahi tick hua uska share 0 rehta hai. Isliye
 * distribute hua total hamesha pool se CHHOTA ya barabar hota hai, aur baaki
 * paise shop ke paas reh jaate hain.
 *
 * Rounding: har worker ko uske % ka 2-decimal share diya jaata hai. Paise ka
 * kuch hissa fraction me reh sakta hai (jaise 33% of ₹50 = ₹16.50 theek hai,
 * par 27% of ₹50 = ₹13.50 bhi theek hai — aise cases me fraction as fraction
 * reh jaata hai), isliye ye function har worker ko independently round karta hai
 * aur baad me unka total pool se compare karke "undistributed" dikhata hai.
 */
export const workerShareAmount = (
  charge: number,
  percent: number
): number => {
  const value = (Number(charge || 0) * (Number(percent) || 0)) / 100;
  return round2(value);
};

export const money = (value: number) =>
  `₹ ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
