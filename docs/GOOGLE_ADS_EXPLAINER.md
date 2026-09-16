# Google Ads — how it works, and what a test would cost

Written 16/09/26 because Vish said "i'm not sure how that works yet". Decision still his; nothing is set up.

**TL;DR.** You choose search phrases, write a short text ad and set a daily budget. When someone in Australia searches one of those phrases, Google may show your ad above the normal results. You pay only when someone clicks it. For this site, ads are a way to **learn which tools people search for**, not a way to make money: at A$100/yr, each paying customer would likely cost more in clicks than they pay.

## The moving parts

- **Keywords.** The searches you want to appear on, e.g. `cut list calculator`. "Exact match" `[cut list calculator]` shows the ad only for that search and close variants, which keeps spend predictable.
- **The auction.** Every search runs a quick auction. Your position depends on your maximum bid and Google's "Quality Score" (how relevant the ad and landing page are to the search). A relevant page can beat a higher bid.
- **Cost per click (CPC).** What one click costs. For Australian construction or software searches, expect roughly A$1.50–9. That's from memory, medium confidence: Google's free Keyword Planner shows real ranges once you have an account.
- **Budget.** A daily cap, e.g. A$10/day. Google can overspend on a single day (up to twice the daily budget) but averages it out over the month.
- **Conversion tracking.** Tells Google which clicks led to something you care about. Here that would be "used a tool" or "reached /pay/success", measured with a small Google tag on the site. Note this adds a Google tracking script, which is a privacy trade-off against the site's cookieless analytics.

## The maths for this site

| Cost per click | Clicks that become a paying customer | Ad cost per customer |
|---|---|---|
| A$3.00 | 1 in 100 | A$300 (lose money) |
| A$3.00 | 3 in 100 | A$100 (break even on a yearly plan) |
| A$1.50 | 3 in 100 | A$50 (profitable) |

Typical free-to-paid conversion is a few percent of *active users* (industry benchmarks, medium confidence), and far lower per ad click. So assume ads lose money on direct sales.

## A sensible first test, if you ever want one

- A$150 total: A$10/day for 14 days, search network only, exact match, 5–10 keywords across 2–3 tools (cut list, plasterboard/material quantities, programme builder).
- **Landing pages:** the specific tool or answer page, not the homepage.
- **Measure:** clicks, how many visitors actually used the tool (the site's own counters), and search terms Google reports.
- **Stop rule:** end at A$150 regardless. The output is a list of what people search for and which tool holds them, which then feeds free SEO pages.
- **Microsoft Ads (Bing)** is usually cheaper per click with older, trade-heavy users (anecdote); a A$50 side test is optional.

## What Vish would need to do

Create a Google Ads account (card on file, his action), choose "expert mode" to skip the auto-created Smart campaign, and decide whether adding the Google tag is acceptable. Claude can then draft the keyword list, ad text and conversion setup.
