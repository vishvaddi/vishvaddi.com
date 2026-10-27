export interface InvestmentInput { contribution: number; periods: number; savingsRate: number; returnRate: number; brokerage: number; years: number }
export interface InvestmentResult { interval: number; invested: number; cash: number; fees: number; purchases: number; total: number }
export function investmentSchedules(v: InvestmentInput): InvestmentResult[] {
  if (![12, 26, 52].includes(v.periods) || !Number.isInteger(v.years) || v.years < 1 || v.years > 50 ||
    ![v.contribution, v.savingsRate, v.returnRate, v.brokerage].every(Number.isFinite) ||
    v.contribution <= 0 || v.contribution > 1000000 || v.brokerage < 0 || v.brokerage > 100000 ||
    v.savingsRate <= -100 || v.savingsRate > 100 || v.returnRate <= -100 || v.returnRate > 100) throw new RangeError('Enter valid amounts, rates above −100% and at most 100%, and a whole-number horizon of 1–50 years.');
  const cashGrowth = (1 + v.savingsRate / 100) ** (1 / v.periods), investmentGrowth = (1 + v.returnRate / 100) ** (1 / v.periods);
  return Array.from({ length: v.periods + 1 }, (_, interval) => {
    let cash = 0, invested = 0, fees = 0, purchases = 0;
    for (let period = 1; period <= v.periods * v.years; period++) {
      cash = cash * cashGrowth + v.contribution; invested *= investmentGrowth;
      if (interval > 0 && period % interval === 0 && cash > v.brokerage) { invested += cash - v.brokerage; cash = 0; fees += v.brokerage; purchases++; }
    }
    return { interval, cash, invested, fees, purchases, total: cash + invested };
  });
}
