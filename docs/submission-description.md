# Submission description (draft)

> Competition package draft for Nimiq Mini Apps Competition, Cycle II.  
> Target: ≤ 250 words. Owner must approve before dashboard paste.  
> Source of truth for product claims: [SPEC.md](SPEC.md) executive summary; implemented surface reflects the repo board, not unfinished stake writes.

---

Steakout is a non-custodial Nimiq staking cockpit and validator accountability layer for Nimiq Pay.

Nimiq Pay users hold and spend NIM in one place, but staking and post-delegation visibility have been fragmented. The official Validator Trust Score measures block production and does not assess whether validators pay stakers. Steakout addresses both: a mobile-first path to stake through Nimiq Pay’s native provider methods, and a plain-language view of what happens after delegation.

Users can browse validators, open evidence-linked profiles, and connect a wallet to see observed position state. Profiles separate registry declarations (fees, schedules) from chain observations: payout runs from reward addresses, schedule adherence when a schedule is normalizable, and recipient coverage—with freshness and status labels on every metric. Learn pages document staking basics, methodology, limitations, and privacy.

Steakout never takes custody. It does not request keys or seed phrases. Staking writes go only through the Nimiq Pay provider after a review screen. The server does not accept client-reported success; confirmations match chain data to authenticated intent.

Metrics stay honest: no guaranteed APY, no effective-fee claims, no fraud labels, no “best validator” ranking. Language stays neutral—observed, not observed, insufficient data—so missing data is never treated as wrongdoing.

Stake write paths still require Nimiq Pay device verification before production CTAs; until then, monitoring and registry views are the live surface. Open source under MIT.
